"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { SearchPanel, type SearchFormValues } from "@/components/SearchPanel";
import { ResultsTable, type ResultRow } from "@/components/ResultsTable";
import { WebsiteDrawer } from "@/components/WebsiteDrawer";
import { useAuth } from "@/lib/useAuth";
import { apiGet, apiPost } from "@/lib/apiClient";
import { ensureWebsiteForResult, subscribeToWebsites } from "@/lib/websites";
import { waitForJobCompletion } from "@/lib/jobs";
import type { SearchResultItem, Website } from "@site-network-agent/types";

export default function SearchPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { user } = useAuth();

  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [websites, setWebsites] = useState<Record<string, Website>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openWebsiteId, setOpenWebsiteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return subscribeToWebsites(user.uid, projectId, (list) => {
      setWebsites(Object.fromEntries(list.map((w) => [w.id, w])));
    });
  }, [user, projectId]);

  async function handleSearch(values: SearchFormValues) {
    setIsSearching(true);
    setResults([]);
    try {
      const { searchId, jobId } = await apiPost<{ searchId: string; jobId: string }>("/api/search", {
        projectId,
        ...values,
      });
      await waitForJobCompletion(jobId);
      const { results: fetched } = await apiGet<{ results: SearchResultItem[] }>(
        `/api/search/${searchId}/results?projectId=${projectId}`
      );
      setResults(fetched);
    } finally {
      setIsSearching(false);
    }
  }

  async function handleAnalyze(row: ResultRow) {
    if (!user) return;
    const result = results.find((r) => r.id === row.resultId);
    if (!result) return;
    const websiteId = await ensureWebsiteForResult(user.uid, projectId, result);
    await apiPost(`/api/website/${websiteId}/analyze`, {
      projectId,
      device: "desktop",
      country: "PL",
      language: "ru",
    });
  }

  async function handleAnalyzeSelected() {
    if (!user) return;
    const selectedRows = rows.filter((r) => selected.has(r.resultId));
    const websiteIds = await Promise.all(
      selectedRows.map(async (row) => {
        const result = results.find((r) => r.id === row.resultId);
        if (!result) return null;
        return ensureWebsiteForResult(user.uid, projectId, result);
      })
    );
    const validIds = websiteIds.filter((id): id is string => !!id);
    if (validIds.length === 0) return;

    // Одна ANALYZE_BATCH задача на все выбранные сайты сразу — не N
    // отдельных задач (см. /api/website/analyze-batch: иначе выбор даже
    // 3 сайтов упирается в лимит одновременных задач на пользователя).
    await apiPost("/api/website/analyze-batch", {
      projectId,
      websiteIds: validIds,
      device: "desktop",
      country: "PL",
      language: "ru",
    });
    setSelected(new Set());
  }

  const rows: ResultRow[] = useMemo(
    () =>
      results.map((r) => {
        const website = Object.values(websites).find((w) => w.normalizedUrl === r.normalizedUrl);
        return {
          resultId: r.id,
          position: r.position,
          url: r.url,
          domain: r.domain,
          title: r.title,
          websiteId: website?.id,
          status: website?.status,
          gtmCount: website?.gtmCount,
          externalDomainsCount: website?.externalDomainsCount,
        };
      }),
    [results, websites]
  );

  return (
    <AppShell projectId={projectId}>
      <div className="p-6 space-y-4 max-w-6xl">
        <SearchPanel onSearch={handleSearch} isSearching={isSearching} />

        {rows.length > 0 && (
          <div className="panel rounded-md overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <span className="text-text-secondary text-xs">{rows.length} результатов</span>
              <button
                className="btn-secondary text-xs"
                disabled={selected.size === 0}
                onClick={handleAnalyzeSelected}
              >
                Анализировать выбранное ({selected.size})
              </button>
            </div>
            <ResultsTable
              rows={rows}
              selected={selected}
              onToggleSelect={(id) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  next.has(id) ? next.delete(id) : next.add(id);
                  return next;
                })
              }
              onToggleSelectAll={() =>
                setSelected((prev) =>
                  prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.resultId))
                )
              }
              onAnalyze={handleAnalyze}
              onOpenWebsite={setOpenWebsiteId}
            />
          </div>
        )}
      </div>

      {openWebsiteId && (
        <WebsiteDrawer
          projectId={projectId}
          websiteId={openWebsiteId}
          onClose={() => setOpenWebsiteId(null)}
        />
      )}
    </AppShell>
  );
}
