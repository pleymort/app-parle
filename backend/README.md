# Leova — backend IA (Cloud Run + Vertex AI)

Proxy qui centralise les appels IA **côté serveur** : aucune clé dans l'app, on mesure l'usage et on applique le paywall freemium. Tout en **UE** (RGPD). Un utilisateur **gratuit ne touche jamais** ce backend (l'app marche hors-ligne) — seules les fonctions payantes appellent ici.

## Prérequis GCP (une seule fois — ta partie)

1. Créer un **nouveau projet** GCP, **facturation activée**, région **UE**.
2. Activer les APIs :
   ```bash
   gcloud services enable aiplatform.googleapis.com run.googleapis.com \
     cloudbuild.googleapis.com firestore.googleapis.com secretmanager.googleapis.com
   ```
3. Créer la base **Firestore** (mode Native, localisation **eur3** = Europe).
4. Signer le **DPA Google Cloud** (traitement des données).

## Déployé ✓ (19 juillet 2026)

- **Projet GCP** : `leova-app` (compte personnel `thibaut.gadiolet@gmail.com`,
  facturation « Leova billing », configuration gcloud dédiée : `gcloud config
  configurations activate leova` — `default` = config pro, non touchée).
- **URL** : https://leova-backend-11414001422.europe-west1.run.app
- **Secret d'app** : dans **Secret Manager** (`leova-app-secret`), injecté via
  `--set-secrets` — jamais en clair dans les commandes ni le code. Pour le lire :
  `gcloud secrets versions access latest --secret leova-app-secret`
- Firestore créé (eur3), APIs activées, rôle Vertex AI User accordé au compte
  de service. Modèle texte : `gemini-2.5-flash-lite` (le `gemini-2.0-*` initial
  n'existe plus sur Vertex — erreur 404).

## Re-déployer

```bash
cd backend
gcloud config configurations activate leova
gcloud run deploy leova-backend \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=leova-app,VERTEX_LOCATION=europe-west1 \
  --set-secrets APP_SECRET=leova-app-secret:latest
```

⚠️ Pour changer UNE variable d'environnement : `--update-env-vars` (fusionne).
`--set-env-vars` REMPLACE tout le jeu de variables — c'est ce qui a fait échouer
la révision 00002 (GOOGLE_CLOUD_PROJECT effacé → crash au démarrage).

## Tester

```bash
URL=https://leova-backend-11414001422.europe-west1.run.app
curl -s "$URL/health"   # -> {"ok":true,...}
curl -s -X POST "$URL/v1/reformulate" \
  -H "x-app-secret: $(gcloud secrets versions access latest --secret leova-app-secret)" \
  -H "content-type: application/json" \
  -d '{"labels":["Je veux","École"]}'
# -> {"phrase":"Je veux aller à l'école."}  (testé ✓)
```

## Développement local

```bash
gcloud auth application-default login   # ADC locales
cp .env.example .env                    # renseigner GOOGLE_CLOUD_PROJECT
npm install && node --env-file=.env src/index.js
```

## Phase 3 — terminée ✓ (20 juillet 2026)

- `/v1/reformulate` ✓ — phrase naturelle depuis les pictos touchés.
- `/v1/tts` ✓ — voix `fr-FR-Chirp3-HD-Kore` (API Cloud Text-to-Speech, stable),
  WAV 24 kHz, **cache Cloud Storage mutualisé** (bucket `leova-app-tts`,
  europe-west1) : x-cache miss/hit vérifié.
- `/v1/magic` ✓ — plan d'ajout magique (l'app envoie ses catégories/labels).
- `/v1/image` ✓ — picto généré par `gemini-2.5-flash-image` (dispo en
  europe-west1, vérifié) + détourage photo. `VERTEX_IMAGE_LOCATION=global` en
  repli si la région UE perdait le modèle.
- App basculée (v25) : avec le code d'accès, TOUT passe par le serveur ;
  la clé Gemini du parent devient un simple secours, chaque fonction replie
  proprement (backend → Gemini → voix appareil / mots bruts).

## Phase 4 — terminée ✓ (20 juillet 2026)

- **Firebase Auth anonyme** : Firebase rattaché au projet, app web
  `1:11414001422:web:980c432f47b655d2cd295f`, fournisseur anonyme activé.
  L'app (v26) crée un compte anonyme via l'API REST Identity Toolkit (pas de
  SDK) et envoie `Authorization: Bearer <idToken>` ; le jeton est rafraîchi
  automatiquement. La clé `FB_API_KEY` dans index.html est publique par
  conception.
- **Deux voies d'accès** : `x-app-secret` (code parent, illimité, non compté)
  ou jeton Firebase (quotas). Sans auth → 401 (testé).
- **Metering Firestore** : un doc `usage/{uid}_{AAAA-MM}` par utilisateur et
  par mois, incrément en transaction. Quota gratuit par défaut :
  reformulate 1000, tts 1500, magic 100, image 50 (env `FREE_QUOTA`).
  Dépassement → 429 `quota_epuise` (testé en réel). `users/{uid}.plan`
  ("free"/autre) = futur emplacement des droits payants.
- **Garde-fou global** : doc `usage/_global_{AAAA-MM}`, plafond tous
  utilisateurs (env `GLOBAL_CAP`, image limité à 150/mois) → 429
  `service_sature`. Protège la facture tant qu'App Check n'est pas en place
  (des uid anonymes se créent gratuitement).
- **`GET /v1/me`** : plan + usage du mois (pour l'app / futur paywall).
- Panne du metering = on laisse passer (la disponibilité pour l'enfant prime).

## Phase 5 — faite en partie ✓ (20 juillet 2026)

- **Sécurité contenu (déterministe)** : `safetySettings` EXPLICITES au seuil le
  plus strict (`BLOCK_LOW_AND_ABOVE`, 4 catégories) sur TOUS les appels Vertex
  (texte, magic, image, transcription). Ce sont les classifieurs côté Google
  qui bloquent — pas le prompt. Blocage → 422 `contenu_refuse`, message clair
  dans l'app. Testé en réel : picto « ballon » ✓, demande de nu → 422 ✓.
- **Plans** : `users/{uid}.plan` = `free` (défaut) / `plus` (quotas ×10, env
  `PLUS_QUOTA`) / `unlimited`. Testé (plan plus → quota 10000 dans /v1/me).
  Poser le plan à l'encaissement = il ne manque que l'intégration paiement.
- **Nettoyage fait** : l'app v28 n'a PLUS AUCUN code Gemini-direct (clé API,
  découverte de modèles, replis) — serveur uniquement, replis hors-ligne
  conservés (voix appareil / mots bruts / ARASAAC / émoji). Le cache voix
  garde ses clés `Kore|…` (rien à régénérer).
- **App Check préparé** : app Android `app.leova` enregistrée dans Firebase
  (`1:11414001422:android:f74f27bd33162f5dcd295f`, SHA-1/SHA-256 du keystore
  debug ajoutés, `android/app/google-services.json` posé mais inerte — plugin
  gradle non appliqué).

## Reste à faire

- **App Check (Play Integrity)** : nécessite la distribution via Play Store
  (Play Console) — bloqué tant que l'app n'y est pas publiée. À l'activation :
  plugin gradle google-services + SDK App Check côté app, vérification du
  jeton `X-Firebase-AppCheck` côté serveur (mode observation d'abord).
- **Paiement** : choisir le rail (Play Billing si distribution Play Store —
  obligatoire pour du contenu numérique in-app — sinon Stripe sur le web),
  puis webhook → `users/{uid}.plan = "plus"`.
