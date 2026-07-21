// Langues supportées côté serveur (voix + IA). "Kore" (Chirp3-HD) existe dans
// toutes ces langues → on garde le même personnage vocal partout.
// name = nom de la langue EN FRANÇAIS (les prompts sont rédigés en français,
// on demande juste au modèle de PRODUIRE dans cette langue).
export const LANGS = {
  "fr-FR": { name: "français", search: "fr" },
  "en-US": { name: "anglais américain", search: "en" },
  "en-GB": { name: "anglais britannique", search: "en" },
  "es-ES": { name: "espagnol", search: "es" },
  "es-US": { name: "espagnol (Amérique)", search: "es" },
  "de-DE": { name: "allemand", search: "de" },
  "it-IT": { name: "italien", search: "it" },
  "pt-BR": { name: "portugais (Brésil)", search: "pt" },
  "pt-PT": { name: "portugais", search: "pt" },
  "nl-NL": { name: "néerlandais", search: "nl" },
};

const DEFAULT = "fr-FR";

// Normalise une langue reçue de l'app vers une clé supportée (sinon défaut).
export function normLang(lang) {
  if (!lang || typeof lang !== "string") return DEFAULT;
  if (LANGS[lang]) return lang;
  const base = lang.slice(0, 2).toLowerCase(); // "en-AU" -> "en"
  const match = Object.keys(LANGS).find((k) => k.slice(0, 2) === base);
  return match || DEFAULT;
}

export const langName = (lang) => LANGS[normLang(lang)].name;

// Voix Chirp3-HD "Kore" de la langue demandée (repli français).
export function voiceFor(lang) {
  return `${normLang(lang)}-Chirp3-HD-Kore`;
}
