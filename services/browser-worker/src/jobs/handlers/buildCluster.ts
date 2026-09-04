import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { buildClusters } from "@site-network-agent/shared";
import type { AnalysisJob, Relationship } from "@site-network-agent/types";

interface BuildClusterPayload {
  userId: string;
  projectId: string;
  minEdgeScore?: number;
}

/**
 * Пересобирает кластеры проекта с нуля из текущих Relationship-документов.
 * Простой и предсказуемый подход для MVP (см. п.7 ТЗ); инкрементальное
 * обновление кластеров при добавлении одного нового сайта — оптимизация
 * на будущее (см. README → "Масштабирование").
 */
export async function runBuildClusterJob(job: AnalysisJob, _browser: Browser): Promise<void> {
  const payload = job.payload as unknown as BuildClusterPayload;
  const db = getDb();
  const projectRef = db
    .collection("users")
    .doc(payload.userId)
    .collection("projects")
    .doc(payload.projectId);

  const [websitesSnap, relationshipsSnap] = await Promise.all([
    projectRef.collection("websites").get(),
    projectRef.collection("relationships").get(),
  ]);

  const websiteIds = websitesSnap.docs.map((d) => d.id);
  const relationships = relationshipsSnap.docs.map((d) => d.data() as Relationship);

  const clusters = buildClusters(websiteIds, relationships, payload.projectId, {
    minEdgeScore: payload.minEdgeScore ?? 50,
  });

  // Удаляем старые кластеры перед записью новых (простая стратегия "replace all").
  const oldClustersSnap = await projectRef.collection("clusters").get();
  const batch = db.batch();
  for (const doc of oldClustersSnap.docs) batch.delete(doc.ref);
  for (const cluster of clusters) {
    batch.set(projectRef.collection("clusters").doc(cluster.id), cluster);
  }
  await batch.commit();

  await db.collection("jobs").doc(job.id).update({
    progress: 100,
    processed: clusters.length,
    total: clusters.length,
  });
}
