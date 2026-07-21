import { VertexAI, HarmCategory, HarmBlockThreshold } from "@google-cloud/vertexai";
import { config } from "./config.js";

// Sur Cloud Run, l'authentification se fait automatiquement via le compte de
// service du service (ADC) — aucune clé à gérer. En local :
// `gcloud auth application-default login`.
const vertex = new VertexAI({ project: config.project, location: config.location });

/* Sécurité contenu : app pour ENFANTS → seuils les plus stricts, déclarés
   EXPLICITEMENT (les défauts de Google varient selon les modèles). Ce sont
   les classifieurs côté Google qui décident, pas le prompt : une demande
   indécente est bloquée même si elle contourne nos consignes. */
const SAFETY = [
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({ category, threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE }));

// Génération bloquée par les filtres ? → erreur dédiée (l'API répond 422).
export class SafetyError extends Error {}
function checkBlocked(res) {
  const r = res?.response;
  const reason = r?.promptFeedback?.blockReason || r?.candidates?.[0]?.finishReason;
  if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || reason === "BLOCKLIST" ||
      r?.promptFeedback?.blockReason) {
    throw new SafetyError("contenu bloqué (" + reason + ")");
  }
}

// Reformule une suite de pictogrammes en une phrase naturelle (remplace l'appel
// Gemini direct qui était fait depuis l'app avec la clé du parent).
export async function reformulate(labels, people) {
  const model = vertex.getGenerativeModel({ model: config.textModel, safetySettings: SAFETY });
  const prompt =
    "Un enfant qui ne parle pas a touché ces pictogrammes, dans l'ordre, " +
    "sur son application de communication : " + labels.map((l) => `« ${l} »`).join(", ") + "." +
    (people && people.length
      ? ` ATTENTION : ${people.map((p) => `« ${p} »`).join(" et ")} ${people.length > 1 ? "sont des PERSONNES" : "est une PERSONNE"} de son entourage (surnom familial à reprendre TEL QUEL, sans le modifier ni l'interpréter comme un autre mot).`
      : "") +
    " Écris UNE seule phrase courte et NATURELLE en français, à la première personne, " +
    "qui exprime ce qu'il veut dire avec ces mots-là. Chaque mot touché doit se retrouver " +
    "dans la phrase (ou son sens exact) ; ajoute librement les petits mots nécessaires " +
    "(articles, prépositions, verbes de liaison) pour que la phrase soit fluide, mais " +
    "n'invente aucune idée absente et ne déforme aucun mot. " +
    "Exemple : « Je veux », « Pizza » → « Je veux de la pizza. » Réponds uniquement avec la phrase.";
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  checkBlocked(res);
  const text = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

/* Plan d'« ajout magique » : le parent donne un concept, l'IA décide de tout.
   Même contrat JSON que côté app (actions create / image / say). */
export async function magicPlan({ concept, cats, existing }) {
  const model = vertex.getGenerativeModel({
    model: config.textModel,
    generationConfig: { responseMimeType: "application/json" },
    safetySettings: SAFETY,
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
  checkBlocked(res);
  const text = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.items || [parsed]);
}

/* Onboarding : à partir des réponses du parent (proches avec surnoms exacts,
   passions, lieux), génère le tableau de démarrage personnalisé de l'enfant.
   Même contrat de carte que l'ajout magique (label/say/cat/search/emoji…). */
export async function onboardPlan({ childName, level, people, likes, places, cats, existing }) {
  const levelHint = {
    debut: "L'enfant DÉBUTE (peu ou pas de mots) : reste très simple, 6 à 10 cartes maximum, uniquement les plus motivantes et les proches essentiels.",
    signes: "L'enfant fait quelques signes : environ 10 à 14 cartes, concrètes et très motivantes.",
    pecs: "L'enfant utilise déjà des images/PECS : 14 à 20 cartes possibles.",
    phrases: "L'enfant combine des mots : jusqu'à 24 cartes, tu peux inclure quelques mots plus variés.",
  }[level] || "";
  const model = vertex.getGenerativeModel({
    model: config.textModel,
    generationConfig: { responseMimeType: "application/json" },
    safetySettings: SAFETY,
  });
  const catList = (cats || []).map((c) => `"${c.id}" (${c.label})`).join(", ");
  const prompt =
    `Tu prépares le tableau de démarrage d'une application de communication (CAA) pour un enfant non verbal` +
    (childName ? ` prénommé « ${childName} »` : "") + `. ${levelHint}
Réponses du parent :
- Personnes importantes (avec leurs surnoms EXACTS) : « ${people || "—"} »
- Ce que l'enfant adore (aliments, activités, personnages…) : « ${likes || "—"} »
- Lieux ou moments importants du quotidien : « ${places || "—"} »
Pictogrammes déjà présents dans l'app (ne PAS les dupliquer) : ${(existing || []).map((l) => `"${l}"`).join(", ")}.
Génère un tableau JSON de 6 à 24 objets : une carte par personne citée, une par passion, une par lieu/moment utile. Chaque objet a ces clés :
"label" : le mot court affiché sous le pictogramme (surnom EXACT pour une personne, majuscule initiale) ;
"say" : le mot prononcé par la tablette — identique au label, SAUF orthographe phonétique si le surnom risque d'être mal lu par une synthèse vocale française (ex label "JeaJea" → say "Jaja") ;
"cat" : la catégorie la plus logique parmi : ${catList} ;
"search" : un nom commun simple pour chercher un pictogramme dans la banque ARASAAC (pour une personne : "grand-mère", "frère", "maîtresse"…) ;
"emoji" : un émoji si un émoji évident représente très bien le concept, sinon null. Pour les PERSONNES, toujours null (un pictogramme, puis une vraie photo, les représentera mieux qu'un émoji) ;
"emojiFallback" : TOUJOURS fourni — un émoji simple de secours.
N'invente rien qui n'a pas été cité par le parent. Réponds UNIQUEMENT le tableau JSON.`;
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  });
  checkBlocked(res);
  const text = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : (parsed.items || [parsed]);
}

// Transcrit la dictée du parent (bouton 🎤 de l'ajout magique).
export async function transcribe(mimeType, dataB64) {
  const model = vertex.getGenerativeModel({ model: config.textModel, safetySettings: SAFETY });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType, data: dataB64 } },
      { text: "Transcris fidèlement ce que dit cette personne en français. Réponds uniquement le texte transcrit, rien d'autre." },
    ] }],
  });
  checkBlocked(res);
  const text = res?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return text.trim();
}

/* ---- Images (génération de picto + détourage de photo) ---- */
const vertexImage = new VertexAI({ project: config.project, location: config.imageLocation });

function extractImage(res) {
  checkBlocked(res);
  const parts = res?.response?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData);
  if (!img) throw new Error("pas d'image dans la réponse du modèle");
  return { mimeType: img.inlineData.mimeType, data: img.inlineData.data };
}

export async function genImage(word, hint) {
  const model = vertexImage.getGenerativeModel({ model: config.imageModel, safetySettings: SAFETY });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [{ text:
      "Pictogramme de communication pour un enfant de 6 ans, représentant : " + word +
      ". Style : dessin plat très simple, contours noirs épais, couleurs vives, fond blanc uni, un seul sujet centré, aucun texte." +
      (hint ? " Consigne importante du parent sur l'apparence (l'enfant reconnaît mieux certaines formes) : " + hint + "." : "") }] }],
  });
  return extractImage(res);
}

export async function cleanPhoto(mimeType, dataB64) {
  const model = vertexImage.getGenerativeModel({ model: config.imageModel, safetySettings: SAFETY });
  const res = await model.generateContent({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType, data: dataB64 } },
      { text: "Détoure le sujet principal de cette photo et place-le sur un fond blanc uni. Rends-le net et lisible comme un pictogramme de communication pour enfant. Aucun texte." },
    ] }],
  });
  return extractImage(res);
}
