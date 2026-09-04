import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { GoogleProgrammableSearchProvider } from "../../google/searchProvider";
import { normalizeUrl } from "@site-network-agent/shared";
import type { AnalysisJob, Device, SearchResultItem } from "@site-network-agent/types";

interface SearchGooglePayload {
  userId: string;
  projectId: string;
  searchId: string;
  keywords: string;
  country: string;
  language: string;
  device: Device;
}

/**
 * Получает первые 2 страницы Google (до 20 результатов) через Custom Search
 * JSON API, нормализует и дедуплицирует URL, сохраняет в
 * users/{userId}/projects/{projectId}/searches/{searchId}/results/{id}.
 */
export async function runSearchGoogleJob(job: AnalysisJob, _browser: Browser): Promise<void> {
  const payload = job.payload as unknown as SearchGooglePayload;
  const db = getDb();

  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cx) {
    throw new Error("GOOGLE_CSE_API_KEY / GOOGLE_CSE_ID не сконфигурированы");
  }

  const provider = new GoogleProgrammableSearchProvider(apiKey, cx);
  const seenUrls = new Set<string>();
  const allResults: SearchResultItem[] = [];

  for (const page of [1, 2] as const) {
    const items = await provider.search({
      keywords: payload.keywords,
      country: payload.country,
      language: payload.language,
      device: payload.device,
      page,
    });

    for (const item of items) {
      const normalized = normalizeUrl(item.url);
      if (seenUrls.has(normalized)) continue; // защита от дублей
      seenUrls.add(normalized);
      allResults.push({ ...item, normalizedUrl: normalized, searchId: payload.searchId });
    }
  }

  const resultsRef = db
    .collection("users")
    .doc(payload.userId)
    .collection("projects")
    .doc(payload.projectId)
    .collection("searches")
    .doc(payload.searchId)
    .collection("results");

  const batch = db.batch();
  for (const result of allResults) {
    batch.set(resultsRef.doc(), result);
  }
  await batch.commit();

  await db.collection("jobs").doc(job.id).update({
    progress: 100,
    processed: allResults.length,
    total: allResults.length,
  });
}
