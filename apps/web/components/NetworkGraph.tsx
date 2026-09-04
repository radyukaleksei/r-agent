"use client";

import { useEffect, useMemo, useState } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
} from "d3-force";
import type { Relationship, Website } from "@site-network-agent/types";

type NodeKind = "site" | "gtm" | "tracking" | "script" | "domain" | "endpoint";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  kind: NodeKind;
  label: string;
}
interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

const NODE_COLOR: Record<NodeKind, string> = {
  site: "#E7EBEF",
  gtm: "#2FA79B",
  tracking: "#E0A458",
  script: "#8A7FD9",
  domain: "#6FA8DC",
  endpoint: "#D96C6C",
};

const EVIDENCE_TO_KIND: Record<string, NodeKind> = {
  SAME_GTM: "gtm",
  SAME_TRACKING_ID: "tracking",
  SAME_SCRIPT: "script",
  SAME_EXTERNAL_DOMAIN: "domain",
  SAME_API_ENDPOINT: "endpoint",
};

/**
 * Строит граф "сайты + узлы общих технических признаков" из relationships:
 * каждая уникальная пара (тип признака, значение) становится отдельным
 * узлом-хабом, к которому подключаются все сайты, у которых этот признак
 * встретился в evidence связи — именно так выглядит граф в п.5 ТЗ
 * (GTM-XXXX в центре, вокруг сайты).
 */
function buildGraph(websites: Website[], relationships: Relationship[]) {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  for (const w of websites) {
    nodes.set(w.id, { id: w.id, kind: "site", label: w.domain });
  }

  const featureSiteSets = new Map<string, { kind: NodeKind; label: string; siteIds: Set<string>; weight: number }>();

  for (const rel of relationships) {
    for (const evidence of rel.evidence) {
      const kind = EVIDENCE_TO_KIND[evidence.type];
      if (!kind) continue;
      const key = `${evidence.type}:${evidence.description}`;
      const entry = featureSiteSets.get(key) ?? {
        kind,
        label: evidence.description,
        siteIds: new Set<string>(),
        weight: evidence.weight,
      };
      entry.siteIds.add(rel.sourceWebsiteId);
      entry.siteIds.add(rel.targetWebsiteId);
      featureSiteSets.set(key, entry);
    }
  }

  for (const [key, feature] of featureSiteSets) {
    if (feature.siteIds.size < 2) continue; // хаб без связей не нужен
    nodes.set(key, { id: key, kind: feature.kind, label: feature.label });
    for (const siteId of feature.siteIds) {
      if (!nodes.has(siteId)) continue;
      edges.push({ source: siteId, target: key, weight: feature.weight });
    }
  }

  return { nodes: Array.from(nodes.values()), edges };
}

export function NetworkGraph({
  websites,
  relationships,
  onSelectSite,
}: {
  websites: Website[];
  relationships: Relationship[];
  onSelectSite: (websiteId: string) => void;
}) {
  const { nodes, edges } = useMemo(() => buildGraph(websites, relationships), [websites, relationships]);
  const [positioned, setPositioned] = useState<GraphNode[]>([]);

  const width = 900;
  const height = 600;

  useEffect(() => {
    if (nodes.length === 0) {
      setPositioned([]);
      return;
    }
    const simNodes = nodes.map((n) => ({ ...n }));
    const sim = forceSimulation(simNodes)
      .force(
        "link",
        forceLink<GraphNode, GraphEdge>(edges as any)
          .id((d: any) => d.id)
          .distance(90)
      )
      .force("charge", forceManyBody().strength(-180))
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide(24))
      .stop();

    for (let i = 0; i < 250; i++) sim.tick();
    setPositioned(simNodes as GraphNode[]);
  }, [nodes, edges]);

  const positionById = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of positioned) map.set(n.id, n);
    return map;
  }, [positioned]);

  if (nodes.length === 0) {
    return (
      <div className="text-text-secondary text-sm p-6">
        Пока нет связей для отображения — запустите «Искать схожее» на нескольких проанализированных сайтах.
      </div>
    );
  }

  return (
    <div className="panel rounded-md overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[600px]">
        <g opacity={0.5}>
          {edges.map((e, i) => {
            const a = positionById.get(e.source as unknown as string) ?? positionById.get((e.source as any).id);
            const b = positionById.get(e.target as unknown as string) ?? positionById.get((e.target as any).id);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="#2A323D"
                strokeWidth={Math.max(1, e.weight / 15)}
              />
            );
          })}
        </g>
        {positioned.map((n) => (
          <g
            key={n.id}
            transform={`translate(${n.x},${n.y})`}
            className={n.kind === "site" ? "cursor-pointer" : ""}
            onClick={() => n.kind === "site" && onSelectSite(n.id)}
          >
            <circle r={n.kind === "site" ? 8 : 5} fill={NODE_COLOR[n.kind]} opacity={n.kind === "site" ? 1 : 0.85} />
            <text
              x={12}
              y={4}
              fontSize={10}
              fontFamily="var(--font-plex-mono)"
              fill={n.kind === "site" ? "#E7EBEF" : "#8B94A3"}
            >
              {n.label}
            </text>
          </g>
        ))}
      </svg>
      <Legend />
    </div>
  );
}

function Legend() {
  const items: [NodeKind, string][] = [
    ["site", "Сайт"],
    ["gtm", "Общий GTM"],
    ["tracking", "Общий tracking ID"],
    ["script", "Общий скрипт"],
    ["domain", "Общий домен"],
    ["endpoint", "Общий endpoint"],
  ];
  return (
    <div className="flex flex-wrap gap-3 px-4 py-2.5 border-t border-border text-xs text-text-secondary">
      {items.map(([kind, label]) => (
        <div key={kind} className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: NODE_COLOR[kind] }} />
          {label}
        </div>
      ))}
    </div>
  );
}
