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
  // Code d'accès "parent" : accès illimité, non compté (la tablette de la
  // famille). Les autres utilisateurs passent par Firebase Auth + quotas.
  appSecret: process.env.APP_SECRET || "",
  // Quota gratuit mensuel PAR utilisateur (uid anonyme Firebase).
  freeQuota: JSON.parse(
    process.env.FREE_QUOTA || '{"reformulate":1000,"tts":1500,"magic":100,"image":50}'
  ),
  // Quota du plan payant « plus » (users/{uid}.plan = "plus", posé à
  // l'encaissement — intégration paiement à venir). "unlimited" = aucun quota.
  plusQuota: JSON.parse(
    process.env.PLUS_QUOTA || '{"reformulate":10000,"tts":15000,"magic":1000,"image":400}'
  ),
  // Plafond global mensuel (tous utilisateurs) : garde-fou facture tant
  // qu'App Check n'est pas en place. Le code parent n'y est pas soumis.
  globalCap: JSON.parse(
    process.env.GLOBAL_CAP || '{"reformulate":20000,"tts":30000,"magic":1500,"image":150}'
  ),
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ||
    "https://localhost,capacitor://localhost,http://localhost,https://pleymort.github.io"
  ).split(","),
};
