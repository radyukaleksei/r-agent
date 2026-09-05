import type { Browser } from "playwright";
import { getDb } from "../../firebase/admin";
import { SerperSearchProvider } from "../../google/searchProvider";
import { findPagesContactingDomain } from "../../discovery/urlscanProvider";
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
 * "Расширить сеть": ДВА независимых, дополняющих друг друга источника
 * кандидатов на основе технических признаков уже найденных сайтов:
 *
 *  1. Serper (Google Search) по литеральным GTM ID / tracking ID —
 *     находит сайты, если их ID где-то упоминается в открытом тексте
 *     (форумы, сравнительные сервисы и т.п.).
 *  2. urlscan.io по внешним доменам (fp.externalDomains) — находит сайты,
 *     которые ЗАГРУЖАЮТ ресурс с того же внешнего домена (трекер, общий
 *     API, CDN конкретного поставщика), даже если нигде не упоминают его
 *     текстом — это твоя просьба "искать сайты у которых в адресах
 *     картинок/библиотек внешние домены".
 *
 * ВАЖНО об ограничениях (честно, как и просили в ТЗ):
 *  - Ни один из источников не гарантирует найти ВСЕ связанные сайты —
 *    это дополняющие сигналы, а не исчерпывающий обход.
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

  const serperApiKey = process.env.SERPER_API_KEY;
  if (!serperApiKey) throw new Error("SERPER_API_KEY не сконфигурирован");
  const searchProvider = new SerperSearchProvider(serperApiKey);
  const urlscanApiKey = process.env.URLSCAN_API_KEY; // опционально — без ключа работает с урезанной квотой

  // Собираем известные домены проекта, чтобы не заводить дубликаты сайтов.
  const existingSnap = await projectRef.collection("websites").get();
  const knownDomains = new Set(existingSnap.docs.map((d) => d.data().domain as string));

  const textQueries = new Set<string>();
  const domainQueries = new Set<string>();

  for (const sourceId of payload.sourceWebsiteIds) {
    const fpSnap = await projectRef
      .collection("websites")
      .doc(sourceId)
      .collection("fingerprint")
      .doc("current")
      .get();
    if (!fpSnap.exists) continue;
    const fp = fpSnap.data() as WebsiteFingerprint;

    // Самые "сильные" уникальные идентификаторы — приоритет для текстового поиска.
    for (const gtmId of fp.gtmIds) textQueries.add(`"${gtmId}"`);
    for (const trackingId of fp.trackingIds.slice(0, 3)) {
      textQueries.add(`"${trackingId.split(":").pop()}"`);
    }
    // Внешние домены (уже без общих CDN — см. buildFingerprint) — источник
    // для urlscan.io.
    for (const domain of fp.externalDomains.slice(0, 5)) domainQueries.add(domain);
  }

  const newWebsiteIds: string[] = [];
  const batch = db.batch();
  const now = Date.now();

  const addCandidate = (rawUrl: string) => {
    let normalized: string;
    let domain: string;
    try {
      normalized = normalizeUrl(rawUrl);
      domain = getRegistrableDomain(new URL(normalized).hostname);
    } catch {
      return;
    }
    if (knownDomains.has(domain)) return;
    knownDomains.add(domain);

    const ref = projectRef.collection("websites").doc();
    newWebsiteIds.push(ref.id);
    batch.set(ref, {
      id: ref.id,
      projectId: payload.projectId,
      url: rawUrl,
      normalizedUrl: normalized,
      domain,
      status: "PENDING",
      discoveredFromSearchId: null,
      discoveredAtDepth: payload.depth,
      lastAnalyzedAt: null,
      createdAt: now,
    });
  };

  // Источник 1: текстовый поиск по литеральным ID.
  for (const query of textQueries) {
    const results = await searchProvider.search({
      keywords: query,
      country: payload.country,
      language: payload.language,
      device: payload.device,
      page: 1,
    });
    for (const result of results) addCandidate(result.url);
  }

  // Источник 2: urlscan.io по общим внешним доменам.
  for (const domain of domainQueries) {
    const matches = await findPagesContactingDomain(domain, urlscanApiKey);
    for (const match of matches) addCandidate(match.url);
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

