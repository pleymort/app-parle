// Play Billing : vérification des achats auprès de Google Play et mise à
// jour du plan de l'utilisateur. La source de vérité est TOUJOURS l'API
// androidpublisher — jamais ce que dit le client (ou une notification).
// NB : ces appels échouent tant que le projet GCP n'est pas lié au compte
// Play Console (voir README, partie parent).
import crypto from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import { db, FieldValue } from "./firebase.js";
import { config } from "./config.js";

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/androidpublisher"] });
const BASE =
  "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + config.androidPackage;

async function api(path, method = "GET") {
  const client = await auth.getClient();
  try {
    return (await client.request({ url: BASE + path, method })).data;
  } catch (e) {
    throw new Error("androidpublisher " + (e.response?.status || e.message));
  }
}

const tokenId = (t) => crypto.createHash("sha256").update(t).digest("hex");

// Vérifie l'abonnement chez Google, mémorise token→uid (pour les
// notifications futures) et pose users/{uid}.plan. uid peut être null
// (notification pour un token jamais associé) : on ne touche alors personne.
export async function verifyAndApply(uid, purchaseToken, productId) {
  const sub = await api("/purchases/subscriptionsv2/tokens/" + encodeURIComponent(purchaseToken));
  const active =
    sub.subscriptionState === "SUBSCRIPTION_STATE_ACTIVE" ||
    sub.subscriptionState === "SUBSCRIPTION_STATE_IN_GRACE_PERIOD";
  await db.collection("billing").doc(tokenId(purchaseToken)).set(
    {
      ...(uid ? { uid } : {}),
      productId, purchaseToken,
      state: sub.subscriptionState,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  if (uid) {
    await db.collection("users").doc(uid).set(
      { plan: active ? "plus" : "free", planSource: "play", updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }
  // Achat non confirmé sous 3 jours = remboursé par Google : on confirme ici.
  if (active && sub.acknowledgementState === "ACKNOWLEDGEMENT_STATE_PENDING") {
    await api(
      "/purchases/subscriptions/" + encodeURIComponent(productId) +
        "/tokens/" + encodeURIComponent(purchaseToken) + ":acknowledge",
      "POST"
    ).catch((e) => console.warn("acknowledge:", e.message));
  }
  return { active, state: sub.subscriptionState };
}

// Notification temps réel Play (Pub/Sub push) : renouvellement, annulation,
// expiration… On retrouve le uid via le token déjà vu, puis on re-vérifie.
export async function handleRtdn(body) {
  const data = body?.message?.data;
  if (!data) return;
  const n = JSON.parse(Buffer.from(data, "base64").toString());
  const s = n.subscriptionNotification;
  if (!s?.purchaseToken) return;
  const doc = await db.collection("billing").doc(tokenId(s.purchaseToken)).get();
  const uid = doc.exists ? doc.data().uid : null;
  await verifyAndApply(uid, s.purchaseToken, s.subscriptionId || doc.data()?.productId || "");
}
