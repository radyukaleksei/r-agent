import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

function ensureApp() {
  if (getApps().length > 0) return getApps()[0];
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  return serviceAccountJson
    ? initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) })
    : initializeApp();
}

export function db() {
  ensureApp();
  return getFirestore();
}

export function auth() {
  ensureApp();
  return getAuth();
}
