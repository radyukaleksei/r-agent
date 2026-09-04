import type { GTMContainer, GTMDetectionMethod } from "@site-network-agent/types";

export interface RawScript {
  url: string | null; // null = inline
  content: string;
}

export interface GTMDetectionInput {
  pageUrl: string;
  html: string;
  scripts: RawScript[]; // inline + загруженные внешние скрипты (см. pageAnalyzer)
  requestedUrls: string[]; // все сетевые запросы, перехваченные Playwright
}

const GTM_ID_RE = /GTM-[A-Z0-9]{4,10}/g;

/**
 * Ищет присутствие Google Tag Manager несколькими независимыми способами
 * (см. п.3 ТЗ) — так как сайты внедряют GTM по-разному (async-загрузчик,
 * прямой iframe, через кастомный tag manager обёртку и т.д.).
 */
export function detectGTM(input: GTMDetectionInput): GTMContainer[] {
  const found = new Map<string, GTMContainer>(); // gtmId -> первое обнаружение

  const record = (gtmId: string, method: GTMDetectionMethod, sourceUrl: string) => {
    const key = gtmId;
    if (!found.has(key)) {
      found.set(key, {
        id: `${key}_${method}`,
        websiteId: "", // проставляется вызывающим кодом (pageAnalyzer)
        gtmId,
        detectionMethod: method,
        sourceUrl,
        detectedAt: Date.now(),
      });
    }
  };

  // 1. googletagmanager.com/gtm.js?id=GTM-XXXX в <script src="...">
  for (const script of input.scripts) {
    if (script.url && script.url.includes("googletagmanager.com/gtm.js")) {
      const idMatch = new URL(script.url, input.pageUrl).searchParams.get("id");
      if (idMatch && /^GTM-/.test(idMatch)) {
        record(idMatch, "SCRIPT_SRC", script.url);
      }
    }
  }

  // 2. Сетевые запросы к gtm.js / gtag/js, даже если тег добавлен динамически
  //    и не виден в исходном HTML.
  for (const url of input.requestedUrls) {
    if (url.includes("googletagmanager.com/gtm.js") || url.includes("googletagmanager.com/gtag/js")) {
      try {
        const id = new URL(url).searchParams.get("id");
        if (id && /^GTM-/.test(id)) record(id, "NETWORK_REQUEST", url);
      } catch {
        /* игнорируем некорректные URL */
      }
    }
  }

  // 3. <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXX">
  const iframeRe = /googletagmanager\.com\/ns\.html\?id=(GTM-[A-Z0-9]{4,10})/g;
  let m: RegExpExecArray | null;
  while ((m = iframeRe.exec(input.html)) !== null) {
    record(m[1], "NOSCRIPT_IFRAME", input.pageUrl);
  }

  // 4. Инлайн-скрипт с классическим сниппетом GTM
  //    (window.dataLayer=window.dataLayer||[]; ... 'GTM-XXXX')
  for (const script of input.scripts) {
    if (script.url !== null) continue; // только inline
    if (!/dataLayer/.test(script.content)) continue;
    const matches = script.content.match(GTM_ID_RE);
    if (matches) {
      for (const id of matches) record(id, "DATALAYER_PUSH", input.pageUrl);
    }
  }

  // 5. Общий fallback — любое упоминание GTM-XXXX где угодно в HTML,
  //    которое не попало в предыдущие категории (напр. закомментированный
  //    сниппет, нестандартная обёртка). Помечаем отдельным методом,
  //    чтобы UI мог показать более низкую уверенность при необходимости.
  const htmlMatches = input.html.match(GTM_ID_RE);
  if (htmlMatches) {
    for (const id of htmlMatches) {
      if (!found.has(id)) record(id, "INLINE_SCRIPT_ID", input.pageUrl);
    }
  }

  return Array.from(found.values());
}
