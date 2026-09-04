import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Credentials НИКОГДА не хранятся в Firestore и не коммитятся в репозиторий
 * (см. .env.example и README → Secrets). В Cloud Run рекомендуется:
 *  - либо смонтировать service account через Google Cloud Secret Manager,
 *  - либо (предпочтительно) вообще не передавать явные credentials и
 *    положиться на встроенный Application Default Credentials конкретного
 *    Cloud Run service account с ролями, ограниченными конкретному проекту.
 */
let app: App;

export function getFirebaseApp(): App {
  if (getApps().length > 0) return getApps()[0];

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  app = serviceAccountJson
    ? initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) })
    : initializeApp(); // Application Default Credentials (рекомендуется для Cloud Run)

  return app;
}

export function getDb(): Firestore {
  getFirebaseApp();
  return getFirestore();
}
