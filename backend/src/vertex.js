import { VertexAI } from "@google-cloud/vertexai";
import { config } from "./config.js";

// Sur Cloud Run, l'authentification se fait automatiquement via le compte de
// service du service (ADC) — aucune clé à gérer. En local :
// `gcloud auth application-default login`.
const vertex = new VertexAI({ project: config.project, location: config.location });

// Reformule une suite de pictogrammes en une phrase naturelle (remplace l'appel
// Gemini direct qui était fait depuis l'app avec la clé du parent).
export async function reformulate(labels) {
  const model = vertex.getGenerativeModel({ model: config.textModel });
  const prompt =
    "Un enfant de 6 ans qui ne parle pas a touché ces pictogrammes, dans l'ordre, " +
    "sur son application de communication : " + labels.join(", ") +
    ". Écris UNE seule phrase courte et naturelle en français, à la première " +
    "personne, qui exprime ce qu'il veut dire. Réponds uniquement avec la phrase.";
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

/* À VENIR (suite Phase 3) :
   - ttsKore(text)   : voix "Kore" via Vertex Gemini TTS -> WAV, avec cache
                       Cloud Storage mutualisé (un mot généré une fois sert à tous).
   - magicPlan(concept) : plan JSON d'ajout magique.
   - genImage(word)  : pictogramme via Imagen ; cleanPhoto(dataUrl) : détourage. */
