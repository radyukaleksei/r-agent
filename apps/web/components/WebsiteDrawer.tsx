"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/apiClient";
import { StatusBadge } from "./StatusBadge";
import type {
  EndpointRecord,
  ExternalResource,
  GTMContainer,
  ScriptRecord,
  TrackingIdentifier,
  Website,
} from "@site-network-agent/types";

interface AnalysisResponse {
  website: Website;
  gtmContainers: GTMContainer[];
  trackingIdentifiers: TrackingIdentifier[];
  scripts: ScriptRecord[];
  externalResources: ExternalResource[];
  endpoints: EndpointRecord[];
}

export function WebsiteDrawer({
  projectId,
  websiteId,
  onClose,
}: {
  projectId: string;
  websiteId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<AnalysisResponse | null>(null);
  const [depth, setDepth] = useState<1 | 2 | 3>(1);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    apiGet<AnalysisResponse>(`/api/website/${websiteId}/analysis?projectId=${projectId}`).then(setData);
  }, [websiteId, projectId]);

  async function handleFindSimilar() {
    setActionMessage(null);
    try {
      await apiPost("/api/similar/search", { projectId, websiteIds: [websiteId] });
      setActionMessage("Поиск похожих сайтов запущен — см. вкладку «Граф».");
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Ошибка");
    }
  }

  async function handleExpandNetwork() {
    setActionMessage(null);
    try {
      await apiPost("/api/network/expand", {
        projectId,
        websiteIds: [websiteId],
        depth,
        device: "desktop",
        country: "PL",
        language: "ru",
      });
      setActionMessage(`Расширение сети запущено (глубина ${depth}).`);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Ошибка");
    }
  }

  return (
    <div className="fixed inset-y-0 right-0 w-[420px] bg-surface border-l border-border shadow-2xl overflow-y-auto z-40">
      <div className="sticky top-0 bg-surface border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-mono text-sm truncate">{data?.website.domain ?? "…"}</div>
          {data && <StatusBadge status={data.website.status} />}
        </div>
        <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-lg leading-none">
          ×
        </button>
      </div>

      {!data ? (
        <div className="p-4 text-text-secondary text-sm">Загрузка…</div>
      ) : (
        <div className="p-4 space-y-5">
          <Section title="Google Tag Manager" empty={data.gtmContainers.length === 0}>
            {data.gtmContainers.map((g) => (
              <div key={g.id} className="flex items-center justify-between text-sm py-1">
                <span className="mono-tag">{g.gtmId}</span>
                <span className="text-text-secondary text-xs">{g.detectionMethod}</span>
              </div>
            ))}
          </Section>

          <Section title="Tracking identifiers" empty={data.trackingIdentifiers.length === 0}>
            {data.trackingIdentifiers.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm py-1">
                <span className="mono-tag">{t.identifier}</span>
                <span className="text-text-secondary text-xs">{t.provider}</span>
              </div>
            ))}
          </Section>

          <Section title="Внешние домены" empty={data.externalResources.length === 0}>
            {data.externalResources.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm py-1">
                <span className="font-mono text-xs truncate">{r.domain}</span>
                <span className="text-text-secondary text-xs">{r.category} · ×{r.occurrenceCount}</span>
              </div>
            ))}
          </Section>

          <Section title="Уникальные скрипты" empty={data.scripts.filter((s) => !s.isCommonLibrary).length === 0}>
            {data.scripts
              .filter((s) => !s.isCommonLibrary)
              .map((s) => (
                <div key={s.id} className="text-xs font-mono text-text-secondary truncate py-1">
                  {s.scriptUrl ?? `inline:${s.contentHash.slice(0, 12)}…`}
                </div>
              ))}
          </Section>

          <Section title="API endpoints" empty={data.endpoints.length === 0}>
            {data.endpoints.map((e) => (
              <div key={e.id} className="text-xs font-mono text-text-secondary truncate py-1">
                {e.url}
              </div>
            ))}
          </Section>

          <div className="border-t border-border pt-4 space-y-2">
            <button className="btn-primary w-full" onClick={handleFindSimilar}>
              Искать схожее
            </button>
            <div className="flex gap-2">
              <select
                className="input"
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value) as 1 | 2 | 3)}
              >
                <option value={1}>Depth: 1</option>
                <option value={2}>Depth: 2</option>
                <option value={3}>Depth: 3</option>
              </select>
              <button className="btn-secondary flex-1" onClick={handleExpandNetwork}>
                Расширить сеть
              </button>
            </div>
            {actionMessage && <p className="text-xs text-text-secondary">{actionMessage}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm text-text-secondary mb-1.5">{title}</h3>
      {empty ? (
        <p className="text-text-secondary text-xs">Не обнаружено</p>
      ) : (
        <div className="divide-y divide-border/60">{children}</div>
      )}
    </div>
  );
}
