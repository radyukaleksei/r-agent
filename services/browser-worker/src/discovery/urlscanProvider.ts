/**
 * urlscan.io — публичная база миллионов просканированных страниц с полной
 * информацией о том, какие домены/ресурсы каждая страница загружала.
 * Используется как ДОПОЛНИТЕЛЬНЫЙ (к Serper-поиску по GTM/tracking ID)
 * способ находить сайты с общей инфраструктурой: если два сайта оба
 * загружают ресурс с одного и того же внешнего домена (трекер, CDN,
 * API), urlscan позволяет найти все такие сайты одним запросом —
 * без необходимости заранее знать их ключевые слова.
 *
 * API: https://urlscan.io/docs/search/ (Lucene-подобный синтаксис).
 * Без API-ключа работает с урезанной квотой (по IP) — для более
 * стабильной работы задайте URLSCAN_API_KEY (бесплатная регистрация на
 * urlscan.io выдаёт ключ с более высоким лимитом).
 */

export interface UrlscanMatch {
  url: string;
  domain: string;
}

interface UrlscanSearchResponseItem {
  page?: { url?: string; domain?: string };
  task?: { url?: string };
}

interface UrlscanSearchResponse {
  results?: UrlscanSearchResponseItem[];
  total?: number;
}

const URLSCAN_SEARCH_URL = "https://urlscan.io/api/v1/search/";

/**
 * Ищет страницы, при загрузке которых наблюдалось обращение к `domain`
 * (не только сайты, у которых этот домен — основной, но и те, что просто
 * подключают с него скрипт/пиксель/API — это и есть "общая инфраструктура").
 */
export async function findPagesContactingDomain(
  domain: string,
  apiKey: string | undefined,
  limit = 30
): Promise<UrlscanMatch[]> {
  const query = `domain:"${domain}"`;
  const url = `${URLSCAN_SEARCH_URL}?q=${encodeURIComponent(query)}&size=${limit}`;

  const res = await fetch(url, {
    headers: apiKey ? { "API-Key": apiKey } : {},
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    // urlscan отдаёт 429 при превышении квоты — не бросаем ошибку на весь
    // job, просто возвращаем пусто и логируем: это дополняющий источник,
    // а не обязательный.
    console.warn(`[urlscanProvider] ${res.status} для домена ${domain}: ${await res.text()}`);
    return [];
  }

  const data = (await res.json()) as UrlscanSearchResponse;
  const matches = new Map<string, UrlscanMatch>();

  for (const item of data.results ?? []) {
    const pageUrl = item.page?.url ?? item.task?.url;
    const pageDomain = item.page?.domain;
    if (!pageUrl || !pageDomain) continue;
    if (pageDomain === domain) continue; // сам домен-трекер — не результат, а признак поиска
    if (!matches.has(pageDomain)) {
      matches.set(pageDomain, { url: pageUrl, domain: pageDomain });
    }
  }

  return Array.from(matches.values());
}
