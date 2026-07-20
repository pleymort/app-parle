// Configuration lue depuis l'environnement (variables Cloud Run).
export const config = {
  port: process.env.PORT || 8080,
  project: process.env.GOOGLE_CLOUD_PROJECT || "",
  // Région UE. europe-west9 = Paris (résidence FR) mais tous les modèles n'y
  // sont pas ; europe-west1 (Belgique) est un repli fiable pour Gemini/Imagen.
  location: process.env.VERTEX_LOCATION || "europe-west1",
  textModel: process.env.VERTEX_TEXT_MODEL || "gemini-2.5-flash-lite",
  // Modèle image (génération de pictos + détourage de photos).
  imageModel: process.env.VERTEX_IMAGE_MODEL || "gemini-2.5-flash-image",
  // Les modèles image ne sont pas toujours servis dans les régions UE ;
  // "global" est le repli documenté (le texte, lui, reste en europe-west1).
  imageLocation: process.env.VERTEX_IMAGE_LOCATION || "europe-west1",
  // Voix de l'app : Chirp3-HD "Kore" via l'API Cloud Text-to-Speech (stable,
  // même famille de voix que la Kore de Gemini utilisée jusqu'ici côté app).
  ttsVoice: process.env.TTS_VOICE || "fr-FR-Chirp3-HD-Kore",
  // Cache audio mutualisé : un mot généré une fois sert à toutes les familles.
  ttsBucket: process.env.TTS_BUCKET || "",
  // Secret partagé TEMPORAIRE (dev). À remplacer en Phase 4 par la vérification
  // d'un ID token Firebase + App Check, puis metering/paywall par utilisateur.
  appSecret: process.env.APP_SECRET || "",
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ||
    "https://localhost,capacitor://localhost,http://localhost,https://pleymort.github.io"
  ).split(","),
};
