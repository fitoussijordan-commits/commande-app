/**
 * fetch avec timeout automatique via AbortController.
 * Lève une AbortError si le délai est dépassé.
 *
 * @param url     URL à appeler
 * @param options Options fetch classiques (method, headers, body…)
 * @param ms      Timeout en millisecondes (défaut 8 000)
 */
export async function fetchT(
  url: string,
  options: RequestInit = {},
  ms = 8_000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
