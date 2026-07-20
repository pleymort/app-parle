import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { reformulate, magicPlan, genImage, cleanPhoto } from "./vertex.js";
import { tts } from "./tts.js";
import { verifyToken } from "./firebase.js";
import { checkAndCount, getUsage } from "./meter.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: config.allowedOrigins }));

// --- Garde d'accès ---
// Deux voies : le code parent (x-app-secret, illimité, non compté) ou un
// jeton Firebase Auth anonyme (Authorization: Bearer …, soumis aux quotas).
// Reste pour plus tard : App Check (Play Integrity) pour attester que
// l'appel vient bien de l'app.
app.use(async (req, res, next) => {
  if (req.path === "/health") return next();
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

app.post("/v1/reformulate", meter("reformulate"), async (req, res) => {
  try {
    const labels = Array.isArray(req.body?.labels) ? req.body.labels.slice(0, 8) : [];
    if (!labels.length) return res.status(400).json({ error: "labels_requis" });
    const phrase = await reformulate(labels);
    res.json({ phrase });
  } catch (e) {
    console.error("reformulate:", e);
    res.status(500).json({ error: "vertex_error" });
  }
});

// Voix de l'app (WAV binaire). Cache mutualisé Cloud Storage côté serveur.
app.post("/v1/tts", meter("tts"), async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim().slice(0, 300);
    if (!text) return res.status(400).json({ error: "text_requis" });
    const { buf, cached } = await tts(text);
    res.set("content-type", "audio/wav").set("x-cache", cached ? "hit" : "miss").send(buf);
  } catch (e) {
    console.error("tts:", e);
    res.status(500).json({ error: "tts_error" });
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
    });
    res.json({ plans });
  } catch (e) {
    console.error("magic:", e);
    res.status(500).json({ error: "magic_error" });
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
    console.error("image:", e);
    res.status(500).json({ error: "image_error" });
  }
});

app.listen(config.port, () =>
  console.log(`leova-backend :${config.port} (project=${config.project || "?"}, ${config.location})`)
);
