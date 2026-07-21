import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { reformulate, magicPlan, genImage, cleanPhoto, transcribe, onboardPlan, SafetyError } from "./vertex.js";
import { getSync, putSync } from "./sync.js";
import { tts } from "./tts.js";
import { verifyToken } from "./firebase.js";
import { checkAndCount, getUsage } from "./meter.js";
import { verifyAndApply, handleRtdn } from "./billing.js";

const app = express();
// 20 Mo : la sauvegarde du vocabulaire embarque les photos des cartes (data URLs).
app.use(express.json({ limit: "20mb" }));
app.use(cors({ origin: config.allowedOrigins }));

// --- Garde d'accès ---
// Deux voies : le code parent (x-app-secret, illimité, non compté) ou un
// jeton Firebase Auth anonyme (Authorization: Bearer …, soumis aux quotas).
// Reste pour plus tard : App Check (Play Integrity) pour attester que
// l'appel vient bien de l'app.
app.use(async (req, res, next) => {
  // /v1/billing/rtdn : poussé par Pub/Sub (pas nos en-têtes) — sans risque,
  // chaque notification est re-vérifiée auprès de l'API Google Play.
  if (req.path === "/health" || req.path === "/v1/billing/rtdn") return next();
  if (config.appSecret && req.get("x-app-secret") === config.appSecret) {
    req.auth = { parent: true };
    return next();
  }
  const uid = await verifyToken(req.get("authorization"));
  if (!uid) return res.status(401).json({ error: "unauthorized" });
  req.auth = { uid };
  next();
});

// Quota par fonction. En cas de panne du metering on laisse passer :
// la disponibilité pour l'enfant prime sur la précision du comptage.
const meter = (feature) => async (req, res, next) => {
  if (req.auth?.parent) return next();
  try {
    const r = await checkAndCount(req.auth.uid, feature);
    if (!r.ok) {
      return res.status(429).json({
        error: r.reason === "global_cap" ? "service_sature" : "quota_epuise",
        used: r.used, quota: r.quota,
      });
    }
  } catch (e) {
    console.error("meter:", e);
  }
  next();
};

// Demande bloquée par les filtres de sécurité Google → 422 explicite
// (l'app affiche un message clair au lieu d'un échec générique).
const handleAIError = (res, tag) => (e) => {
  if (e instanceof SafetyError) {
    console.warn(tag + " (sécurité):", e.message);
    return res.status(422).json({ error: "contenu_refuse" });
  }
  console.error(tag + ":", e);
  res.status(500).json({ error: tag + "_error" });
};

app.get("/health", (_req, res) => res.json({ ok: true, service: "leova-backend" }));

// État du compte : plan + usage du mois (pour l'app / futur paywall).
app.get("/v1/me", async (req, res) => {
  try {
    if (req.auth?.parent) return res.json({ plan: "parent" });
    res.json(await getUsage(req.auth.uid));
  } catch (e) {
    console.error("me:", e);
    res.status(500).json({ error: "me_error" });
  }
});

// Achat Leova Plus : l'app envoie le purchaseToken reçu de Google Play ;
// on vérifie chez Google puis on pose users/{uid}.plan = "plus".
app.post("/v1/billing/verify", async (req, res) => {
  try {
    if (!req.auth?.uid) return res.status(400).json({ error: "compte_requis" });
    const { purchaseToken, productId } = req.body || {};
    if (!purchaseToken || !productId) return res.status(400).json({ error: "token_requis" });
    const r = await verifyAndApply(req.auth.uid, String(purchaseToken), String(productId));
    res.json({ plan: r.active ? "plus" : "free", state: r.state });
  } catch (e) {
    console.error("billing/verify:", e);
    res.status(500).json({ error: "billing_error" });
  }
});

// Notifications temps réel Google Play (abonnement Pub/Sub → push ici).
app.post("/v1/billing/rtdn", async (req, res) => {
  try { await handleRtdn(req.body); } catch (e) { console.error("rtdn:", e); }
  res.status(200).send("ok"); // toujours 200, sinon Pub/Sub ré-essaie en boucle
});

app.post("/v1/reformulate", meter("reformulate"), async (req, res) => {
  try {
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.slice(0, 8) : [];
    if (!labels.length) return res.status(400).json({ error: "labels_requis" });
    // Les libellés qui sont des PERSONNES (surnoms familiaux) : le modèle ne
    // doit jamais les « corriger » (ex : Pépé ≠ pipi).
    const people = Array.isArray(req.body?.people) ? req.body.people.slice(0, 8).map(String) : [];
    const phrase = await reformulate(labels, people, req.body?.lang);
    res.json({ phrase });
  } catch (e) {
    handleAIError(res, "reformulate")(e);
  }
});

// Voix de l'app (WAV binaire). Cache mutualisé Cloud Storage côté serveur.
app.post("/v1/tts", meter("tts"), async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim().slice(0, 300);
    if (!text) return res.status(400).json({ error: "text_requis" });
    const { buf, cached } = await tts(text, req.body?.lang);
    res.set("content-type", "audio/wav").set("x-cache", cached ? "hit" : "miss").send(buf);
  } catch (e) {
    console.error("tts:", e);
    res.status(500).json({ error: "tts_error" });
  }
});

// Dictée du parent → texte (compté avec l'ajout magique, dont elle fait partie).
app.post("/v1/transcribe", meter("magic"), async (req, res) => {
  try {
    const b64 = String(req.body?.audioBase64 || "");
    if (!b64) return res.status(400).json({ error: "audio_requis" });
    const text = await transcribe(String(req.body?.mimeType || "audio/webm"), b64, req.body?.lang);
    res.json({ text });
  } catch (e) {
    handleAIError(res, "transcribe")(e);
  }
});

// Onboarding : tableau de démarrage personnalisé depuis l'interview du parent.
app.post("/v1/onboard", meter("magic"), async (req, res) => {
  try {
    const s = (v, n) => String(v || "").trim().slice(0, n);
    const plans = await onboardPlan({
      childName: s(req.body?.childName, 60),
      level: s(req.body?.level, 20),
      people: s(req.body?.people, 600),
      likes: s(req.body?.likes, 600),
      places: s(req.body?.places, 600),
      cats: Array.isArray(req.body?.cats) ? req.body.cats.slice(0, 30) : [],
      existing: Array.isArray(req.body?.existing) ? req.body.existing.slice(0, 200) : [],
      lang: req.body?.lang,
    });
    res.json({ plans });
  } catch (e) {
    handleAIError(res, "onboard")(e);
  }
});

// Sauvegarde / restauration du vocabulaire (nécessite un compte — pas le
// code parent seul : il faut un uid stable pour retrouver sa sauvegarde).
app.get("/v1/sync", async (req, res) => {
  try {
    if (!req.auth?.uid) return res.status(400).json({ error: "compte_requis" });
    const data = await getSync(req.auth.uid);
    if (!data) return res.status(404).json({ error: "aucune_sauvegarde" });
    res.json(data);
  } catch (e) {
    console.error("sync/get:", e);
    res.status(500).json({ error: "sync_error" });
  }
});

app.post("/v1/sync", async (req, res) => {
  try {
    if (!req.auth?.uid) return res.status(400).json({ error: "compte_requis" });
    const { state, rev } = req.body || {};
    if (!state || typeof state !== "object" || !Number.isFinite(rev)) {
      return res.status(400).json({ error: "state_requis" });
    }
    await putSync(req.auth.uid, state, rev);
    res.json({ ok: true, rev });
  } catch (e) {
    console.error("sync/put:", e);
    res.status(500).json({ error: "sync_error" });
  }
});

// Plan d'ajout magique (l'app envoie ses catégories et labels existants).
app.post("/v1/magic", meter("magic"), async (req, res) => {
  try {
    const concept = String(req.body?.concept || "").trim().slice(0, 500);
    if (!concept) return res.status(400).json({ error: "concept_requis" });
    const plans = await magicPlan({
      concept,
      cats: Array.isArray(req.body?.cats) ? req.body.cats.slice(0, 30) : [],
      existing: Array.isArray(req.body?.existing) ? req.body.existing.slice(0, 200) : [],
      lang: req.body?.lang,
    });
    res.json({ plans });
  } catch (e) {
    handleAIError(res, "magic")(e);
  }
});

// Image : génération de picto ({word, hint?}) OU détourage photo ({imageBase64, mimeType}).
app.post("/v1/image", meter("image"), async (req, res) => {
  try {
    let out;
    if (req.body?.imageBase64) {
      out = await cleanPhoto(String(req.body.mimeType || "image/jpeg"), String(req.body.imageBase64));
    } else {
      const word = String(req.body?.word || "").trim().slice(0, 100);
      if (!word) return res.status(400).json({ error: "word_requis" });
      out = await genImage(word, req.body?.hint ? String(req.body.hint).slice(0, 300) : null);
    }
    res.json(out); // {mimeType, data}
  } catch (e) {
    handleAIError(res, "image")(e);
  }
});

app.listen(config.port, () =>
  console.log(`leova-backend :${config.port} (project=${config.project || "?"}, ${config.location})`)
);
