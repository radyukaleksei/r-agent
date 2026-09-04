import type { Browser, Page, Request as PWRequest } from "playwright";
import { assertPublicUrl, FETCH_LIMITS } from "@site-network-agent/shared";
import type {
  EndpointRecord,
  ExternalResource,
  GTMContainer,
  ScriptRecord,
  TrackingIdentifier,
  WebsiteFingerprint,
  WebsiteStatus,
} from "@site-network-agent/types";
import { detectGTM, type RawScript } from "./gtmDetector";
import { extractExternalDomains, type CapturedResource } from "./externalDomainExtractor";
import { detectTrackingIdentifiers } from "./trackingDetector";
import {
  buildEndpointRecords,
  buildFingerprint,
  buildScriptRecords,
} from "./fingerprintEngine";

export interface AnalyzeOptions {
  device: "desktop" | "mobile";
  country: string; // используется для geolocation/locale эмуляции
  language: string;
  respectRobotsTxt: boolean;
}

export interface WebsiteAnalysisResult {
  status: WebsiteStatus;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
  gtmContainers: GTMContainer[];
  trackingIdentifiers: TrackingIdentifier[];
  scripts: ScriptRecord[];
  externalResources: ExternalResource[];
  endpoints: EndpointRecord[];
  fingerprint?: WebsiteFingerprint;
}

const DEVICE_PRESETS = {
  desktop: {
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    isMobile: false,
  },
  mobile: {
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
  },
} as const;

async function isDisallowedByRobots(pageUrl: string, path: string): Promise<boolean> {
  try {
    const robotsUrl = new URL("/robots.txt", pageUrl).toString();
    await assertPublicUrl(robotsUrl); // robots.txt тоже проходит через SSRF-проверку
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return false; // нет robots.txt — считаем разрешённым
    const text = await res.text();
    // Упрощённый парсинг: ищем блок User-agent: * и его Disallow-правила.
    // Для production рекомендуется полноценная библиотека парсинга robots.txt.
    const lines = text.split("\n").map((l) => l.trim());
    let inWildcardBlock = false;
    for (const line of lines) {
      if (/^user-agent:\s*\*/i.test(line)) inWildcardBlock = true;
      else if (/^user-agent:/i.test(line)) inWildcardBlock = false;
      else if (inWildcardBlock && /^disallow:/i.test(line)) {
        const rule = line.split(":").slice(1).join(":").trim();
        if (rule && path.startsWith(rule)) return true;
      }
    }
    return false;
  } catch {
    return false; // ошибка получения robots.txt не должна блокировать анализ
  }
}

/**
 * Анализирует один сайт: открывает страницу в изолированном browser context,
 * перехватывает все сетевые запросы, извлекает HTML/скрипты, прогоняет через
 * детекторы GTM / внешних доменов / tracking ID и строит fingerprint.
 *
 * Sandbox-соображения (см. п.14 ТЗ):
 *  - каждый сайт анализируется в НОВОМ browser context (изоляция cookies/storage
 *    между разными сайтами одного job'а);
 *  - переданный `browser` запускается с --no-sandbox отключённым по умолчанию
 *    (см. index.ts) и без доступа к файловой системе хоста;
 *  - никогда не выполняем произвольный JS, полученный от сайта, вне контекста
 *    страницы Playwright (т.е. не eval() в Node-процессе воркера).
 */
export async function analyzeWebsite(
  browser: Browser,
  url: string,
  options: AnalyzeOptions
): Promise<WebsiteAnalysisResult> {
  await assertPublicUrl(url); // бросит SSRFBlockedError, если IP приватный/зарезервированный

  if (options.respectRobotsTxt) {
    const path = new URL(url).pathname;
    if (await isDisallowedByRobots(url, path)) {
      return {
        status: "BLOCKED_BY_ROBOTS",
        gtmContainers: [],
        trackingIdentifiers: [],
        scripts: [],
        externalResources: [],
        endpoints: [],
      };
    }
  }

  const preset = DEVICE_PRESETS[options.device];
  const context = await browser.newContext({
    viewport: preset.viewport,
    userAgent: preset.userAgent,
    isMobile: preset.isMobile,
    locale: options.language,
    // Geolocation/страна для MVP эмулируется через Accept-Language + locale;
    // полноценная геолокация IP потребовала бы residential-прокси в стране
    // назначения — см. README → "Известные ограничения".
    extraHTTPHeaders: { "Accept-Language": options.language },
  });

  const capturedResources: CapturedResource[] = [];
  const requestedUrls: string[] = [];
  const capturedEndpoints: string[] = [];
  let totalBytes = 0;
  let redirectCount = 0;

  const page: Page = await context.newPage();

  // page.on("request") — только Observer, у него нет .abort(); чтобы реально
  // обрывать "лишние" запросы при превышении лимита ресурсов, нужен
  // page.route(), который даёт Route с .abort()/.continue().
  await page.route("**/*", (route) => {
    const req = route.request();
    requestedUrls.push(req.url());
    const type = req.resourceType();
    if (type === "xhr" || type === "fetch") {
      capturedEndpoints.push(req.url());
    }
    if (["script", "iframe", "image", "stylesheet", "font", "xhr", "fetch"].includes(type)) {
      capturedResources.push({
        url: req.url(),
        type: mapResourceType(type),
        foundIn: "network",
      });
    }
    if (capturedResources.length > FETCH_LIMITS.MAX_RESOURCES_PER_PAGE) {
      route.abort().catch(() => {});
      return;
    }
    route.continue().catch(() => {});
  });

  page.on("response", async (res) => {
    try {
      const headers = res.headers();
      const len = Number(headers["content-length"] ?? 0);
      totalBytes += len;
    } catch {
      /* игнорируем */
    }
  });

  let result: WebsiteAnalysisResult;

  try {
    const response = await page.goto(url, {
      timeout: FETCH_LIMITS.NAVIGATION_TIMEOUT_MS,
      waitUntil: "networkidle",
    });

    redirectCount = response?.request().redirectedFrom() ? countRedirects(response.request()) : 0;
    if (redirectCount > FETCH_LIMITS.MAX_REDIRECTS) {
      throw new Error(`Слишком много редиректов: ${redirectCount}`);
    }
    if (totalBytes > FETCH_LIMITS.MAX_RESPONSE_BYTES) {
      throw new Error("Превышен лимит суммарного размера ответа");
    }

    // При редиректе на другой хост — повторная SSRF-проверка финального URL.
    const finalUrl = page.url();
    if (finalUrl !== url) {
      await assertPublicUrl(finalUrl);
    }

    const html = await page.content();

    const scriptHandles = await page.$$eval("script", (nodes) =>
      nodes.map((n) => ({
        url: n.getAttribute("src"),
        content: n.textContent ?? "",
      }))
    );
    const rawScripts: RawScript[] = scriptHandles.map((s) => ({
      url: s.url ? new URL(s.url, finalUrl).toString() : null,
      content: s.content,
    }));

    for (const s of rawScripts) {
      if (s.url) {
        capturedResources.push({ url: s.url, type: "SCRIPT", foundIn: "html" });
      }
    }

    const gtmContainers = detectGTM({
      pageUrl: finalUrl,
      html,
      scripts: rawScripts,
      requestedUrls,
    }).map((g) => ({ ...g, websiteId: "" }));

    const trackingIdentifiers = detectTrackingIdentifiers(
      html,
      rawScripts.filter((s) => s.url === null).map((s) => s.content),
      finalUrl
    );

    const externalResources = extractExternalDomains(finalUrl, capturedResources);

    const scripts = buildScriptRecords(
      "",
      rawScripts.map((s) => ({ url: s.url, content: s.content }))
    );

    const endpoints = buildEndpointRecords("", capturedEndpoints);

    const fingerprint = buildFingerprint(
      "",
      gtmContainers,
      trackingIdentifiers,
      scripts,
      externalResources,
      endpoints
    );

    result = {
      status: "ANALYZED",
      httpStatus: response?.status(),
      finalUrl,
      gtmContainers,
      trackingIdentifiers,
      scripts,
      externalResources,
      endpoints,
      fingerprint,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      status: classifyError(message),
      error: message,
      gtmContainers: [],
      trackingIdentifiers: [],
      scripts: [],
      externalResources: [],
      endpoints: [],
    };
  } finally {
    await context.close();
  }

  return result;
}

function mapResourceType(pwType: string): CapturedResource["type"] {
  switch (pwType) {
    case "script":
      return "SCRIPT";
    case "iframe":
      return "IFRAME";
    case "image":
      return "IMAGE";
    case "stylesheet":
      return "STYLESHEET";
    case "xhr":
    case "fetch":
      return "API_CALL";
    case "font":
      return "FONT";
    default:
      return "OTHER";
  }
}

function countRedirects(request: PWRequest): number {
  let count = 0;
  let current: PWRequest | null = request.redirectedFrom();
  while (current) {
    count += 1;
    current = current.redirectedFrom();
  }
  return count;
}

function classifyError(message: string): WebsiteStatus {
  const m = message.toLowerCase();
  if (m.includes("ssrfblockederror") || m.includes("приватный") || m.includes("резолвится")) {
    return "SSRF_BLOCKED";
  }
  if (m.includes("timeout")) return "TIMEOUT";
  if (m.includes("ssl") || m.includes("cert")) return "SSL_ERROR";
  if (m.includes("редирект")) return "HTTP_ERROR";
  return "FAILED";
}
