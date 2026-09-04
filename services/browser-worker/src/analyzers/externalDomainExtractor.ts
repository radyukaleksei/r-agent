import { getRegistrableDomain } from "@site-network-agent/shared";
import { classifyDomain } from "@site-network-agent/shared";
import type { ExternalResource, ExternalResourceType } from "@site-network-agent/types";

export interface CapturedResource {
  url: string;
  type: ExternalResourceType;
  foundIn: string; // "html" | "script:<url>" | "network"
}

/**
 * Собирает внешние (не принадлежащие анализируемому сайту) домены из всех
 * перехваченных ресурсов страницы: script/img/iframe/link/fetch/XHR
 * (см. п.3 ТЗ). Свой домен сайта исключается, чтобы не "засорять"
 * fingerprint собственными поддоменами/CDN сайта.
 */
export function extractExternalDomains(
  pageUrl: string,
  resources: CapturedResource[]
): ExternalResource[] {
  const pageDomain = getRegistrableDomain(new URL(pageUrl).hostname);
  const byKey = new Map<string, ExternalResource>();

  for (const resource of resources) {
    let hostname: string;
    try {
      hostname = new URL(resource.url).hostname.toLowerCase();
    } catch {
      continue; // относительные/некорректные URL уже должны быть резолвлены до этого шага
    }

    const domain = getRegistrableDomain(hostname);
    if (domain === pageDomain) continue; // это свой домен — не "внешний"

    const key = `${domain}:${resource.type}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.occurrenceCount += 1;
      if (!existing.locations.includes(resource.foundIn)) {
        existing.locations.push(resource.foundIn);
      }
    } else {
      byKey.set(key, {
        id: key,
        websiteId: "", // проставляется в pageAnalyzer
        domain,
        resourceType: resource.type,
        category: classifyDomain(domain),
        sampleSourceUrl: resource.url,
        occurrenceCount: 1,
        locations: [resource.foundIn],
      });
    }
  }

  return Array.from(byKey.values()).sort(
    (a, b) => b.occurrenceCount - a.occurrenceCount
  );
}
