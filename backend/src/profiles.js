// Profils et appartenances.
//
// Jusqu'ici le COMPTE ÉTAIT L'ENFANT : la sauvegarde vivait dans {uid}.json.
// Partager l'accès à un professionnel serait revenu à partager le mot de passe.
// On sépare donc trois notions : un COMPTE (une personne), un PROFIL (un
// enfant) et une APPARTENANCE (un compte × un profil × un rôle).
//
// Effet de bord voulu : un parent peut avoir plusieurs enfants, et une
// orthophoniste peut suivre plusieurs enfants depuis une seule tablette.
import { randomBytes } from "node:crypto";
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
/** Mémorise l'e-mail du compte : c'est ce que le parent verra dans la liste
    des personnes ayant accès au profil de son enfant. */
export async function touchAccount(uid, email) {
  if (!email) return;
  await db.collection("accounts").doc(uid).set(
    { email, seenAt: FieldValue.serverTimestamp() }, { merge: true });
}

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

/* ---- Invitations ----
   Un code court, lisible à voix haute au téléphone, à usage unique et de
   courte durée. Alphabet sans caractères confondables (ni O/0, ni I/1). */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

function newCode() {
  return Array.from(randomBytes(6), (n) => ALPHABET[n % ALPHABET.length]).join("");
}

export async function createInvite(pid, role, scopes, byUid) {
  // Une collision est très improbable, mais elle donnerait l'accès au mauvais
  // enfant : on vérifie, et on retente.
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const ref = db.collection("invites").doc(code);
    const created = await db.runTransaction(async (t) => {
      if ((await t.get(ref)).exists) return false;
      t.set(ref, {
        pid, role, scopes: scopes || {}, createdBy: byUid,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: Date.now() + INVITE_TTL_MS,
        usedBy: null,
      });
      return true;
    });
    if (created) return { code, expiresAt: Date.now() + INVITE_TTL_MS };
  }
  throw new Error("code_indisponible");
}

/** Consomme un code et rattache le compte au profil. */
export async function acceptInvite(code, uid) {
  const ref = db.collection("invites").doc(String(code).toUpperCase().trim());
  const inv = await db.runTransaction(async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists) throw new Error("code_inconnu");
    const d = snap.data();
    if (d.usedBy) throw new Error("code_deja_utilise");
    if (d.expiresAt < Date.now()) throw new Error("code_expire");
    if (d.createdBy === uid) throw new Error("code_propre_compte");
    t.update(ref, { usedBy: uid, usedAt: FieldValue.serverTimestamp() });
    return d;
  });
  await addMember(inv.pid, uid, inv.role, inv.scopes, inv.createdBy);
  const p = await db.collection("profiles").doc(inv.pid).get();
  return { pid: inv.pid, role: inv.role, name: p.get("name") };
}

/** Qui a accès à ce profil. Les superviseurs se voient entre eux (décision
    produit) : une équipe autour d'un enfant doit se connaître. */
export async function listMembers(pid) {
  const snap = await db.collection("profiles").doc(pid).collection("members").get();
  const out = [];
  for (const d of snap.docs) {
    const a = await db.collection("accounts").doc(d.id).get();
    out.push({
      uid: d.id, role: d.get("role"), scopes: d.get("scopes") || {},
      email: a.exists ? a.get("email") || null : null,
      acceptedAt: d.get("acceptedAt") ? d.get("acceptedAt").toMillis() : null,
    });
  }
  return out;
}
