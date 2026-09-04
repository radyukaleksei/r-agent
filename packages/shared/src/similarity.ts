import type { EvidenceItem, WebsiteFingerprint } from "@site-network-agent/types";
import { isCommonCdnOrLibraryDomain } from "./knownProviders";

/**
 * Веса признаков (см. п.6 ТЗ). Подобраны так, чтобы:
 *  - один общий GTM/tracking ID почти всегда давал "сильную" связь;
 *  - множество слабых совпадений (популярные CDN) НЕ давали ложный high score;
 *  - итоговый score всегда капается на 100.
 *
 * Значения — стартовая эвристика для MVP. В README описано, как их
 * калибровать на размеченных данных вместо ручного подбора.
 */
export const WEIGHTS = {
  SAME_GTM: 40,
  SAME_TRACKING_ID: 35,
  SAME_UNIQUE_SCRIPT: 25,
  SAME_API_ENDPOINT: 15,
  SAME_EXTERNAL_DOMAIN: 6, // за каждый общий домен, с капом (см. MAX_DOMAIN_CONTRIBUTION)
  SAME_CDN: 0, // общий популярный CDN сам по себе не учитывается
} as const;

const MAX_DOMAIN_CONTRIBUTION = 24; // не более 4 доменов "весомо" влияют на score
const MAX_SCORE = 100;

export interface SimilarityResult {
  score: number;
  evidence: EvidenceItem[];
}

function intersect<T>(a: T[], b: T[]): T[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

export function computeSimilarity(
  a: WebsiteFingerprint,
  b: WebsiteFingerprint
): SimilarityResult {
  const evidence: EvidenceItem[] = [];
  let score = 0;

  const sharedGtm = intersect(a.gtmIds, b.gtmIds);
  for (const gtmId of sharedGtm) {
    score += WEIGHTS.SAME_GTM;
    evidence.push({
      type: "SAME_GTM",
      description: `Одинаковый GTM ID: ${gtmId}`,
      weight: WEIGHTS.SAME_GTM,
    });
  }

  const sharedTracking = intersect(a.trackingIds, b.trackingIds);
  for (const id of sharedTracking) {
    score += WEIGHTS.SAME_TRACKING_ID;
    evidence.push({
      type: "SAME_TRACKING_ID",
      description: `Одинаковый tracking ID: ${id}`,
      weight: WEIGHTS.SAME_TRACKING_ID,
    });
  }

  const sharedScripts = intersect(a.uniqueScriptHashes, b.uniqueScriptHashes);
  for (const hash of sharedScripts) {
    score += WEIGHTS.SAME_UNIQUE_SCRIPT;
    evidence.push({
      type: "SAME_SCRIPT",
      description: `Одинаковый уникальный JS-файл (hash ${hash.slice(0, 8)}…)`,
      weight: WEIGHTS.SAME_UNIQUE_SCRIPT,
    });
  }

  const sharedEndpoints = intersect(a.apiEndpoints, b.apiEndpoints);
  for (const endpoint of sharedEndpoints) {
    score += WEIGHTS.SAME_API_ENDPOINT;
    evidence.push({
      type: "SAME_API_ENDPOINT",
      description: `Одинаковый API endpoint: ${endpoint}`,
      weight: WEIGHTS.SAME_API_ENDPOINT,
    });
  }

  const sharedDomains = intersect(a.externalDomains, b.externalDomains).filter(
    (d) => !isCommonCdnOrLibraryDomain(d)
  );
  let domainContribution = 0;
  for (const domain of sharedDomains) {
    if (domainContribution >= MAX_DOMAIN_CONTRIBUTION) break;
    const add = Math.min(WEIGHTS.SAME_EXTERNAL_DOMAIN, MAX_DOMAIN_CONTRIBUTION - domainContribution);
    domainContribution += add;
    score += add;
  }
  if (sharedDomains.length > 0) {
    evidence.push({
      type: "SAME_EXTERNAL_DOMAIN",
      description: `${sharedDomains.length} общих внешних доменов: ${sharedDomains
        .slice(0, 5)
        .join(", ")}${sharedDomains.length > 5 ? "…" : ""}`,
      weight: domainContribution,
    });
  }

  score = Math.min(MAX_SCORE, Math.round(score));
  evidence.sort((x, y) => y.weight - x.weight);

  return { score, evidence };
}
