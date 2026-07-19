// Configuration lue depuis l'environnement (variables Cloud Run).
export const config = {
  port: process.env.PORT || 8080,
  project: process.env.GOOGLE_CLOUD_PROJECT || "",
  // Région UE. europe-west9 = Paris (résidence FR) mais tous les modèles n'y
  // sont pas ; europe-west1 (Belgique) est un repli fiable pour Gemini/Imagen.
  location: process.env.VERTEX_LOCATION || "europe-west1",
  textModel: process.env.VERTEX_TEXT_MODEL || "gemini-2.5-flash-lite",
  // Secret partagé TEMPORAIRE (dev). À remplacer en Phase 4 par la vérification
  // d'un ID token Firebase + App Check, puis metering/paywall par utilisateur.
  appSecret: process.env.APP_SECRET || "",
  allowedOrigins: (
    process.env.ALLOWED_ORIGINS ||
    "https://localhost,capacitor://localhost,http://localhost,https://pleymort.github.io"
  ).split(","),
};
