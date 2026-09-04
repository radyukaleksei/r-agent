"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ClusterCard } from "@/components/ClusterCard";
import { WebsiteDrawer } from "@/components/WebsiteDrawer";
import { apiGet, apiPost } from "@/lib/apiClient";
import { useAuth } from "@/lib/useAuth";
import { waitForJobCompletion } from "@/lib/jobs";
import type { Cluster, Website } from "@site-network-agent/types";

export default function ClustersPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { user } = useAuth();
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [expandedClusterId, setExpandedClusterId] = useState<string | null>(null);
  const [expandedWebsites, setExpandedWebsites] = useState<Website[]>([]);
  const [openWebsiteId, setOpenWebsiteId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  async function load() {
    const { clusters: fetched } = await apiGet<{ clusters: Cluster[] }>(`/api/clusters?projectId=${projectId}`);
    setClusters(fetched);
  }

  useEffect(() => {
    if (user) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projectId]);

  async function handleRebuild() {
    if (!user) return;
    setRebuilding(true);
    try {
      const { jobId } = await apiPost<{ jobId: string }>("/api/clusters/rebuild", { projectId });
      await waitForJobCompletion(jobId);
      await load();
    } finally {
      setRebuilding(false);
    }
  }

  async function handleOpen(clusterId: string) {
    const { websites } = await apiGet<{ websites: Website[] }>(`/api/clusters/${clusterId}?projectId=${projectId}`);
    setExpandedClusterId(clusterId);
    setExpandedWebsites(websites);
  }

  function handleExport(clusterId: string) {
    window.open(`/api/export?projectId=${projectId}&clusterId=${clusterId}&format=xlsx`, "_blank");
  }

  return (
    <AppShell projectId={projectId}>
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">Кластеры</h1>
            <p className="text-text-secondary text-sm mt-1">
              Группы сайтов с потенциально общей технической инфраструктурой.
            </p>
          </div>
          <button className="btn-secondary text-xs" onClick={handleRebuild} disabled={rebuilding}>
            {rebuilding ? "Пересчёт…" : "Пересчитать кластеры"}
          </button>
        </div>

        {!clusters ? (
          <p className="text-text-secondary text-sm">Загрузка…</p>
        ) : clusters.length === 0 ? (
          <p className="text-text-secondary text-sm">
            Кластеров пока нет. Проанализируйте несколько сайтов и запустите «Искать схожее», затем
            нажмите «Пересчитать кластеры».
          </p>
        ) : (
          <div className="space-y-3">
            {clusters.map((c) => (
              <div key={c.id}>
                <ClusterCard cluster={c} onOpen={() => handleOpen(c.id)} onExport={() => handleExport(c.id)} />
                {expandedClusterId === c.id && (
                  <div className="panel rounded-md mt-1 p-3 space-y-1">
                    {expandedWebsites.map((w) => (
                      <button
                        key={w.id}
                        onClick={() => setOpenWebsiteId(w.id)}
                        className="block w-full text-left font-mono text-xs text-text-secondary hover:text-accent-teal py-1"
                      >
                        {w.domain}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      {openWebsiteId && (
        <WebsiteDrawer projectId={projectId} websiteId={openWebsiteId} onClose={() => setOpenWebsiteId(null)} />
      )}
    </AppShell>
  );
}
