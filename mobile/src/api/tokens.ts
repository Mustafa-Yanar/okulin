import type { KeyValueStore } from '../store/storage';

// Access/refresh token deposu. SecureStore değerleri küçük tutulur (~2KB sınır) —
// oturum payload'ı SAKLANMAZ (boot'ta /me çekilir, plan ADR'si).
//
// epoch (İnceleme Codex #8): logout/kurum değişimi sayacı. Geç gelen bir refresh
// yanıtı, arada logout/yeni login olduysa eski oturumu DİRİLTMESİN ve yenisini
// EZMESİN diye setPair beklenen epoch ile çağrılır; clear() epoch'u artırır,
// eşleşmeyen yazım reddedilir (false döner).

export interface TokenStore {
  getAccess(): Promise<string | null>;
  getRefresh(): Promise<string | null>;
  epoch(): number;
  setPair(p: { accessToken: string; refreshToken: string }, expectedEpoch?: number): Promise<boolean>;
  clear(): Promise<void>;
}

const ACCESS_KEY = 'okulin.access';
const REFRESH_KEY = 'okulin.refresh';

export function createTokenStore(kv: KeyValueStore): TokenStore {
  let epoch = 0;
  return {
    getAccess: () => kv.get(ACCESS_KEY),
    getRefresh: () => kv.get(REFRESH_KEY),
    epoch: () => epoch,
    async setPair(p, expectedEpoch) {
      if (expectedEpoch !== undefined && expectedEpoch !== epoch) return false; // bayat yazım
      // Yazım sırası REFRESH-ÖNCE (İnceleme Codex #8): uygulama iki yazım arasında
      // ölürse "yeni refresh + eski access" kalır — eski access 401 yer, refresh
      // çalışır. Ters sıra "yeni access + eski refresh" bırakırdı; eski refresh
      // sonraki kullanımda grace-dışı REUSE sayılıp oturumu kapatırdı.
      await kv.set(REFRESH_KEY, p.refreshToken);
      await kv.set(ACCESS_KEY, p.accessToken);
      return true;
    },
    async clear() {
      epoch++;
      await kv.del(ACCESS_KEY);
      await kv.del(REFRESH_KEY);
    },
  };
}
