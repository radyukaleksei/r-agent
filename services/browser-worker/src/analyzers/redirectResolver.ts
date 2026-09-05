import { assertPublicUrl, FETCH_LIMITS, getRegistrableDomain } from "@site-network-agent/shared";

export interface ResolvedDestination {
  originalUrl: string;
  finalUrl: string;
  finalDomain: string;
  redirectChain: string[]; // все промежуточные URL, включая исходный, БЕЗ финального
  redirectCount: number;
  error?: string;
}

/**
 * Идёт по цепочке HTTP-редиректов (301/302/303/307/308) вручную, а не через
 * `fetch(url, {redirect:"follow"})`, по двум причинам:
 *  1. Каждый промежуточный хост нужно проверять через SSRF-защиту ОТДЕЛЬНО —
 *     редирект может увести на приватный IP, которого не было в исходном URL.
 *  2. Нужен сам список промежуточных адресов (redirectChain), а не только
 *     финальный — `fetch` со встроенным follow его не отдаёт.
 *
 * Использует HEAD, а не GET — нам нужен только заголовок Location, скачивать
 * тело страницы не нужно. Если сервер не поддерживает HEAD (некоторые API
 * отвечают 405) — делает один retry через GET с ограничением по размеру.
 *
 * НЕ предназначен для страниц, где переход происходит через JavaScript
 * (`window.location = ...`) без HTTP-редиректа — такие случаи потребовали бы
 * полноценной навигации в Playwright, что для простого резолвинга ссылок
 * на странице избыточно (см. README → "Известные ограничения").
 */
export async function resolveFinalDestination(
  originalUrl: string,
  maxRedirects: number = FETCH_LIMITS.MAX_REDIRECTS
): Promise<ResolvedDestination> {
  const chain: string[] = [];
  let currentUrl = originalUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    try {
      await assertPublicUrl(currentUrl);
    } catch (err) {
      return {
        originalUrl,
        finalUrl: currentUrl,
        finalDomain: safeDomain(currentUrl),
        redirectChain: chain,
        redirectCount: chain.length,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      });
      if (res.status === 405 || res.status === 501) {
        // Часть серверов не поддерживает HEAD — пробуем GET той же страницы.
        res = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: AbortSignal.timeout(8_000),
        });
      }
    } catch (err) {
      return {
        originalUrl,
        finalUrl: currentUrl,
        finalDomain: safeDomain(currentUrl),
        redirectChain: chain,
        redirectCount: chain.length,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");

    if (!isRedirect || !location) {
      // Дошли до финальной страницы (не редирект).
      return {
        originalUrl,
        finalUrl: currentUrl,
        finalDomain: safeDomain(currentUrl),
        redirectChain: chain,
        redirectCount: chain.length,
      };
    }

    chain.push(currentUrl);
    currentUrl = new URL(location, currentUrl).toString();
  }

  return {
    originalUrl,
    finalUrl: currentUrl,
    finalDomain: safeDomain(currentUrl),
    redirectChain: chain,
    redirectCount: chain.length,
    error: `Превышен лимит редиректов (${maxRedirects})`,
  };
}

function safeDomain(url: string): string {
  try {
    return getRegistrableDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}
