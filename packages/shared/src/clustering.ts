import type { Cluster, Relationship } from "@site-network-agent/types";

/** Классический Disjoint Set (Union-Find) с path compression + union by rank. */
class DisjointSet {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  makeSet(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    const p = this.parent.get(id);
    if (p === undefined) throw new Error(`Unknown id: ${id}`);
    if (p !== id) {
      const root = this.find(p);
      this.parent.set(id, root); // path compression
      return root;
    }
    return id;
  }

  union(a: string, b: string) {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA === rootB) return;
    const rankA = this.rank.get(rootA)!;
    const rankB = this.rank.get(rootB)!;
    if (rankA < rankB) {
      this.parent.set(rootA, rootB);
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA);
    } else {
      this.parent.set(rootB, rootA);
      this.rank.set(rootA, rankA + 1);
    }
  }
}

export interface ClusteringOptions {
  /** Минимальный score связи, при котором два сайта объединяются в один кластер. */
  minEdgeScore: number;
  /** Кластеры из 1 сайта (без связей) не возвращаются. */
  minClusterSize?: number;
}

const DEFAULT_OPTIONS: ClusteringOptions = {
  minEdgeScore: 50,
  minClusterSize: 2,
};

/**
 * Строит кластеры через connected components по графу relationships,
 * учитывая только рёбра с score >= minEdgeScore.
 *
 * Важно: это НЕ утверждение о принадлежности сайтов одному владельцу —
 * см. Cluster.label и предупреждение в README / UI.
 */
export function buildClusters(
  websiteIds: string[],
  relationships: Relationship[],
  projectId: string,
  options: Partial<ClusteringOptions> = {}
): Cluster[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const ds = new DisjointSet();
  for (const id of websiteIds) ds.makeSet(id);

  const relevantEdges = relationships.filter((r) => r.score >= opts.minEdgeScore);
  for (const edge of relevantEdges) {
    if (!websiteIds.includes(edge.sourceWebsiteId) || !websiteIds.includes(edge.targetWebsiteId)) {
      continue;
    }
    ds.union(edge.sourceWebsiteId, edge.targetWebsiteId);
  }

  const groups = new Map<string, string[]>();
  for (const id of websiteIds) {
    const root = ds.find(id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(id);
  }

  const now = Date.now();
  const clusters: Cluster[] = [];

  for (const members of groups.values()) {
    if (members.length < (opts.minClusterSize ?? 2)) continue;

    const memberSet = new Set(members);
    const internalEdges = relevantEdges.filter(
      (e) => memberSet.has(e.sourceWebsiteId) && memberSet.has(e.targetWebsiteId)
    );

    const sharedGTMIds = uniqueFromEvidence(internalEdges, "SAME_GTM");
    const sharedExternalDomains = uniqueFromEvidence(internalEdges, "SAME_EXTERNAL_DOMAIN");
    const sharedTrackingIds = uniqueFromEvidence(internalEdges, "SAME_TRACKING_ID");
    const sharedScriptHashes = uniqueFromEvidence(internalEdges, "SAME_SCRIPT");

    const avgConfidence =
      internalEdges.length > 0
        ? Math.round(
            internalEdges.reduce((sum, e) => sum + e.score, 0) / internalEdges.length
          )
        : 0;

    clusters.push({
      id: `cluster_${members.slice().sort().join("_").slice(0, 40)}`,
      projectId,
      websiteIds: members,
      sharedGTMIds,
      sharedExternalDomains,
      sharedTrackingIds,
      sharedScriptHashes,
      confidence: avgConfidence,
      label: "Potentially related infrastructure",
      createdAt: now,
      updatedAt: now,
    });
  }

  return clusters.sort((a, b) => b.websiteIds.length - a.websiteIds.length);
}

// Извлекаем "человекочитаемые" значения признака из описаний evidence —
// в MVP evidence хранит description, а не сырые значения; для более точной
// агрегации рекомендуется хранить в Relationship также raw-значения
// (см. TODO в README → "Известные ограничения").
function uniqueFromEvidence(edges: Relationship[], type: string): string[] {
  const values = new Set<string>();
  for (const edge of edges) {
    for (const ev of edge.evidence) {
      if (ev.type === type) values.add(ev.description);
    }
  }
  return Array.from(values);
}
