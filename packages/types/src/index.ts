/**
 * Общие типы данных, разделяемые между apps/web и services/browser-worker.
 * Соответствуют документам Firestore, см. firestore.rules и README.md.
 */

export type Device = "desktop" | "mobile";

export type JobType =
  | "SEARCH_GOOGLE"
  | "ANALYZE_WEBSITE"
  | "ANALYZE_BATCH"
  | "FIND_SIMILAR"
  | "EXPAND_NETWORK"
  | "BUILD_CLUSTER";

export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type WebsiteStatus =
  | "PENDING"
  | "ANALYZING"
  | "ANALYZED"
  | "FAILED"
  | "BLOCKED_BY_ROBOTS"
  | "SSRF_BLOCKED"
  | "TIMEOUT"
  | "SSL_ERROR"
  | "HTTP_ERROR";

/** jobs/{jobId} — единственная top-level коллекция, не вложенная под users. */
export interface AnalysisJob {
  id: string;
  userId: string;
  projectId: string;
  type: JobType;
  status: JobStatus;
  progress: number; // 0..100
  total: number;
  processed: number;
  error: string | null;
  payload: Record<string, unknown>;
  depth?: number; // для EXPAND_NETWORK — глубина 1..3
  workerId?: string; // кто "забрал" job (см. jobRunner.ts)
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
}

/** users/{userId}/projects/{projectId}/searches/{searchId} */
export interface SearchQuery {
  id: string;
  projectId: string;
  keywords: string;
  country: string; // ISO 3166-1 alpha-2, напр. "PL"
  language: string; // BCP-47, напр. "ru"
  device: Device;
  extraParams?: Record<string, string>;
  createdAt: number;
}

/** users/{userId}/projects/{projectId}/searches/{searchId}/results/{resultId} */
export interface SearchResultItem {
  id: string;
  searchId: string;
  position: number; // 1..20 (первые 2 страницы)
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  snippet: string;
  sourceQuery: string;
  region: string;
  language: string;
  device: Device;
  fetchedAt: number;
}

/** users/{userId}/projects/{projectId}/websites/{websiteId} */
export interface Website {
  id: string;
  projectId: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  status: WebsiteStatus;
  finalUrl?: string; // после редиректов
  httpStatus?: number;
  discoveredFromSearchId?: string;
  discoveredAtDepth?: number; // 0 = исходный поиск, 1..N = "Расширить сеть"
  lastAnalyzedAt: number | null;
  createdAt: number;
  /**
   * Денормализованные счётчики (обновляются worker'ом при анализе) — чтобы
   * таблица результатов могла показать "GTM: 2" / "Ext. domains: 7" без
   * отдельного чтения подколлекций на каждую строку.
   */
  gtmCount?: number;
  externalDomainsCount?: number;
}

export type GTMDetectionMethod =
  | "SCRIPT_SRC"
  | "INLINE_SCRIPT_ID"
  | "NOSCRIPT_IFRAME"
  | "DATALAYER_PUSH"
  | "NETWORK_REQUEST";

/** users/{userId}/projects/{projectId}/websites/{websiteId}/gtmContainers/{id} */
export interface GTMContainer {
  id: string;
  websiteId: string;
  gtmId: string; // "GTM-XXXXXXX"
  detectionMethod: GTMDetectionMethod;
  sourceUrl: string;
  detectedAt: number;
}

export type ExternalResourceType =
  | "SCRIPT"
  | "IFRAME"
  | "IMAGE"
  | "STYLESHEET"
  | "API_CALL"
  | "LINK"
  | "PIXEL"
  | "FONT"
  | "OTHER";

export type ExternalResourceCategory =
  | "ANALYTICS"
  | "ADVERTISING"
  | "CDN"
  | "SOCIAL"
  | "UNKNOWN";

/** users/{userId}/projects/{projectId}/websites/{websiteId}/externalResources/{id} */
export interface ExternalResource {
  id: string;
  websiteId: string;
  domain: string;
  resourceType: ExternalResourceType;
  category: ExternalResourceCategory;
  sampleSourceUrl: string;
  occurrenceCount: number;
  locations: string[]; // где встречается: "html", "script:xyz.js", ...
  /**
   * Только для resourceType === "LINK": куда РЕАЛЬНО ведёт ссылка после всех
   * HTTP-редиректов (см. redirectResolver.ts). Домен самой ссылки может быть
   * промежуточным редирект-сервисом (трекер перехода, укорачиватель) —
   * finalDomain показывает настоящий пункт назначения.
   */
  finalDomain?: string;
  redirectChain?: string[];
}

export type TrackingProvider =
  | "GOOGLE_ANALYTICS_UA"
  | "GOOGLE_ANALYTICS_GA4"
  | "FACEBOOK_PIXEL"
  | "YANDEX_METRIKA"
  | "HOTJAR"
  | "TIKTOK_PIXEL"
  | "OTHER";

/** users/{userId}/projects/{projectId}/websites/{websiteId}/trackingIdentifiers/{id} */
export interface TrackingIdentifier {
  id: string;
  websiteId: string;
  provider: TrackingProvider;
  identifier: string; // напр. "UA-12345678-1", "G-ABCDEF1234"
  detectionMethod: string;
  sourceUrl: string;
}

/** users/{userId}/projects/{projectId}/websites/{websiteId}/scripts/{id} */
export interface ScriptRecord {
  id: string;
  websiteId: string;
  scriptUrl: string | null; // null для inline
  inline: boolean;
  contentHash: string; // sha256 нормализованного содержимого
  isCommonLibrary: boolean; // jquery/gtag.js/bootstrap и т.п. — низкий вес в скоринге
}

/** users/{userId}/projects/{projectId}/websites/{websiteId}/endpoints/{id} */
export interface EndpointRecord {
  id: string;
  websiteId: string;
  url: string;
  method: string;
  domain: string;
}

/** users/{userId}/projects/{projectId}/websites/{websiteId}/fingerprint (singleton doc) */
export interface WebsiteFingerprint {
  websiteId: string;
  gtmIds: string[];
  trackingIds: string[];
  uniqueScriptHashes: string[]; // только НЕ common library скрипты
  externalDomains: string[]; // без крупных CDN общего пользования
  apiEndpoints: string[];
  fingerprintHash: string;
  computedAt: number;
}

export interface EvidenceItem {
  type:
    | "SAME_GTM"
    | "SAME_TRACKING_ID"
    | "SAME_SCRIPT"
    | "SAME_API_ENDPOINT"
    | "SAME_EXTERNAL_DOMAIN"
    | "SAME_CDN";
  description: string;
  weight: number;
}

/** users/{userId}/projects/{projectId}/relationships/{id} */
export interface Relationship {
  id: string;
  projectId: string;
  sourceWebsiteId: string;
  targetWebsiteId: string;
  score: number; // 0..100
  evidence: EvidenceItem[];
  computedAt: number;
}

/** users/{userId}/projects/{projectId}/clusters/{id} */
export interface Cluster {
  id: string;
  projectId: string;
  websiteIds: string[];
  sharedGTMIds: string[];
  sharedExternalDomains: string[];
  sharedTrackingIds: string[];
  sharedScriptHashes: string[];
  confidence: number; // 0..100, средняя по внутренним связям
  label: string; // напр. "Potentially related infrastructure"
  createdAt: number;
  updatedAt: number;
}
