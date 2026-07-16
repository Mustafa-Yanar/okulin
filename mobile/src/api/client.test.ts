import { describe, it, expect, vi } from 'vitest';
import { createApiClient, ApiError } from './client';
import { createTokenStore } from './tokens';
import type { KeyValueStore } from '../store/storage';

function memoryStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => void m.set(k, v),
    del: async (k) => void m.delete(k),
  };
}

const PAIR = {
  accessToken: 'acc-2',
  refreshToken: 'ref-2',
  expiresIn: 900,
  sessionId: 'ms_1',
  session: { role: 'student', id: 's1', org: 'testkurs', branch: 'main' },
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function makeClient(fetchFn: typeof fetch, onSessionExpired?: () => void) {
  const tokens = createTokenStore(memoryStore());
  const client = createApiClient({
    baseUrl: 'https://testkurs.okulin.com',
    tokens,
    appVersion: '0.1.0',
    fetchFn,
    onSessionExpired,
    refreshRetryDelayMs: 1, // testte 2 sn bekleme olmasın
  });
  return { client, tokens };
}

describe('createApiClient', () => {
  it('Bearer + x-okulin-app başlıklarını ekler', async () => {
    let seen: Record<string, string> = {};
    const f = vi.fn(async (_url: unknown, init?: RequestInit) => {
      seen = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
      return json(200, { ok: true });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'acc-1', refreshToken: 'ref-1' });
    await client.get('/api/mobile/v1/me');
    expect(seen.authorization).toBe('Bearer acc-1');
    expect(seen['x-okulin-app']).toBe('android/0.1.0');
  });

  it('401 → refresh → TEK tekrar; eşzamanlı iki 401 TEK refresh çağrısı yapar (mutex)', async () => {
    let refreshCalls = 0;
    const f = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        refreshCalls++;
        await new Promise((r) => setTimeout(r, 20)); // yarışı garantile
        return json(200, PAIR);
      }
      const auth = ((init?.headers ?? {}) as Record<string, string>).authorization;
      if (auth === 'Bearer acc-2') return json(200, { session: PAIR.session });
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'acc-eski', refreshToken: 'ref-1' });
    const [a, b] = await Promise.all([
      client.get<{ session: { id: string } }>('/api/mobile/v1/me'),
      client.get<{ session: { id: string } }>('/api/mobile/v1/me'),
    ]);
    expect(a.session.id).toBe('s1');
    expect(b.session.id).toBe('s1');
    expect(refreshCalls).toBe(1);
    expect(await tokens.getRefresh()).toBe('ref-2'); // yeni çift kaydedildi
  });

  it('refresh 401 → token temizle + onSessionExpired', async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) return json(401, { error: 'Oturum geçersiz' });
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    await expect(client.get('/api/mobile/v1/me')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expect(await tokens.getRefresh()).toBeNull();
  });

  it('refresh AĞ hatası → token KORUNUR (offline oturum düşürmez)', async () => {
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) throw new TypeError('network');
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    await expect(client.get('/api/mobile/v1/me')).rejects.toBeInstanceOf(ApiError);
    expect(await tokens.getRefresh()).toBe('r');
  });

  it('refresh 503 (geçici sunucu hatası) → token KORUNUR, onSessionExpired ÇAĞRILMAZ', async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) return json(503, { error: 'bakım' });
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    await expect(client.get('/api/mobile/v1/me')).rejects.toMatchObject({ status: 0 });
    expect(expired).not.toHaveBeenCalled();
    expect(await tokens.getRefresh()).toBe('r');
  });

  it('refresh sürerken clear (logout yarışı) → geç gelen çift YAZILMAZ (epoch)', async () => {
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 30));
        return json(200, PAIR);
      }
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    const inflight = client.get('/api/mobile/v1/me').catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    await tokens.clear(); // kullanıcı tam bu anda çıkış yaptı
    await inflight;
    expect(await tokens.getRefresh()).toBeNull(); // oturum diriltilmedi
  });

  it('bayat refresh (yeniden giriş sonrası) taze oturumu EZMEZ — 200 dönüşü', async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 30));
        return json(200, PAIR); // eski oturumun rotate ettiği (artık bayat) çift
      }
      return json(401, { error: 'Giriş gerekli' }); // eski access ile /me hep 401
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'eski-acc', refreshToken: 'eski-ref' });
    const inflight = client.get('/api/mobile/v1/me').catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    // Kullanıcı tam bu anda çıkış yapıp YENİDEN girdi — taze oturum kuruldu.
    await tokens.clear();
    await tokens.setPair({ accessToken: 'yeni-acc', refreshToken: 'yeni-ref' });
    await inflight; // bayat refresh burada 200 ile döner ama epoch uymaz
    expect(await tokens.getRefresh()).toBe('yeni-ref');
    expect(await tokens.getAccess()).toBe('yeni-acc');
    expect(expired).not.toHaveBeenCalled();
  });

  it('bayat refresh (yeniden giriş sonrası) taze oturumu EZMEZ — 401 dönüşü', async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 30));
        return json(401, { error: 'Oturum geçersiz' }); // eski oturum sunucuda da geçersiz
      }
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'eski-acc', refreshToken: 'eski-ref' });
    const inflight = client.get('/api/mobile/v1/me').catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    await tokens.clear();
    await tokens.setPair({ accessToken: 'yeni-acc', refreshToken: 'yeni-ref' });
    await inflight; // bayat refresh burada 401 (kimlik hatası) ile döner ama epoch uymaz
    expect(await tokens.getRefresh()).toBe('yeni-ref');
    expect(await tokens.getAccess()).toBe('yeni-acc');
    expect(expired).not.toHaveBeenCalled();
  });

  it("eşzamanlı 401'lerde onSessionExpired TEK kez", async () => {
    const expired = vi.fn();
    const f = vi.fn(async (url: unknown) => {
      if (String(url).endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 20)); // yarışı garantile
        return json(401, { error: 'Oturum geçersiz' });
      }
      return json(401, { error: 'Giriş gerekli' });
    }) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f, expired);
    await tokens.setPair({ accessToken: 'a', refreshToken: 'r' });
    const results = await Promise.allSettled([
      client.get('/api/mobile/v1/me'),
      client.get('/api/mobile/v1/me'),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('rejected');
    expect(expired).toHaveBeenCalledOnce();
    expect(await tokens.getRefresh()).toBeNull();
  });

  it('login: hata gövdesindeki error + correctRole ApiError\'a taşınır', async () => {
    const f = vi.fn(async () =>
      json(403, { error: 'Bu bilgiler Veli hesabına ait.', correctRole: 'parent' }),
    ) as unknown as typeof fetch;
    const { client } = makeClient(f);
    await expect(client.login({ username: 'x', password: 'y', role: 'student' })).rejects.toMatchObject({
      status: 403,
      correctRole: 'parent',
    });
  });

  it('login başarılı → çift kaydedilir', async () => {
    const f = vi.fn(async () => json(200, PAIR)) as unknown as typeof fetch;
    const { client, tokens } = makeClient(f);
    const r = await client.login({ username: 'x', password: 'y' });
    expect(r.session.role).toBe('student');
    expect(await tokens.getAccess()).toBe('acc-2');
  });
});
