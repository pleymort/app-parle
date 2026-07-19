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

## Déployer

```bash
cd backend
gcloud run deploy leova-backend \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=<PROJECT_ID>,VERTEX_LOCATION=europe-west1,APP_SECRET=<un_secret>
```

Donne au compte de service Cloud Run le rôle **Vertex AI User** :
```bash
gcloud projects add-iam-policy-binding <PROJECT_ID> \
  --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

## Tester

```bash
URL=$(gcloud run services describe leova-backend --region europe-west1 --format='value(status.url)')
curl -s -X POST "$URL/v1/reformulate" \
  -H "x-app-secret: <un_secret>" -H "content-type: application/json" \
  -d '{"labels":["Je veux","École"]}'
# -> {"phrase":"Je veux aller à l'école."}
```

## Développement local

```bash
gcloud auth application-default login   # ADC locales
cp .env.example .env                    # renseigner GOOGLE_CLOUD_PROJECT
npm install && node --env-file=.env src/index.js
```

## Reste à faire (suite Phase 3 → 4)

- `/v1/tts` : voix **Kore** (Vertex Gemini TTS) → WAV, **cache Cloud Storage mutualisé**.
- `/v1/magic` (plan d'ajout magique) et `/v1/image` (Imagen + détourage).
- **Auth** : Firebase Auth (anonyme) + App Check, à la place du secret partagé.
- **Metering** par utilisateur (Firestore) + quota gratuit / droits payants.
- Basculer l'app (`index.html`) pour appeler ce backend au lieu de la clé Gemini locale.
