"use client";

import type { WebsiteStatus } from "@site-network-agent/types";
import { StatusBadge } from "./StatusBadge";

export interface ResultRow {
  resultId: string;
  position: number;
  url: string;
  domain: string;
  title: string;
  websiteId?: string;
  status?: WebsiteStatus;
  gtmCount?: number;
  externalDomainsCount?: number;
}

export function ResultsTable({
  rows,
  selected,
  onToggleSelect,
  onToggleSelectAll,
  onAnalyze,
  onOpenWebsite,
}: {
  rows: ResultRow[];
  selected: Set<string>;
  onToggleSelect: (resultId: string) => void;
  onToggleSelectAll: () => void;
  onAnalyze: (row: ResultRow) => void;
  onOpenWebsite: (websiteId: string) => void;
}) {
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.resultId));

  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left text-text-secondary text-xs border-b border-border">
          <th className="w-8 py-2 pl-3">
            <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
          </th>
          <th className="w-10 py-2">#</th>
          <th className="py-2">URL</th>
          <th className="py-2 w-40">Domain</th>
          <th className="py-2 w-16">Pos.</th>
          <th className="py-2 w-32">Status</th>
          <th className="py-2 w-16">GTM</th>
          <th className="py-2 w-32">Ext. domains</th>
          <th className="py-2 w-24 pr-3">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.resultId} className="border-b border-border/60 hover:bg-surface-raised/50">
            <td className="py-2 pl-3">
              <input
                type="checkbox"
                checked={selected.has(row.resultId)}
                onChange={() => onToggleSelect(row.resultId)}
              />
            </td>
            <td className="py-2 text-text-secondary">{row.position}</td>
            <td className="py-2 max-w-md">
              <button
                className="text-left truncate block max-w-md hover:text-accent-teal"
                title={row.title}
                onClick={() => row.websiteId && onOpenWebsite(row.websiteId)}
                disabled={!row.websiteId}
              >
                {row.title || row.url}
              </button>
              <div className="text-text-secondary text-xs truncate max-w-md font-mono">{row.url}</div>
            </td>
            <td className="py-2 font-mono text-xs">{row.domain}</td>
            <td className="py-2 text-text-secondary">{row.position}</td>
            <td className="py-2">
              {row.status ? <StatusBadge status={row.status} /> : <span className="mono-tag">—</span>}
            </td>
            <td className="py-2">{row.gtmCount ? row.gtmCount : "—"}</td>
            <td className="py-2">{row.externalDomainsCount ? row.externalDomainsCount : "—"}</td>
            <td className="py-2 pr-3">
              <button
                className="btn-secondary text-xs"
                disabled={row.status === "ANALYZING"}
                onClick={() => onAnalyze(row)}
              >
                {row.status === "ANALYZING" ? "…" : "Анализ"}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
