import { createHash } from "node:crypto";
import type {
  EndpointRecord,
  ExternalResource,
  GTMContainer,
  ScriptRecord,
  TrackingIdentifier,
  WebsiteFingerprint,
} from "@site-network-agent/types";
import { isCommonCdnOrLibraryDomain, isCommonScriptFilename } from "@site-network-agent/shared";

export interface RawScriptForHashing {
  url: string | null;
  content: string;
}

/**
 * Хэширует содержимое скрипта после лёгкой нормализации (убираем пробелы),
 * чтобы минорные различия в форматировании не давали разные хэши.
 * Это НЕ защита от обфускации/минификации разными сборщиками — только
 * защита от тривиальных отличий (например добавленного комментария).
 */
export function hashScriptContent(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

export function buildScriptRecords(
  websiteId: string,
  scripts: RawScriptForHashing[]
): ScriptRecord[] {
  return scripts.map((s, i) => {
    const contentHash = hashScriptContent(s.content);
    const isCommon = s.url ? isCommonScriptFilename(s.url) : false;
    return {
      id: `${websiteId}_script_${i}_${contentHash.slice(0, 8)}`,
      websiteId,
      scriptUrl: s.url,
      inline: s.url === null,
      contentHash,
      isCommonLibrary: isCommon,
    };
  });
}

export function buildEndpointRecords(
  websiteId: string,
  endpointUrls: string[]
): EndpointRecord[] {
  const seen = new Map<string, EndpointRecord>();
  for (const url of endpointUrls) {
    try {
      const u = new URL(url);
      const key = `${u.origin}${u.pathname}`;
      if (!seen.has(key)) {
        seen.set(key, {
          id: key,
          websiteId,
          url: key,
          method: "GET", // метод достоверно известен только если перехвачен из XHR/fetch — см. pageAnalyzer
          domain: u.hostname,
        });
      }
    } catch {
      /* пропускаем некорректные URL */
    }
  }
  return Array.from(seen.values());
}

/**
 * Собирает единый WebsiteFingerprint из результатов всех анализаторов.
 * Именно этот объект передаётся в similarity.ts для попарного сравнения
 * сайтов — а не "сырые" списки, чтобы явно исключить шумные признаки
 * (общие CDN, common-library скрипты) ДО скоринга.
 */
export function buildFingerprint(
  websiteId: string,
  gtmContainers: GTMContainer[],
  trackingIdentifiers: TrackingIdentifier[],
  scripts: ScriptRecord[],
  externalResources: ExternalResource[],
  endpoints: EndpointRecord[]
): WebsiteFingerprint {
  const gtmIds = Array.from(new Set(gtmContainers.map((g) => g.gtmId))).sort();
  const trackingIds = Array.from(
    new Set(trackingIdentifiers.map((t) => `${t.provider}:${t.identifier}`))
  ).sort();
  const uniqueScriptHashes = Array.from(
    new Set(scripts.filter((s) => !s.isCommonLibrary).map((s) => s.contentHash))
  ).sort();
  const externalDomains = Array.from(
    new Set(
      externalResources
        .map((r) => r.domain)
        .filter((d) => !isCommonCdnOrLibraryDomain(d))
    )
  ).sort();
  const apiEndpoints = Array.from(new Set(endpoints.map((e) => e.url))).sort();

  const canonicalString = JSON.stringify({
    gtmIds,
    trackingIds,
    uniqueScriptHashes,
    externalDomains,
    apiEndpoints,
  });

  return {
    websiteId,
    gtmIds,
    trackingIds,
    uniqueScriptHashes,
    externalDomains,
    apiEndpoints,
    fingerprintHash: createHash("sha256").update(canonicalString).digest("hex"),
    computedAt: Date.now(),
  };
}
