import type { Browser } from "playwright";
import { getDb } from "../firebase/admin";
import type { AnalysisJob, JobType } from "@site-network-agent/types";
import { runSearchGoogleJob } from "./handlers/searchGoogle";
import { runAnalyzeWebsiteJob } from "./handlers/analyzeWebsite";
import { runAnalyzeBatchJob } from "./handlers/analyzeBatch";
import { runFindSimilarJob } from "./handlers/findSimilar";
import { runExpandNetworkJob } from "./handlers/expandNetwork";
import { runBuildClusterJob } from "./handlers/buildCluster";

const WORKER_ID = `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const POLL_INTERVAL_MS = 3000;
const MAX_CONCURRENT_JOBS = 1; // 1 job на инстанс Cloud Run — см. README (Playwright + память)

type Handler = (job: AnalysisJob, browser: Browser) => Promise<void>;

const HANDLERS: Record<JobType, Handler> = {
  SEARCH_GOOGLE: runSearchGoogleJob,
  ANALYZE_WEBSITE: runAnalyzeWebsiteJob,
  ANALYZE_BATCH: runAnalyzeBatchJob,
  FIND_SIMILAR: runFindSimilarJob,
  EXPAND_NETWORK: runExpandNetworkJob,
  BUILD_CLUSTER: runBuildClusterJob,
};

let running = 0;
let shuttingDown = false;

/**
 * Атомарно "забирает" один QUEUED job через Firestore transaction,
 * переводя его в RUNNING. Это предотвращает race condition, когда
 * несколько инстансов worker'а (при масштабировании Cloud Run) заберут
 * один и тот же job одновременно (см. README → "Известные ограничения").
 *
 * Для production под нагрузкой рекомендуется заменить на Cloud Tasks —
 * см. README, раздел "Масштабирование".
 */
async function claimNextJob(): Promise<AnalysisJob | null> {
  const db = getDb();
  const snapshot = await db
    .collection("jobs")
    .where("status", "==", "QUEUED")
    .orderBy("createdAt", "asc")
    .limit(5) // берём несколько кандидатов, т.к. другой инстанс мог успеть забрать первый
    .get();

  for (const doc of snapshot.docs) {
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (fresh.data()?.status !== "QUEUED") return null;
      tx.update(doc.ref, {
        status: "RUNNING",
        workerId: WORKER_ID,
        startedAt: Date.now(),
      });
      return { id: doc.id, ...fresh.data() } as AnalysisJob;
    });
    if (claimed) return claimed;
  }
  return null;
}

async function completeJob(jobId: string, patch: Partial<AnalysisJob>) {
  await getDb().collection("jobs").doc(jobId).update(patch);
}

async function processJob(job: AnalysisJob, browser: Browser) {
  running += 1;
  try {
    const handler = HANDLERS[job.type];
    await handler(job, browser);
    await completeJob(job.id, {
      status: "COMPLETED",
      progress: 100,
      completedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await completeJob(job.id, {
      status: "FAILED",
      error: message,
      completedAt: Date.now(),
    });
    console.error(`[job ${job.id}] failed:`, message);
  } finally {
    running -= 1;
  }
}

export async function startPollingLoop(browser: Browser) {
  console.log(`[jobRunner] запущен, workerId=${WORKER_ID}`);
  while (!shuttingDown) {
    if (running < MAX_CONCURRENT_JOBS) {
      try {
        const job = await claimNextJob();
        if (job) {
          // не await — чтобы продолжить polling пока job выполняется
          // (при MAX_CONCURRENT_JOBS=1 следующий claim всё равно не начнётся,
          // пока не освободится слот — см. цикл ниже)
          processJob(job, browser);
        }
      } catch (err) {
        console.error("[jobRunner] ошибка при захвате job:", err);
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

export function requestShutdown() {
  shuttingDown = true;
}

export function activeJobCount() {
  return running;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
