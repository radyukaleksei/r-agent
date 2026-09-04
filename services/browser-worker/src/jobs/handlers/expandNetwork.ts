import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { SerperSearchProvider } from "../../google/searchProvider";
import { normalizeUrl, getRegistrableDomain } from "@site-network-agent/shared";
import type { AnalysisJob, Device, WebsiteFingerprint } from "@site-network-agent/types";

interface ExpandNetworkPayload {
  userId: string;
  projectId: string;
  sourceWebsiteIds: string[];
  depth: number; // оставшаяся глубина расширения, см. п.8 ТЗ ("Depth: 1/2/3")
  device: Device;
  country: string;
  language: string;
}

/**
 * "Расширить сеть": берёт наиболее характерные признаки уже найденных
 * сайтов (GTM ID, tracking ID) и использует их как поисковые запросы —
 * это известная OSINT-техника: сайты, использующие один и тот же
 * GTM-XXXXXXX или UA-XXXXXXXX-X, нередко упоминают его в открытых
 * источниках (форумы, репозитории, сравнительные сервисы), либо сам ID
 * можно найти через обычный поиск по фразе.
 *
 * ВАЖНО об ограничениях (честно, как и просили в ТЗ):
 *  - Поиск по литеральному ID не гарантирует найти ВСЕ связанные сайты —
 *    это дополняющий сигнал, а не исчерпывающий обход.
 *  - Каждый новый найденный кандидат добавляется в websites со статусом
 *    PENDING и ставится в очередь на ANALYZE_BATCH — этот job НЕ анализирует
 *    их сам, чтобы не блокировать долгим выполнением один Cloud Run вызов.
 *  - Рекурсивное продолжение на следующую глубину (depth-1) запускается
 *    ПОСЛЕ завершения анализа новых сайтов — в MVP это делает вызывающая
 *    сторона (API route), создавая следующий EXPAND_NETWORK job по факту
 *    завершения ANALYZE_BATCH. Полная автоматическая цепочка через
 *    Firestore-триггеры — см. README → "Масштабирование".
 */
export async function runExpandNetworkJob(job: AnalysisJob, _browser: Browser): Promise<void> {
  const payload = job.payload as unknown as ExpandNetworkPayload;
  if (payload.depth < 1) return;

  const db = getDb();
  const projectRef = db
    .collection("users")
    .doc(payload.userId)
    .collection("projects")
    .doc(payload.projectId);

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("SERPER_API_KEY не сконфигурирован");
  const provider = new SerperSearchProvider(apiKey);

  // Собираем известные домены проекта, чтобы не заводить дубликаты сайтов.
  const existingSnap = await projectRef.collection("websites").get();
  const knownDomains = new Set(existingSnap.docs.map((d) => d.data().domain as string));

  const queries = new Set<string>();
  for (const sourceId of payload.sourceWebsiteIds) {
    const fpSnap = await projectRef
      .collection("websites")
      .doc(sourceId)
      .collection("fingerprint")
      .doc("current")
      .get();
    if (!fpSnap.exists) continue;
    const fp = fpSnap.data() as WebsiteFingerprint;

    // Самые "сильные" уникальные идентификаторы — приоритет для поиска.
    for (const gtmId of fp.gtmIds) queries.add(`"${gtmId}"`);
    for (const trackingId of fp.trackingIds.slice(0, 3)) {
      queries.add(`"${trackingId.split(":").pop()}"`);
    }
  }

  const newWebsiteIds: string[] = [];
  const batch = db.batch();
  const now = Date.now();

  for (const query of queries) {
    const results = await provider.search({
      keywords: query,
      country: payload.country,
      language: payload.language,
      device: payload.device,
      page: 1,
    });

    for (const result of results) {
      const normalized = normalizeUrl(result.url);
      const domain = getRegistrableDomain(new URL(normalized).hostname);
      if (knownDomains.has(domain)) continue;
      knownDomains.add(domain);

      const ref = projectRef.collection("websites").doc();
      newWebsiteIds.push(ref.id);
      batch.set(ref, {
        id: ref.id,
        projectId: payload.projectId,
        url: result.url,
        normalizedUrl: normalized,
        domain,
        status: "PENDING",
        discoveredFromSearchId: null,
        discoveredAtDepth: payload.depth,
        lastAnalyzedAt: null,
        createdAt: now,
      });
    }
  }

  await batch.commit();

  if (newWebsiteIds.length > 0) {
    await db.collection("jobs").add({
      userId: payload.userId,
      projectId: payload.projectId,
      type: "ANALYZE_BATCH",
      status: "QUEUED",
      progress: 0,
      total: newWebsiteIds.length,
      processed: 0,
      error: null,
      payload: {
        userId: payload.userId,
        projectId: payload.projectId,
        websiteIds: newWebsiteIds,
        device: payload.device,
        country: payload.country,
        language: payload.language,
      },
      createdAt: now,
      startedAt: null,
      completedAt: null,
    });
  }

  await db.collection("jobs").doc(job.id).update({
    progress: 100,
    processed: newWebsiteIds.length,
    total: newWebsiteIds.length,
  });
}
