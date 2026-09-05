import type { Device, SearchResultItem } from "@site-network-agent/types";

export interface SearchProviderQuery {
  keywords: string;
  country: string; // ISO 3166-1 alpha-2
  language: string; // BCP-47
  device: Device;
  page: 1 | 2; // Google SERP page (1 = позиции 1-10, 2 = позиции 11-20)
}

export interface SearchProvider {
  search(query: SearchProviderQuery): Promise<SearchResultItem[]>;
}

/**
 * ОСНОВНОЙ провайдер поиска — Serper.dev.
 *
 * Почему не Google Custom Search JSON API (как планировалось изначально):
 * Google больше не позволяет НОВЫМ Programmable Search Engine включать режим
 * "искать по всему интернету" — эта возможность оставлена только движкам,
 * созданным давно (см. официальную справку Google: "you have the option to
 * set your custom search engine to search the entire web (no new creation
 * supported)"). Для новых engine'ов доступен только поиск по явно
 * перечисленным доменам (до 50 штук) — это не подходит для задачи "искать
 * произвольные сайты по ключевым словам".
 *
 * Serper.dev — это сторонний сервис, который отдаёт результаты обычной
 * Google-выдачи (organic results) в виде JSON. Регистрация даёт 2500
 * бесплатных запросов, дальше — платно (~$0.30-1 за 1000 запросов на
 * момент написания). Ограничения:
 *  - это сторонний посредник, а не официальный Google API — при больших
 *    объёмах стоит свериться с их условиями использования;
 *  - как и у Google CSE, нет официального разделения на "мобильную" и
 *    "десктопную" выдачу.
 */
export class SerperSearchProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: SearchProviderQuery): Promise<SearchResultItem[]> {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: query.keywords,
        gl: query.country.toLowerCase(),
        hl: query.language,
        num: 10,
        page: query.page,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Serper API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as {
      organic?: { link: string; title: string; snippet?: string; position: number }[];
    };

    // ВАЖНО: поле `position` в ответе Serper нумеруется ЗАНОВО с 1 на каждой
    // "странице" (page=1 → 1..10, page=2 → СНОВА 1..10, а не 11..20) — это
    // отличается от Google CSE, где `start` даёт сквозную нумерацию. Если
    // использовать item.position как есть, при объединении двух страниц
    // получаются дублирующиеся позиции 1,1,2,2,3,3... Поэтому считаем
    // абсолютную позицию сами — по порядку элементов в ответе + смещению
    // от номера страницы, игнорируя присланное значение position.
    const pageOffset = (query.page - 1) * 10;
    const now = Date.now();
    return (data.organic ?? []).map((item, index) => ({
      id: `${query.keywords}_${pageOffset + index + 1}`,
      searchId: "", // проставляется вызывающим кодом
      position: pageOffset + index + 1,
      url: item.link,
      normalizedUrl: item.link,
      domain: safeHostname(item.link),
      title: item.title,
      snippet: item.snippet ?? "",
      sourceQuery: query.keywords,
      region: query.country,
      language: query.language,
      device: query.device,
      fetchedAt: now,
    }));
  }
}

/**
 * ЛЕГАСИ-вариант: Google Programmable Search Engine (Custom Search JSON API).
 * Оставлен на случай, если у аккаунта есть старый engine с уже включённым
 * "искать по всему интернету" (созданный до ограничения Google) — тогда
 * он будет работать. Для новых engine'ов — НЕ рабочий вариант, см. комментарий выше.
 */
export class GoogleProgrammableSearchProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly searchEngineId: string
  ) {}

  async search(query: SearchProviderQuery): Promise<SearchResultItem[]> {
    const start = query.page === 1 ? 1 : 11;
    const url = new URL("https://www.googleapis.com/customsearch/v1");
    url.searchParams.set("key", this.apiKey);
    url.searchParams.set("cx", this.searchEngineId);
    url.searchParams.set("q", query.keywords);
    url.searchParams.set("gl", query.country.toLowerCase());
    url.searchParams.set("hl", query.language);
    url.searchParams.set("num", "10");
    url.searchParams.set("start", String(start));

    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      throw new Error(`Google CSE API error: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as {
      items?: { link: string; title: string; snippet: string }[];
    };

    const now = Date.now();
    return (data.items ?? []).map((item, i) => ({
      id: `${query.keywords}_${start + i}`,
      searchId: "",
      position: start + i,
      url: item.link,
      normalizedUrl: item.link,
      domain: safeHostname(item.link),
      title: item.title,
      snippet: item.snippet,
      sourceQuery: query.keywords,
      region: query.country,
      language: query.language,
      device: query.device,
      fetchedAt: now,
    }));
  }
}

/**
 * ЭКСПЕРИМЕНТАЛЬНАЯ альтернатива: получение выдачи через управляемую
 * браузерную автоматизацию (Playwright). См. ограничения и риски (ToS,
 * хрупкость верстки, обязательный отказ при CAPTCHA — без попыток обхода)
 * в README. Оставлена как stub.
 */
export class BrowserAutomationSearchProvider implements SearchProvider {
  async search(_query: SearchProviderQuery): Promise<SearchResultItem[]> {
    throw new Error(
      "BrowserAutomationSearchProvider не реализован по умолчанию. " +
        "Используйте SerperSearchProvider, либо реализуйте этот класс " +
        "самостоятельно, ознакомившись с ограничениями в README."
    );
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

