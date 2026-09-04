import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { analyzeWebsite } from "../../analyzers/pageAnalyzer";
import type { AnalysisJob, Device } from "@site-network-agent/types";

interface AnalyzeBatchPayload {
  userId: string;
  projectId: string;
  websiteIds: string[];
  device: Device;
  country: string;
  language: string;
}

const CONCURRENCY = 3; // одновременных browser context в рамках одного job'а

/**
 * Массовый анализ нескольких сайтов (кнопка "выбрать несколько → Анализ").
 * Обрабатывает сайты пачками, обновляя progress/processed по ходу —
 * это то, что видит progress bar на фронтенде (см. п.8/16 ТЗ, "Realtime UI").
 */
export async function runAnalyzeBatchJob(job: AnalysisJob, browser: Browser): Promise<void> {
  const payload = job.payload as unknown as AnalyzeBatchPayload;
  const db = getDb();
  const jobRef = db.collection("jobs").doc(job.id);

  const websitesCol = db
    .collection("users")
    .doc(payload.userId)
    .collection("projects")
    .doc(payload.projectId)
    .collection("websites");

  let processed = 0;
  const total = payload.websiteIds.length;
  await jobRef.update({ total });

  for (let i = 0; i < payload.websiteIds.length; i += CONCURRENCY) {
    const chunk = payload.websiteIds.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (websiteId) => {
        const websiteRef = websitesCol.doc(websiteId);
        const websiteSnap = await websiteRef.get();
        const url = websiteSnap.data()?.url as string | undefined;
        if (!url) return;

        await websiteRef.update({ status: "ANALYZING" });
        const result = await analyzeWebsite(browser, url, {
          device: payload.device,
          country: payload.country,
          language: payload.language,
          respectRobotsTxt: true,
        });

        const batch = db.batch();
        batch.update(websiteRef, {
          status: result.status,
          httpStatus: result.httpStatus ?? null,
          finalUrl: result.finalUrl ?? null,
          lastAnalyzedAt: Date.now(),
        });
        for (const gtm of result.gtmContainers) {
          batch.set(websiteRef.collection("gtmContainers").doc(gtm.gtmId), {
            ...gtm,
            websiteId,
          });
        }
        for (const resource of result.externalResources) {
          batch.set(websiteRef.collection("externalResources").doc(), {
            ...resource,
            websiteId,
          });
        }
        if (result.fingerprint) {
          batch.set(websiteRef.collection("fingerprint").doc("current"), {
            ...result.fingerprint,
            websiteId,
          });
        }
        await batch.commit();
      })
    );

    processed += chunk.length;
    await jobRef.update({
      processed,
      progress: Math.round((processed / total) * 100),
    });
  }
}
