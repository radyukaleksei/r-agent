const TRACKING_PARAM_PREFIXES = ["utm_", "fbclid", "gclid", "yclid", "_ga", "mc_"];

/**
 * Нормализация URL для дедупликации результатов поиска и сайтов.
 * НЕ предназначена для получения "канонического" URL сайта (тот приходит
 * из <link rel="canonical">, если есть — см. pageAnalyzer.ts).
 */
export function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl);

  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }

  // Убираем трекинговые параметры, остальные — сортируем для стабильности.
  const params = Array.from(url.searchParams.entries()).filter(
    ([key]) => !TRACKING_PARAM_PREFIXES.some((p) => key.toLowerCase().startsWith(p))
  );
  params.sort(([a], [b]) => a.localeCompare(b));
  url.search = "";
  for (const [k, v] of params) url.searchParams.append(k, v);

  url.hash = "";

  let pathname = url.pathname.replace(/\/+$/g, ""); // убрать trailing slash(es)
  url.pathname = pathname === "" ? "/" : pathname;

  return url.toString();
}

/** Возвращает registrable domain (упрощённо, без полного PSL/eTLD+1). */
export function getRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split(".");
  if (parts.length <= 2) return parts.join(".");
  // Упрощение: не учитывает составные TLD (co.uk, com.pl и т.п.).
  // Для production рекомендуется библиотека `tldts` или `psl`
  // (см. README → "Известные ограничения").
  return parts.slice(-2).join(".");
}

export function isSameSite(urlA: string, urlB: string): boolean {
  return (
    getRegistrableDomain(new URL(urlA).hostname) ===
    getRegistrableDomain(new URL(urlB).hostname)
  );
}
