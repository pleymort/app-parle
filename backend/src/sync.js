// Sauvegarde / synchronisation du vocabulaire (bucket privé UE).
//
// Un objet JSON par PROFIL (et non plus par compte) : profiles/{pid}.json.
// Les photos des cartes (data URLs) vivent dedans — d'où un bucket plutôt
// qu'un doc Firestore, limité à 1 Mo.
//
// ÉCRITURE CONDITIONNELLE : tant qu'un seul appareil écrivait, « dernier
// écrivain gagne » suffisait. Dès qu'une orthophoniste peut modifier le
// tableau en même temps que le parent, ce modèle fait DISPARAÎTRE
// silencieusement le travail de l'un des deux. On s'appuie donc sur la
// génération GCS : le client renvoie celle qu'il a lue, et le serveur refuse
// (409) si elle a bougé entre-temps.
import { Storage } from "@google-cloud/storage";
import { db, FieldValue } from "./firebase.js";
import { config } from "./config.js";

const bucket = new Storage().bucket(config.syncBucket);
const profileFile = (pid) => bucket.file("profiles/" + pid + ".json");
// Ancien emplacement, antérieur à la séparation compte/profil.
const legacyFile = (uid) => bucket.file(uid + ".json");

export class ConflictError extends Error {
  constructor(current) { super("conflit"); this.current = current; }
}

async function readFile(f) {
  const [exists] = await f.exists();
  if (!exists) return null;
  const [buf, meta] = await Promise.all([f.download(), f.getMetadata()]);
  const j = JSON.parse(buf.toString());
  return { state: j.state, rev: j.rev, gen: String(meta[0].generation) };
}

/**
 * Lit la sauvegarde d'un profil. Si elle n'existe pas encore et qu'il s'agit
 * du profil personnel du compte, on récupère l'ancienne sauvegarde {uid}.json
 * et on la recopie : la migration est transparente pour l'utilisateur.
 */
export async function getSync(pid, uid) {
  const cur = await readFile(profileFile(pid));
  if (cur) return cur;
  if (uid && pid === "p_" + uid) {
    const old = await readFile(legacyFile(uid));
    if (old) {
      await profileFile(pid).save(JSON.stringify({ state: old.state, rev: old.rev }), {
        contentType: "application/json",
      });
      return await readFile(profileFile(pid));
    }
  }
  return null;
}

/**
 * Écrit la sauvegarde. `gen` est la génération lue par le client :
 *  - une chaîne  → l'écriture n'aboutit que si le fichier n'a pas changé ;
 *  - "0"         → le client croit le fichier inexistant ;
 *  - undefined   → écriture inconditionnelle (clients antérieurs à la phase A).
 */
export async function putSync(pid, state, rev, gen) {
  const opts = { contentType: "application/json" };
  if (gen !== undefined && gen !== null) {
    opts.preconditionOpts = { ifGenerationMatch: Number(gen) };
  }
  try {
    await profileFile(pid).save(JSON.stringify({ state, rev }), opts);
  } catch (e) {
    // 412 = la génération attendue ne correspond plus : quelqu'un d'autre a
    // écrit entre la lecture et l'écriture de ce client.
    if (e && (e.code === 412 || e.status === 412)) {
      throw new ConflictError(await readFile(profileFile(pid)));
    }
    throw e;
  }
  await db.collection("profiles").doc(pid).set(
    { vocabRev: rev, vocabAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  const meta = await profileFile(pid).getMetadata();
  return String(meta[0].generation);
}

/** Purge complète d'un profil (droit à l'effacement). */
export async function deleteSync(pid) {
  await profileFile(pid).delete({ ignoreNotFound: true });
}
