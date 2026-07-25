// Profils et appartenances.
//
// Jusqu'ici le COMPTE ÉTAIT L'ENFANT : la sauvegarde vivait dans {uid}.json.
// Partager l'accès à un professionnel serait revenu à partager le mot de passe.
// On sépare donc trois notions : un COMPTE (une personne), un PROFIL (un
// enfant) et une APPARTENANCE (un compte × un profil × un rôle).
//
// Effet de bord voulu : un parent peut avoir plusieurs enfants, et une
// orthophoniste peut suivre plusieurs enfants depuis une seule tablette.
import { db, FieldValue } from "./firebase.js";

export const OWNER_SCOPES = { vocab: true, journal: true, notes: true };

// Le profil « historique » d'un compte, celui créé par la migration.
export const selfPid = (uid) => "p_" + uid;

const memberRef = (pid, uid) =>
  db.collection("profiles").doc(pid).collection("members").doc(uid);
// Index inverse : lister les profils d'un compte sans requête collectionGroup
// (qui exigerait un index composite à provisionner).
const backRef = (uid, pid) =>
  db.collection("accounts").doc(uid).collection("profiles").doc(pid);

export async function addMember(pid, uid, role, scopes, invitedBy) {
  const batch = db.batch();
  batch.set(memberRef(pid, uid), {
    uid, role, scopes: scopes || {}, invitedBy: invitedBy || null,
    acceptedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  batch.set(backRef(uid, pid), { role, addedAt: FieldValue.serverTimestamp() }, { merge: true });
  await batch.commit();
}

export async function removeMember(pid, uid) {
  const batch = db.batch();
  batch.delete(memberRef(pid, uid));
  batch.delete(backRef(uid, pid));
  await batch.commit();
}

/** Crée le profil personnel du compte s'il n'existe pas encore (migration). */
export async function ensureSelfProfile(uid) {
  const pid = selfPid(uid);
  const ref = db.collection("profiles").doc(pid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
      ownerUid: uid, name: null, createdAt: FieldValue.serverTimestamp(),
    });
    await addMember(pid, uid, "owner", OWNER_SCOPES, null);
  }
  return pid;
}

/** Appartenance d'un compte à un profil, ou null s'il n'y a aucun accès. */
export async function membership(uid, pid) {
  const m = await memberRef(pid, uid).get();
  return m.exists ? m.data() : null;
}

/** Tous les profils auxquels ce compte a accès, avec son rôle. */
export async function listProfiles(uid) {
  const snap = await db.collection("accounts").doc(uid).collection("profiles").get();
  const out = [];
  for (const d of snap.docs) {
    const p = await db.collection("profiles").doc(d.id).get();
    if (!p.exists) continue; // profil supprimé : l'index inverse traîne
    out.push({ pid: d.id, role: d.get("role"), name: p.get("name"), ownerUid: p.get("ownerUid") });
  }
  return out;
}

/** Peut-il écrire le vocabulaire de ce profil ? */
export const canWriteVocab = (m) => !!m && (m.role === "owner" || m.role === "editor");
/** Peut-il le lire ? (un viewer voit le tableau : c'est le minimum pour modeler) */
export const canReadVocab = (m) => !!m && m.scopes?.vocab !== false;
