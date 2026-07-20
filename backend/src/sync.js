// Sauvegarde / synchronisation du vocabulaire (bucket privé UE).
// Un objet JSON par utilisateur : {state, rev}. Résolution de conflit simple :
// dernier écrivain gagne (rev = horodatage côté app). Les photos des cartes
// (data URLs) vivent dedans — d'où un bucket plutôt qu'un doc Firestore (1 Mo max).
import { Storage } from "@google-cloud/storage";
import { db, FieldValue } from "./firebase.js";
import { config } from "./config.js";

const bucket = new Storage().bucket(config.syncBucket);
const file = (uid) => bucket.file(uid + ".json");

export async function getSync(uid) {
  const [exists] = await file(uid).exists();
  if (!exists) return null;
  const [buf] = await file(uid).download();
  return JSON.parse(buf.toString());
}

export async function putSync(uid, state, rev) {
  await file(uid).save(JSON.stringify({ state, rev }), {
    contentType: "application/json",
  });
  await db.collection("users").doc(uid).set(
    { vocabRev: rev, vocabAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}
