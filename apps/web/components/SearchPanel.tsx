"use client";

import { useState } from "react";
import type { Device } from "@site-network-agent/types";

export interface SearchFormValues {
  keywords: string;
  country: string;
  language: string;
  device: Device;
}

const COUNTRIES = [
  { code: "PL", label: "Польша" },
  { code: "US", label: "США" },
  { code: "DE", label: "Германия" },
  { code: "GB", label: "Великобритания" },
  { code: "UA", label: "Украина" },
];
const LANGUAGES = [
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
  { code: "pl", label: "Polski" },
  { code: "de", label: "Deutsch" },
];

export function SearchPanel({
  onSearch,
  isSearching,
}: {
  onSearch: (values: SearchFormValues) => void;
  isSearching: boolean;
}) {
  const [keywords, setKeywords] = useState("");
  const [country, setCountry] = useState("PL");
  const [language, setLanguage] = useState("ru");
  const [device, setDevice] = useState<Device>("desktop");

  return (
    <div className="panel rounded-md p-4 flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[220px]">
        <Label>Keywords</Label>
        <input
          className="input w-full"
          placeholder="Ключевые слова для поиска"
          value={keywords}
          onChange={(e) => setKeywords(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && keywords.trim() && onSearch({ keywords, country, language, device })}
        />
      </div>
      <div>
        <Label>Country</Label>
        <select className="input" value={country} onChange={(e) => setCountry(e.target.value)}>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>{c.label}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Language</Label>
        <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>
      <div>
        <Label>Device</Label>
        <div className="flex border border-border rounded-sm overflow-hidden">
          {(["desktop", "mobile"] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDevice(d)}
              className={`px-3 py-1.5 text-sm ${
                device === d ? "bg-accent-teal text-bg" : "bg-surface-raised text-text-secondary"
              }`}
            >
              {d === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
        </div>
      </div>
      <button
        className="btn-primary"
        disabled={!keywords.trim() || isSearching}
        onClick={() => onSearch({ keywords, country, language, device })}
      >
        {isSearching ? "Ищем…" : "Найти"}
      </button>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-secondary mb-1">{children}</div>;
}
