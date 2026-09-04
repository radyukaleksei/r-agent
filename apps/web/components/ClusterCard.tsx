import type { Cluster } from "@site-network-agent/types";

export function ClusterCard({
  cluster,
  onOpen,
  onExport,
}: {
  cluster: Cluster;
  onOpen: () => void;
  onExport: () => void;
}) {
  return (
    <div className="panel rounded-md p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-sm font-medium">
            Cluster — {cluster.websiteIds.length} site{cluster.websiteIds.length === 1 ? "" : "s"}
          </div>
          <div className="text-accent-amber text-xs mt-0.5">{cluster.label}</div>
        </div>
        <ConfidenceGauge value={cluster.confidence} />
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-xs text-text-secondary">
        {cluster.sharedGTMIds.length > 0 && <Tag label={`${cluster.sharedGTMIds.length} общих GTM`} />}
        {cluster.sharedTrackingIds.length > 0 && (
          <Tag label={`${cluster.sharedTrackingIds.length} общих tracking ID`} />
        )}
        {cluster.sharedExternalDomains.length > 0 && (
          <Tag label={`${cluster.sharedExternalDomains.length} общих доменов`} />
        )}
        {cluster.sharedScriptHashes.length > 0 && (
          <Tag label={`${cluster.sharedScriptHashes.length} общих скриптов`} />
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <button className="btn-secondary text-xs" onClick={onOpen}>
          Открыть сайты
        </button>
        <button className="btn-secondary text-xs" onClick={onExport}>
          Экспорт отчёта
        </button>
      </div>
    </div>
  );
}

function Tag({ label }: { label: string }) {
  return <span className="mono-tag">{label}</span>;
}

function ConfidenceGauge({ value }: { value: number }) {
  return (
    <div className="text-right">
      <div className="text-lg font-mono text-accent-teal leading-none">{value}</div>
      <div className="w-16 h-1 bg-surface-raised rounded-full mt-1.5 overflow-hidden">
        <div className="h-full bg-accent-teal" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
