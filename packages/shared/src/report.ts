import type {
  Cluster,
  EndpointRecord,
  ExternalResource,
  GTMContainer,
  Relationship,
  ScriptRecord,
  TrackingIdentifier,
  Website,
} from "@site-network-agent/types";

export interface ReportRow {
  website: string;
  gtmIds: string;
  externalDomains: string;
  trackingIds: string;
  scripts: string;
  endpoints: string;
  relatedWebsites: string;
  similarityScore: string;
  cluster: string;
  evidence: string;
}

export interface WebsiteBundle {
  website: Website;
  gtmContainers: GTMContainer[];
  trackingIdentifiers: TrackingIdentifier[];
  scripts: ScriptRecord[];
  externalResources: ExternalResource[];
  endpoints: EndpointRecord[];
}

/**
 * Строит табличный отчёт (п.15 ТЗ): по одной строке на сайт, с агрегированными
 * находками и — если сайт входит в кластер — сводкой по связанным сайтам,
 * скору и evidence лучшей связи.
 */
export function buildReportRows(
  bundles: WebsiteBundle[],
  relationships: Relationship[],
  clusters: Cluster[]
): ReportRow[] {
  const clusterByWebsiteId = new Map<string, Cluster>();
  for (const cluster of clusters) {
    for (const id of cluster.websiteIds) clusterByWebsiteId.set(id, cluster);
  }

  const bestRelationshipByWebsiteId = new Map<string, Relationship>();
  for (const rel of relationships) {
    for (const id of [rel.sourceWebsiteId, rel.targetWebsiteId]) {
      const current = bestRelationshipByWebsiteId.get(id);
      if (!current || rel.score > current.score) bestRelationshipByWebsiteId.set(id, rel);
    }
  }

  return bundles.map(({ website, gtmContainers, trackingIdentifiers, scripts, externalResources, endpoints }) => {
    const cluster = clusterByWebsiteId.get(website.id);
    const bestRel = bestRelationshipByWebsiteId.get(website.id);
    const relatedIds = relationships
      .filter((r) => r.sourceWebsiteId === website.id || r.targetWebsiteId === website.id)
      .map((r) => (r.sourceWebsiteId === website.id ? r.targetWebsiteId : r.sourceWebsiteId));

    return {
      website: website.url,
      gtmIds: gtmContainers.map((g) => g.gtmId).join("; "),
      externalDomains: externalResources.map((r) => r.domain).join("; "),
      trackingIds: trackingIdentifiers.map((t) => `${t.provider}:${t.identifier}`).join("; "),
      scripts: scripts.filter((s) => !s.isCommonLibrary).map((s) => s.scriptUrl ?? "inline").join("; "),
      endpoints: endpoints.map((e) => e.url).join("; "),
      relatedWebsites: Array.from(new Set(relatedIds)).join("; "),
      similarityScore: bestRel ? String(bestRel.score) : "",
      cluster: cluster ? cluster.id : "",
      evidence: bestRel ? bestRel.evidence.map((e) => e.description).join("; ") : "",
    };
  });
}

export function rowsToCsv(rows: ReportRow[]): string {
  const headers: (keyof ReportRow)[] = [
    "website",
    "gtmIds",
    "externalDomains",
    "trackingIds",
    "scripts",
    "endpoints",
    "relatedWebsites",
    "similarityScore",
    "cluster",
    "evidence",
  ];
  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}
