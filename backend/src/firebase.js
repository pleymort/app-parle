// Firebase Admin : vérification des jetons d'identité + accès Firestore.
// Sur Cloud Run, les identifiants viennent du compte de service (ADC).
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { config } from "./config.js";

const app = initializeApp({ projectId: config.project });
export const db = getFirestore(app);
export { FieldValue };

// "Bearer <idToken>" -> uid, ou null si absent/invalide/expiré.
export async function verifyToken(header) {
  if (!header || !header.startsWith("Bearer ")) return null;
  try {
    return (await getAuth(app).verifyIdToken(header.slice(7))).uid;
  } catch {
    return null;
  }
}
