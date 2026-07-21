#!/bin/bash
# Publie un bundle (.aab) sur une piste de test Google Play, sans passer par la
# console. Authentification par impersonation du compte de service Cloud Run
# (droits « Release to testing tracks » dans Play Console + Token Creator IAM).
#
# Usage : scripts/play-deploy.sh <chemin.aab> [track] ["notes de version"]
#   track par défaut : internal
set -euo pipefail

AAB="${1:?chemin du .aab requis}"
TRACK="${2:-internal}"
NOTES="${3:-Nouvelle version de test.}"
PKG="app.leova"
SA="11414001422-compute@developer.gserviceaccount.com"
API="https://androidpublisher.googleapis.com/androidpublisher/v3/applications/$PKG"
UP="https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/$PKG"

echo "→ jeton (impersonation $SA)…"
TOKEN=$(gcloud auth print-access-token --impersonate-service-account="$SA" \
  --scopes="https://www.googleapis.com/auth/androidpublisher" 2>/dev/null)
AUTH="Authorization: Bearer $TOKEN"

echo "→ création d'un edit…"
EDIT=$(curl -s -X POST "$API/edits" -H "$AUTH" -H "Content-Length: 0" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['id'])")
echo "  edit=$EDIT"

echo "→ téléversement du bundle ($(du -h "$AAB" | cut -f1))…"
VC=$(curl -s -X POST "$UP/edits/$EDIT/bundles?uploadType=media" -H "$AUTH" \
  -H "Content-Type: application/octet-stream" --data-binary @"$AAB" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['versionCode'])")
echo "  versionCode=$VC"

echo "→ affectation à la piste « $TRACK »…"
curl -s -X PUT "$API/edits/$EDIT/tracks/$TRACK" -H "$AUTH" -H "content-type: application/json" \
  -d "{\"track\":\"$TRACK\",\"releases\":[{\"versionCodes\":[\"$VC\"],\"status\":\"completed\",\"releaseNotes\":[{\"language\":\"fr-FR\",\"text\":\"$NOTES\"}]}]}" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('  track OK') if 'track' in d else sys.exit('  ERREUR: '+json.dumps(d))"

echo "→ validation (commit)…"
curl -s -X POST "$API/edits/$EDIT:commit" -H "$AUTH" -H "Content-Length: 0" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);print('✅ PUBLIÉ sur '+'$TRACK'+' (edit '+d['id']+')') if 'id' in d else sys.exit('  ERREUR commit: '+json.dumps(d))"
