// Metering par utilisateur (Firestore) + garde-fou global.
// Un doc par uid et par mois : usage/{uid}_{AAAA-MM} avec un compteur par
// fonction. Un doc _global_{AAAA-MM} borne le total tous utilisateurs
// confondus (protège la facture tant qu'App Check n'est pas en place —
// des uid anonymes se créent gratuitement).
import { db, FieldValue } from "./firebase.js";
import { config } from "./config.js";

const month = () => new Date().toISOString().slice(0, 7); // "2026-07"

// Vérifie le quota puis incrémente, en transaction. feature :
// "reformulate" | "tts" | "magic" | "image".
export async function checkAndCount(uid, feature) {
  const m = month();
  const userRef = db.collection("usage").doc(`${uid}_${m}`);
  const globalRef = db.collection("usage").doc(`_global_${m}`);
  const planRef = db.collection("users").doc(uid);
  return db.runTransaction(async (t) => {
    const [u, g, p] = await Promise.all([t.get(userRef), t.get(globalRef), t.get(planRef)]);
    const used = (u.exists && u.data()[feature]) || 0;
    const gUsed = (g.exists && g.data()[feature]) || 0;
    const plan = (p.exists && p.data().plan) || "free";
    if (gUsed >= config.globalCap[feature]) return { ok: false, reason: "global_cap" };
    const quota = config.freeQuota[feature];
    if (plan === "free" && used >= quota) return { ok: false, reason: "quota", used, quota };
    const inc = { [feature]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() };
    t.set(userRef, inc, { merge: true });
    t.set(globalRef, inc, { merge: true });
    return { ok: true, used: used + 1, quota, plan };
  });
}

// Usage du mois courant pour /v1/me (affichage côté app, futur paywall).
export async function getUsage(uid) {
  const [u, p] = await Promise.all([
    db.collection("usage").doc(`${uid}_${month()}`).get(),
    db.collection("users").doc(uid).get(),
  ]);
  const d = u.exists ? u.data() : {};
  const usage = {};
  for (const f of Object.keys(config.freeQuota)) {
    usage[f] = { used: d[f] || 0, quota: config.freeQuota[f] };
  }
  return { plan: (p.exists && p.data().plan) || "free", month: month(), usage };
}
