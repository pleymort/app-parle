import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { reformulate } from "./vertex.js";

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

// TODO Phase 3 (suite) :
//   app.post("/v1/tts", ...)   -> voix "Kore" (Vertex Gemini TTS) + cache Cloud Storage
//   app.post("/v1/magic", ...) -> plan d'ajout magique (JSON)
//   app.post("/v1/image", ...) -> génération de picto (Imagen) + détourage photo

app.listen(config.port, () =>
  console.log(`leova-backend :${config.port} (project=${config.project || "?"}, ${config.location})`)
);
