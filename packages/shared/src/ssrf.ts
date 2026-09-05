import { promises as dns } from "node:dns";
import { isIP } from "node:net";

/**
 * Защита от SSRF для browser-worker.
 *
 * Используется В ДВУХ МЕСТАХ:
 *  1. До первого page.goto() — резолвим hostname и проверяем IP.
 *  2. На каждый редирект внутри Playwright (page.on("response")) —
 *     т.к. DNS/редирект могут указать на приватный адрес уже ПОСЛЕ
 *     первичной проверки (TOCTOU/ DNS rebinding).
 *
 * Это не блокирует произвольный "самопальный" http-клиент — если добавляется
 * ещё один способ похода в сеть (fetch внутри Node на стороне worker'а,
 * не через Playwright), он должен использовать те же проверки.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

// IPv4 CIDR-блоки, которые запрещено резолвить/открывать напрямую.
const BLOCKED_IPV4_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (включает cloud metadata 169.254.169.254)
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24], // TEST-NET
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function isIPv4InRange(ip: string, base: string, prefix: number): boolean {
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function isBlockedIPv4(ip: string): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, prefix]) =>
    isIPv4InRange(ip, base, prefix)
  );
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local (fc00::/7)
  if (lower.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — проверяем как IPv4
    const v4 = lower.split(":").pop();
    if (v4 && isIP(v4) === 4) return isBlockedIPv4(v4);
  }
  return false;
}

export class SSRFBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SSRFBlockedError";
  }
}

/**
 * Бросает SSRFBlockedError, если URL нельзя безопасно открыть.
 * Возвращает резолвленные IP-адреса (пригодится для повторной проверки
 * при редиректах на тот же хост в рамках одной навигации).
 */
export async function assertPublicUrl(rawUrl: string): Promise<string[]> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SSRFBlockedError(`Некорректный URL: ${rawUrl}`);
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SSRFBlockedError(`Запрещённая схема URL: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new SSRFBlockedError("URL с embedded-credentials запрещён");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // снять скобки IPv6-литерала

  // Хост уже является IP-литералом
  const ipVersion = isIP(hostname);
  if (ipVersion === 4) {
    if (isBlockedIPv4(hostname)) {
      throw new SSRFBlockedError(`Приватный/зарезервированный IP: ${hostname}`);
    }
    return [hostname];
  }
  if (ipVersion === 6) {
    if (isBlockedIPv6(hostname)) {
      throw new SSRFBlockedError(`Приватный/зарезервированный IPv6: ${hostname}`);
    }
    return [hostname];
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new SSRFBlockedError("localhost запрещён");
  }

  // Резолвим ВСЕ A/AAAA записи и проверяем каждую — домен может резолвиться
  // на несколько адресов (в т.ч. вредоносно — DNS rebinding).
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SSRFBlockedError(`Не удалось резолвить хост: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new SSRFBlockedError(`Хост не резолвится: ${hostname}`);
  }

  for (const { address, family } of addresses) {
    if (family === 4 && isBlockedIPv4(address)) {
      throw new SSRFBlockedError(
        `${hostname} резолвится в приватный IP ${address}`
      );
    }
    if (family === 6 && isBlockedIPv6(address)) {
      throw new SSRFBlockedError(
        `${hostname} резолвится в приватный IPv6 ${address}`
      );
    }
  }

  return addresses.map((a) => a.address);
}

/** Лимиты, которые worker обязан применять при навигации/скачивании. */
export const FETCH_LIMITS = {
  MAX_REDIRECTS: 5,
  MAX_RESPONSE_BYTES: 15 * 1024 * 1024, // 15 MB
  NAVIGATION_TIMEOUT_MS: 20_000,
  MAX_RESOURCES_PER_PAGE: 300,
  // Сколько ждать ПОСЛЕ domcontentloaded, чтобы асинхронные трекеры/теги
  // успели инициализироваться и сделать первые запросы — см. pageAnalyzer.ts.
  POST_LOAD_SETTLE_MS: 4_000,
} as const;
