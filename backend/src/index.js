import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { reformulate, magicPlan, genImage, cleanPhoto } from "./vertex.js";
import { tts } from "./tts.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cors({ origin: config.allowedOrigins }));

// --- Garde d'accès (STUB de dev : secret partagé) ---
// TODO Phase 4 : remplacer par la vérification d'un ID token Firebase + App Check,
// puis mesurer l'usage par utilisateur (Firestore) et appliquer le paywall
// (droits gratuits vs payants). NE PAS déployer en prod ouverte sans ça :
// chaque appel coûte de l'argent (Vertex AI).
app.use((req, res, next) => {
  if (req.path === "/health") return next();
  if (config.appSecret && req.get("x-app-secret") !== config.appSecret) {
    return res.status(401).json({ error: "unauthorized" });
  }
  // TODO: req.userId = await verifyFirebaseIdToken(req.get("authorization"));
  // TODO: metering + quota (Firestore) avant d'appeler Vertex.
  next();
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "leova-backend" }));

app.post("/v1/reformulate", async (req, res) => {
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
app.post("/v1/tts", async (req, res) => {
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
app.post("/v1/magic", async (req, res) => {
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
app.post("/v1/image", async (req, res) => {
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
