import type { TrackingIdentifier, TrackingProvider } from "@site-network-agent/types";

interface Pattern {
  provider: TrackingProvider;
  regex: RegExp;
}

// Каждый паттерн ищет ID, уникальный для конкретного аккаунта владельца сайта —
// именно поэтому совпадение таких ID является сильным признаком связи
// (в отличие от факта "оба сайта используют Google Analytics вообще").
const PATTERNS: Pattern[] = [
  { provider: "GOOGLE_ANALYTICS_UA", regex: /UA-\d{4,10}-\d{1,4}/g },
  { provider: "GOOGLE_ANALYTICS_GA4", regex: /\bG-[A-Z0-9]{6,12}\b/g },
  { provider: "FACEBOOK_PIXEL", regex: /fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g },
  { provider: "YANDEX_METRIKA", regex: /ym\(\s*(\d{6,10})\s*,\s*['"]init['"]/g },
  { provider: "HOTJAR", regex: /hjid\s*[:=]\s*(\d{5,10})/g },
  { provider: "TIKTOK_PIXEL", regex: /ttq\.load\(\s*['"]([A-Z0-9]{15,25})['"]/g },
];

export function detectTrackingIdentifiers(
  html: string,
  inlineScripts: string[],
  sourceUrl: string
): TrackingIdentifier[] {
  const combined = [html, ...inlineScripts].join("\n");
  const results = new Map<string, TrackingIdentifier>();

  for (const { provider, regex } of PATTERNS) {
    let m: RegExpExecArray | null;
    const re = new RegExp(regex.source, regex.flags);
    while ((m = re.exec(combined)) !== null) {
      // Для простых regex без capture group используем весь match (UA-/G-),
      // для остальных — первую capture group (числовой/строковый ID).
      const identifier = m[1] ?? m[0];
      const key = `${provider}:${identifier}`;
      if (!results.has(key)) {
        results.set(key, {
          id: key,
          websiteId: "",
          provider,
          identifier,
          detectionMethod: "REGEX_HTML_SCAN",
          sourceUrl,
        });
      }
    }
  }

  return Array.from(results.values());
}
