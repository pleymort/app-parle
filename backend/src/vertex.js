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

/* Plan d'« ajout magique » : le parent donne un concept, l'IA décide de tout.
   Même contrat JSON que côté app (actions create / image / say). */
export async function magicPlan({ concept, cats, existing }) {
  const model = vertex.getGenerativeModel({
    model: config.textModel,
    generationConfig: { responseMimeType: "application/json" },
  });
  const catList = (cats || []).map((c) => `"${c.id}" (${c.label})`).join(", ");
  const existingList = (existing || []).map((l) => `"${l}"`).join(", ");
  const prompt =
    `Tu configures l'application de communication (CAA) d'un enfant de 6 ans non verbal. Le parent demande : "${concept}".
Pictogrammes déjà présents dans l'app : ${existingList}.
La demande peut être : UN concept à créer ("le trampoline"), une LISTE ("fraise, banane, yaourt"), un THÈME à développer ("le petit-déjeuner" → les aliments typiques), la MODIFICATION DE L'IMAGE d'un pictogramme déjà présent ("change l'image de Gâteau, mets un cupcake"), ou la MODIFICATION DE LA PHRASE PRONONCÉE ("quand il touche JeaJea, dis Jaja" ; pour corriger une prononciation, orthographie la phrase phonétiquement).
Réponds UNIQUEMENT un tableau JSON de 1 à 8 objets, chacun avec ces clés :
"action" : "create" (nouveau pictogramme), "image" (changer seulement l'image d'un pictogramme existant) ou "say" (changer seulement la phrase prononcée d'un pictogramme existant) ;
"target" : si action "image" ou "say", le label EXACT du pictogramme existant concerné, sinon null ;
"label" : le mot court affiché sous le pictogramme (1 à 2 mots, majuscule initiale, ex "Piscine") ;
"say" : la phrase courte et naturelle que la tablette prononcera à la place de l'enfant, à la première personne (ex "Je veux aller à la piscine") ;
"cat" : la catégorie la plus logique parmi : ${catList} ;
"search" : un nom commun simple pour chercher un pictogramme dans la banque ARASAAC (ex "piscine") ;
"imageHint" : si le parent donne une consigne sur l'apparence de l'image, cette consigne en une phrase, sinon null ;
"emoji" : si le parent demande explicitement un émoji, l'émoji lui-même, sinon null ;
"emojiFallback" : TOUJOURS fourni — un émoji simple qui représente bien le concept (image de secours).
Si AUCUNE catégorie existante ne convient vraiment, mets "cat" à null et fournis "catNew" : {"label": "...", "emoji": "..."} pour créer une nouvelle catégorie.
Ne développe un thème que si le parent l'a clairement demandé ; pour un concept unique, réponds un tableau d'un seul objet.`;
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  const text = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.items || [parsed]);
}

/* ---- Images (génération de picto + détourage de photo) ---- */
const vertexImage = new VertexAI({ project: config.project, location: config.imageLocation });

function extractImage(res) {
  const parts = res?.response?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData);
  if (!img) throw new Error("pas d'image dans la réponse du modèle");
  return { mimeType: img.inlineData.mimeType, data: img.inlineData.data };
}

export async function genImage(word, hint) {
  const model = vertexImage.getGenerativeModel({ model: config.imageModel });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text:
      "Pictogramme de communication pour un enfant de 6 ans, représentant : " + word +
      ". Style : dessin plat très simple, contours noirs épais, couleurs vives, fond blanc uni, un seul sujet centré, aucun texte." +
      (hint ? " Consigne importante du parent sur l'apparence (l'enfant reconnaît mieux certaines formes) : " + hint + "." : "") }] }],
  });
  return extractImage(res);
}

export async function cleanPhoto(mimeType, dataB64) {
  const model = vertexImage.getGenerativeModel({ model: config.imageModel });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType, data: dataB64 } },
      { text: "Détoure le sujet principal de cette photo et place-le sur un fond blanc uni. Rends-le net et lisible comme un pictogramme de communication pour enfant. Aucun texte." },
    ] }],
  });
  return extractImage(res);
}
