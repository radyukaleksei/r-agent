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
 * ОСНОВНОЙ и РЕКОМЕНДУЕМЫЙ способ получения результатов Google Search.
 *
 * Использует Google Programmable Search Engine (Custom Search JSON API):
 * https://developers.google.com/custom-search/v1/overview
 *
 * ОГРАНИЧЕНИЯ (см. п.13 ТЗ — явно указываем, не скрываем):
 *  - Бесплатный тариф: 100 запросов/день, далее платно (см. текущий прайсинг Google).
 *  - CSE в режиме "искать по всему вебу" — это отдельный индекс Google для
 *    Custom Search, а НЕ то же самое ранжирование, что видит обычный
 *    пользователь на google.com. Позиции и состав результатов могут заметно
 *    отличаться от "живой" выдачи.
 *  - Параметр `gl` (страна) и `hl` (язык интерфейса) поддерживаются API
 *    напрямую и работают надёжно — в отличие от эмуляции региона через
 *    браузер (см. BrowserAutomationSearchProvider ниже).
 *  - Официальный API не различает "мобильную" и "десктопную" выдачу
 *    (Google не документирует такой параметр для CSE) — если различие
 *    мобильной/десктопной SERP критично, придётся использовать
 *    BrowserAutomationSearchProvider для этой части, приняв её ограничения.
 */
export class GoogleProgrammableSearchProvider implements SearchProvider {
  constructor(
    private readonly apiKey: string,
    private readonly searchEngineId: string
  ) {}

  async search(query: SearchProviderQuery): Promise<SearchResultItem[]> {
    const start = query.page === 1 ? 1 : 11; // 1-indexed, до 10 результатов за запрос
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
      searchId: "", // проставляется вызывающим кодом
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
 * браузерную автоматизацию (Playwright), когда нужна "живая" SERP с
 * реальным устройство-зависимым рендерингом.
 *
 * ЯВНЫЕ ОГРАНИЧЕНИЯ И РИСКИ:
 *  - Автоматизированный доступ к google.com/search регулируется Условиями
 *    использования Google — прежде чем включать этот провайдер в
 *    production, стоит свериться с актуальными ToS для вашего юзкейса.
 *  - Верстка/селекторы результатов Google меняются без предупреждения —
 *    парсер потребует регулярного сопровождения.
 *  - При обнаружении автоматизации Google показывает CAPTCHA/interstitial.
 *    Этот провайдер НЕ пытается её решать или обходить — при обнаружении
 *    CAPTCHA он должен немедленно прекратить попытку и вернуть ошибку,
 *    чтобы job перешёл в статус FAILED с понятной причиной, а не завис
 *    или не начал "долбить" Google повторными запросами.
 *
 * Реализация сознательно оставлена как stub — заполните `runSearch`
 * своей логикой, если для вашего юзкейса Programmable Search API
 * недостаточен, приняв риски выше.
 */
export class BrowserAutomationSearchProvider implements SearchProvider {
  async search(_query: SearchProviderQuery): Promise<SearchResultItem[]> {
    throw new Error(
      "BrowserAutomationSearchProvider не реализован по умолчанию. " +
        "Используйте GoogleProgrammableSearchProvider, либо реализуйте " +
        "этот класс самостоятельно, ознакомившись с ограничениями в комментарии выше."
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
