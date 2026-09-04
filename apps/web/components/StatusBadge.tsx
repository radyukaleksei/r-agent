import type { WebsiteStatus } from "@site-network-agent/types";

const STYLES: Record<WebsiteStatus, { label: string; className: string }> = {
  PENDING: { label: "Не анализирован", className: "text-text-secondary border-border" },
  ANALYZING: { label: "Анализ…", className: "text-accent-teal border-accent-teal/40" },
  ANALYZED: { label: "Готово", className: "text-accent-teal border-accent-teal/40 bg-accent-teal/10" },
  FAILED: { label: "Ошибка", className: "text-accent-rose border-accent-rose/40" },
  BLOCKED_BY_ROBOTS: { label: "robots.txt", className: "text-accent-amber border-accent-amber/40" },
  SSRF_BLOCKED: { label: "Заблокирован (SSRF)", className: "text-accent-rose border-accent-rose/40" },
  TIMEOUT: { label: "Timeout", className: "text-accent-amber border-accent-amber/40" },
  SSL_ERROR: { label: "SSL ошибка", className: "text-accent-rose border-accent-rose/40" },
  HTTP_ERROR: { label: "HTTP ошибка", className: "text-accent-amber border-accent-amber/40" },
};

export function StatusBadge({ status }: { status: WebsiteStatus }) {
  const style = STYLES[status];
  return (
    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded-sm border ${style.className}`}>
      {style.label}
    </span>
  );
}
