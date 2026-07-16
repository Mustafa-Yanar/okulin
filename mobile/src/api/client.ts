import type {
  LoginRequest,
  MobileRoleCategory,
  TokenPairResponse,
} from './types';
import type { TokenStore } from './tokens';

// Tipli /api/mobile/v1 istemcisi.
// - Her istekte Bearer + x-okulin-app başlığı.
// - 401 → TEK-UÇUŞ refresh mutex (Plan 2 devri Gemini #5: eşzamanlı 401'ler tek
//   refresh paylaşır — rotation'da ikinci istek eski token'la reuse tetiklemesin) →
//   başarılıysa isteği BİR KEZ tekrarlar.
// - Refresh 401/4xx → oturum bitti: token'lar silinir + onSessionExpired.
// - Refresh AĞ hatası → token'lar KORUNUR (offline oturum düşürmez), istek ApiError(0) atar.
// - Token'lar asla loglanmaz.

export class ApiError extends Error {
  status: number;
  correctRole?: MobileRoleCategory;
  constructor(status: number, message: string, correctRole?: MobileRoleCategory) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.correctRole = correctRole;
  }
}

export interface ApiClientOpts {
  baseUrl: string; // https://<canonicalHost>
  tokens: TokenStore;
  appVersion?: string;
  fetchFn?: typeof fetch; // test enjeksiyonu
  onSessionExpired?: () => void;
  refreshRetryDelayMs?: number; // test enjeksiyonu (default 2000)
}

export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  del<T>(path: string, body?: unknown): Promise<T>;
  login(body: LoginRequest): Promise<TokenPairResponse>;
  logout(): Promise<void>;
}

type RefreshOutcome = 'ok' | 'invalid' | 'network';

export function createApiClient(opts: ApiClientOpts): ApiClient {
  const f = opts.fetchFn ?? fetch;
  let refreshing: Promise<RefreshOutcome> | null = null;

  const baseHeaders = (): Record<string, string> => ({
    'content-type': 'application/json',
    'x-okulin-app': `android/${opts.appVersion ?? '0.0.0'}`,
  });

  async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
    return (await res.json().catch(() => null)) as Record<string, unknown> | null;
  }

  function toError(res: Response, body: Record<string, unknown> | null): ApiError {
    return new ApiError(
      res.status,
      String(body?.error ?? `Sunucu hatası (${res.status})`),
      body?.correctRole as MobileRoleCategory | undefined,
    );
  }

  async function doRefresh(): Promise<RefreshOutcome> {
    const refreshToken = await opts.tokens.getRefresh();
    if (!refreshToken) return 'invalid';
    const epoch = opts.tokens.epoch(); // bayat-yanıt kilidi (İnceleme Codex #8)
    const attempt = () =>
      f(`${opts.baseUrl}/api/mobile/v1/auth/refresh`, {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ refreshToken }),
      });
    let res: Response;
    try {
      res = await attempt();
    } catch {
      // Kısa ağ hıçkırığında rotation grace penceresi (30 sn) içinde bir kez daha
      // dene (İnceleme Codex #9): yanıt kaybolduysa sunucu çoktan rotate etmiştir —
      // grace içindeki tekrar meşru yoldan yeni çift verir; geç kalınırsa sunucu
      // REUSE sayıp oturumu kapatır (bilinçli güvenlik sınırı, plan ADR'si).
      await new Promise((r) => setTimeout(r, opts.refreshRetryDelayMs ?? 2000));
      try {
        res = await attempt();
      } catch {
        return 'network';
      }
    }
    if (!res.ok) {
      // Yalnız KESİN kimlik hataları oturumu düşürür (İnceleme Codex #7): 429/5xx
      // (limit, bakım, geçici arıza) token'ları KORUR — okul NAT'ında IP limitinin
      // dolması kitlesel logout üretmesin.
      if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
      return 'network';
    }
    const pair = (await parseJson(res)) as unknown as TokenPairResponse | null;
    if (!pair?.accessToken) return 'network'; // bozuk 2xx gövdesi — oturumu düşürme
    const written = await opts.tokens.setPair(pair, epoch);
    if (!written) return 'invalid'; // arada logout/kurum değişimi oldu — bayat yanıtı at
    return 'ok';
  }

  async function request<T>(path: string, method: string, body?: unknown, allowRetry = true): Promise<T> {
    const access = await opts.tokens.getAccess();
    let res: Response;
    try {
      res = await f(opts.baseUrl + path, {
        method,
        headers: { ...baseHeaders(), ...(access ? { authorization: `Bearer ${access}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError(0, 'Bağlantı kurulamadı. İnternetinizi kontrol edin.');
    }
    if (res.status === 401 && allowRetry) {
      refreshing ??= doRefresh().finally(() => {
        refreshing = null;
      });
      const outcome = await refreshing;
      if (outcome === 'ok') return request<T>(path, method, body, false);
      if (outcome === 'invalid') {
        await opts.tokens.clear();
        opts.onSessionExpired?.();
        throw new ApiError(401, 'Oturum süresi doldu. Yeniden giriş yapın.');
      }
      throw new ApiError(0, 'Bağlantı kurulamadı. İnternetinizi kontrol edin.');
    }
    const json = await parseJson(res);
    if (!res.ok) throw toError(res, json);
    return json as T;
  }

  return {
    get: (path) => request(path, 'GET'),
    post: (path, body) => request(path, 'POST', body ?? {}),
    del: (path, body) => request(path, 'DELETE', body),

    // Login 401-refresh yoluna GİRMEZ (yanlış şifre refresh tetiklememeli).
    async login(body: LoginRequest): Promise<TokenPairResponse> {
      let res: Response;
      try {
        res = await f(`${opts.baseUrl}/api/mobile/v1/auth/login`, {
          method: 'POST',
          headers: baseHeaders(),
          body: JSON.stringify(body),
        });
      } catch {
        throw new ApiError(0, 'Bağlantı kurulamadı. İnternetinizi kontrol edin.');
      }
      const json = await parseJson(res);
      if (!res.ok) throw toError(res, json);
      const pair = json as unknown as TokenPairResponse;
      await opts.tokens.setPair(pair);
      return pair;
    },

    // Sunucu iptali best-effort (offline çıkışta da yerel oturum kapanır);
    // token'lar HER DURUMDA silinir.
    async logout(): Promise<void> {
      try {
        await request('/api/mobile/v1/auth/logout', 'POST', {}, false);
      } catch {
        /* offline/iptal edilmiş oturum — yerel temizlik yeter */
      }
      await opts.tokens.clear();
    },
  };
}
