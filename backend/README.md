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

## Reste à faire (Phase 4)

- **Auth** : Firebase Auth (anonyme) + App Check, à la place du secret partagé.
- **Metering** par utilisateur (Firestore) + quota gratuit / droits payants.
- Nettoyage : retirer à terme le code Gemini-direct de l'app.
