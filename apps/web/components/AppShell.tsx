"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "search", label: "Поиск", glyph: "◎" },
  { href: "network", label: "Граф", glyph: "◈" },
  { href: "clusters", label: "Кластеры", glyph: "▤" },
];

export function AppShell({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-screen">
      <nav className="w-16 shrink-0 border-r border-border bg-surface flex flex-col items-center py-4 gap-1">
        <div className="w-8 h-8 rounded-sm bg-accent-teal/20 border border-accent-teal/40 mb-4 flex items-center justify-center text-accent-teal text-sm font-mono">
          SN
        </div>
        {ITEMS.map((item) => {
          const href = `/projects/${projectId}/${item.href}`;
          const active = pathname?.startsWith(href);
          return (
            <Link
              key={item.href}
              href={href}
              className={`w-11 h-11 flex flex-col items-center justify-center gap-0.5 rounded-sm text-[10px] transition-colors ${
                active
                  ? "bg-accent-teal/15 text-accent-teal"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-raised"
              }`}
            >
              <span className="text-base leading-none">{item.glyph}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  );
}
