"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { NetworkGraph } from "@/components/NetworkGraph";
import { WebsiteDrawer } from "@/components/WebsiteDrawer";
import { apiGet } from "@/lib/apiClient";
import { useAuth } from "@/lib/useAuth";
import type { Relationship, Website } from "@site-network-agent/types";

export default function NetworkPage({ params }: { params: { projectId: string } }) {
  const { projectId } = params;
  const { user } = useAuth();
  const [data, setData] = useState<{ websites: Website[]; relationships: Relationship[] } | null>(null);
  const [openWebsiteId, setOpenWebsiteId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    apiGet<{ websites: Website[]; relationships: Relationship[] }>(
      `/api/network?projectId=${projectId}`
    ).then(setData);
  }, [user, projectId]);

  return (
    <AppShell projectId={projectId}>
      <div className="p-6 max-w-6xl">
        <h1 className="text-lg font-semibold mb-1">Граф связей</h1>
        <p className="text-text-secondary text-sm mb-4">
          Клик по сайту открывает подробную карточку. Связи — это гипотезы («Potentially related
          infrastructure»), не утверждения о владельце.
        </p>
        {!data ? (
          <p className="text-text-secondary text-sm">Загрузка…</p>
        ) : (
          <NetworkGraph
            websites={data.websites}
            relationships={data.relationships}
            onSelectSite={setOpenWebsiteId}
          />
        )}
      </div>
      {openWebsiteId && (
        <WebsiteDrawer projectId={projectId} websiteId={openWebsiteId} onClose={() => setOpenWebsiteId(null)} />
      )}
    </AppShell>
  );
}
