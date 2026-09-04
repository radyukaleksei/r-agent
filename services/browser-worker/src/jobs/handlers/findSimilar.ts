import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { computeSimilarity } from "@site-network-agent/shared";
import type { AnalysisJob, Relationship, WebsiteFingerprint } from "@site-network-agent/types";

interface FindSimilarPayload {
  userId: string;
  projectId: string;
  sourceWebsiteIds: string[]; // сайты, для которых искать похожие (кнопка "Искать схожее")
}

/** Ниже этого порога relationship вообще не сохраняется — иначе коллекция будет "шуметь". */
const MIN_STORED_SCORE = 20;

/**
 * Сравнивает fingerprint выбранных сайтов со всеми остальными
 * проанализированными сайтами того же проекта и сохраняет найденные связи
 * в users/{userId}/projects/{projectId}/relationships/{id}.
 *
 * Это O(sourceWebsites × allWebsites) — для MVP приемлемо; при большом числе
 * сайтов в проекте стоит перейти на inverted index по gtmId/trackingId
 * (см. README → "Масштабирование": сначала находим кандидатов через индекс
 * "gtmId → websiteIds", затем считаем score только для кандидатов).
 */
export async function runFindSimilarJob(job: AnalysisJob, _browser: Browser): Promise<void> {
  const payload = job.payload as unknown as FindSimilarPayload;
  const db = getDb();

  const projectRef = db
    .collection("users")
    .doc(payload.userId)
    .collection("projects")
    .doc(payload.projectId);

  const websitesSnap = await projectRef.collection("websites").get();
  const fingerprintsById = new Map<string, WebsiteFingerprint>();

  for (const doc of websitesSnap.docs) {
    const fpSnap = await doc.ref.collection("fingerprint").doc("current").get();
    if (fpSnap.exists) {
      fingerprintsById.set(doc.id, fpSnap.data() as WebsiteFingerprint);
    }
  }

  const relationships: Relationship[] = [];
  const now = Date.now();

  for (const sourceId of payload.sourceWebsiteIds) {
    const sourceFp = fingerprintsById.get(sourceId);
    if (!sourceFp) continue; // сайт ещё не проанализирован — нечего сравнивать

    for (const [targetId, targetFp] of fingerprintsById) {
      if (targetId === sourceId) continue;
      const { score, evidence } = computeSimilarity(sourceFp, targetFp);
      if (score < MIN_STORED_SCORE) continue;

      relationships.push({
        id: `${[sourceId, targetId].sort().join("_")}`, // одна связь на пару, независимо от направления
        projectId: payload.projectId,
        sourceWebsiteId: sourceId,
        targetWebsiteId: targetId,
        score,
        evidence,
        computedAt: now,
      });
    }
  }

  const batch = db.batch();
  for (const rel of relationships) {
    batch.set(projectRef.collection("relationships").doc(rel.id), rel);
  }
  await batch.commit();

  await db.collection("jobs").doc(job.id).update({
    progress: 100,
    processed: relationships.length,
    total: relationships.length,
  });
}
