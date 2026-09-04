"use client";

import { doc, getFirestore, onSnapshot } from "firebase/firestore";
import { firebaseApp } from "./firebaseClient";
import type { AnalysisJob } from "@site-network-agent/types";

const firestore = getFirestore(firebaseApp);

export function subscribeToJob(jobId: string, onChange: (job: AnalysisJob) => void) {
  return onSnapshot(doc(firestore, "jobs", jobId), (snap) => {
    if (snap.exists()) onChange(snap.data() as AnalysisJob);
  });
}

/**
 * Ждёт завершения job'а через Firestore onSnapshot (не polling HTTP —
 * jobs/{jobId} разрешён на чтение владельцу напрямую правилами, см.
 * firestore.rules). Это и есть "Realtime UI" из исходного ТЗ по инфраструктуре.
 */
export function waitForJobCompletion(jobId: string, timeoutMs = 120_000): Promise<AnalysisJob> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Превышено время ожидания job'а"));
    }, timeoutMs);

    const unsubscribe = subscribeToJob(jobId, (job) => {
      if (job.status === "COMPLETED") {
        clearTimeout(timeout);
        unsubscribe();
        resolve(job);
      } else if (job.status === "FAILED" || job.status === "CANCELLED") {
        clearTimeout(timeout);
        unsubscribe();
        reject(new Error(job.error ?? `Job ${job.status}`));
      }
    });
  });
}
