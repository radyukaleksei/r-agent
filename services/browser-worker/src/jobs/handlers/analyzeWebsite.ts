import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { analyzeWebsite } from "../../analyzers/pageAnalyzer";
import type { AnalysisJob, Device } from "@site-network-agent/types";

interface AnalyzeWebsitePayload {
  userId: string;
  projectId: string;
  websiteId: string;
  url: string;
  device: Device;
  country: string;
  language: string;
}

/**
 * Анализирует один сайт и сохраняет все найденные сущности в
 * подколлекции users/{userId}/projects/{projectId}/websites/{websiteId}/*.
 */
export async function runAnalyzeWebsiteJob(job: AnalysisJob, browser: Browser): Promise<void> {
  const payload = job.payload as unknown as AnalyzeWebsitePayload;
  const db = getDb();

  const websiteRef = db
    .collection("users")
    .doc(payload.userId)
    .collection("projects")
    .doc(payload.projectId)
    .collection("websites")
    .doc(payload.websiteId);

  await websiteRef.update({ status: "ANALYZING" });

  const result = await analyzeWebsite(browser, payload.url, {
    device: payload.device,
    country: payload.country,
    language: payload.language,
    respectRobotsTxt: true,
  });

  const withWebsiteId = <T extends { websiteId: string }>(items: T[]) =>
    items.map((i) => ({ ...i, websiteId: payload.websiteId }));

  const batch = db.batch();

  batch.update(websiteRef, {
    status: result.status,
    httpStatus: result.httpStatus ?? null,
    finalUrl: result.finalUrl ?? null,
    lastAnalyzedAt: Date.now(),
  });

  for (const gtm of withWebsiteId(result.gtmContainers)) {
    batch.set(websiteRef.collection("gtmContainers").doc(gtm.gtmId), gtm);
  }
  for (const tracking of withWebsiteId(result.trackingIdentifiers)) {
    batch.set(websiteRef.collection("trackingIdentifiers").doc(), tracking);
  }
  for (const script of withWebsiteId(result.scripts)) {
    batch.set(websiteRef.collection("scripts").doc(script.contentHash), script);
  }
  for (const resource of withWebsiteId(result.externalResources)) {
    batch.set(websiteRef.collection("externalResources").doc(), resource);
  }
  for (const endpoint of withWebsiteId(result.endpoints)) {
    batch.set(websiteRef.collection("endpoints").doc(), endpoint);
  }
  if (result.fingerprint) {
    batch.set(websiteRef.collection("fingerprint").doc("current"), {
      ...result.fingerprint,
      websiteId: payload.websiteId,
    });
  }

  await batch.commit();

  await db.collection("jobs").doc(job.id).update({ progress: 100, processed: 1, total: 1 });
}
