// Ağ çağrısı zaman aşımı (Plan 3 borcu): RN fetch'inde varsayılan timeout YOK —
// ölü Wi-Fi/asansör senaryosunda istek sonsuz asılı kalır, UI "busy"de kilitlenirdi.
// AbortController ile sınırlanır; çağıran AbortError'u ağ hatası gibi ele alır
// (client.ts zaten tüm fetch hatalarını ApiError(0)'a çevirir).

export const DEFAULT_TIMEOUT_MS = 15000; // içerik/auth istekleri
export const BOOT_TIMEOUT_MS = 10000; // bootstrap/resolve-org (Gate hızlı karar vermeli)

export async function fetchWithTimeout(
  f: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await f(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
