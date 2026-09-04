/**
 * Справочники для классификации внешних ресурсов и снижения "шума" в скоринге.
 * Общие CDN/популярные библиотеки, которые используют миллионы несвязанных
 * сайтов, НЕ должны считаться сильным признаком связи между сайтами —
 * иначе кластеризация даст ложные срабатывания на любых двух сайтах,
 * подключающих jQuery с одного и того же CDN.
 *
 * Список неполный и его стоит пополнять по мере наблюдений (см. README).
 */

export const KNOWN_CDN_DOMAINS = new Set([
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "ajax.googleapis.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "code.jquery.com",
  "stackpath.bootstrapcdn.com",
  "maxcdn.bootstrapcdn.com",
  "use.fontawesome.com",
]);

export const KNOWN_ANALYTICS_DOMAINS = new Set([
  "google-analytics.com",
  "googletagmanager.com",
  "analytics.google.com",
  "mc.yandex.ru",
  "hotjar.com",
  "static.hotjar.com",
  "cdn.segment.com",
  "cdn.amplitude.com",
]);

export const KNOWN_ADVERTISING_DOMAINS = new Set([
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adservice.google.com",
  "facebook.net",
  "connect.facebook.net",
  "adnxs.com",
  "criteo.com",
  "taboola.com",
  "outbrain.com",
]);

export const KNOWN_SOCIAL_DOMAINS = new Set([
  "connect.facebook.net",
  "platform.twitter.com",
  "platform.linkedin.com",
  "www.youtube.com",
  "player.vimeo.com",
]);

/** Хэши/имена файлов общеизвестных библиотек — не учитываются как "уникальный скрипт". */
export const COMMON_SCRIPT_FILENAME_PATTERNS: RegExp[] = [
  /jquery(\.min)?\.js$/i,
  /bootstrap(\.min)?\.js$/i,
  /gtag\.js$/i,
  /gtm\.js$/i,
  /fbevents\.js$/i,
  /analytics\.js$/i,
  /polyfill/i,
  /react(-dom)?(\.production)?(\.min)?\.js$/i,
  /vue(\.min)?\.js$/i,
  /swiper(\.min)?\.js$/i,
  /font-?awesome/i,
];

export function classifyDomain(
  domain: string
): "ANALYTICS" | "ADVERTISING" | "CDN" | "SOCIAL" | "UNKNOWN" {
  const d = domain.toLowerCase();
  if (KNOWN_ANALYTICS_DOMAINS.has(d)) return "ANALYTICS";
  if (KNOWN_ADVERTISING_DOMAINS.has(d)) return "ADVERTISING";
  if (KNOWN_CDN_DOMAINS.has(d)) return "CDN";
  if (KNOWN_SOCIAL_DOMAINS.has(d)) return "SOCIAL";
  return "UNKNOWN";
}

export function isCommonCdnOrLibraryDomain(domain: string): boolean {
  return KNOWN_CDN_DOMAINS.has(domain.toLowerCase());
}

export function isCommonScriptFilename(url: string): boolean {
  return COMMON_SCRIPT_FILENAME_PATTERNS.some((re) => re.test(url));
}
