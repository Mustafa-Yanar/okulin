import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { _fcmAssertion, deliver } from './providers';

// web-push modülünü mockla (gerçek push servisi çağrılmaz)
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));
import webpush from 'web-push';

// Test için geçici RS256 anahtarı (gerçek service-account taklidi)
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('_fcmAssertion', () => {
  it('Google token uçuna uygun RS256 JWT üretir', async () => {
    const jwt = await _fcmAssertion('svc@okulin-mobil.iam.gserviceaccount.com', pkcs8, 1_800_000_000);
    expect(decodeProtectedHeader(jwt).alg).toBe('RS256');
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe('svc@okulin-mobil.iam.gserviceaccount.com');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.iat).toBe(1_800_000_000);
    expect(claims.exp).toBe(1_800_000_000 + 3600);
  });
});

describe('deliver — webpush', () => {
  beforeEach(() => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'pub');
    vi.stubEnv('VAPID_PRIVATE_KEY', 'priv');
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

  const target = { provider: 'webpush' as const, target: 'https://fcm.googleapis.com/ep/abc', keys: { p256dh: 'k1', auth: 'k2' } };
  const notif = { title: 'T', body: 'B' };

  it('başarılı gönderim → ok', async () => {
    vi.mocked(webpush.sendNotification).mockResolvedValueOnce({ statusCode: 201 } as never);
    const r = await deliver(target, notif);
    expect(r).toEqual({ ok: true, permanent: false });
  });
  it('410 Gone → kalıcı hata (abonelik ölü)', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 410 });
    const r = await deliver(target, notif);
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(true);
  });
  it('5xx → geçici hata (retry edilir)', async () => {
    vi.mocked(webpush.sendNotification).mockRejectedValueOnce({ statusCode: 503 });
    const r = await deliver(target, notif);
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(false);
  });
});

describe('deliver — fcm', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it('env yoksa geçici hata döner (yapılandırma gelince retry başarır)', async () => {
    vi.stubEnv('FCM_CLIENT_EMAIL', '');
    vi.stubEnv('FCM_PRIVATE_KEY', '');
    const r = await deliver({ provider: 'fcm', target: 'tok1' }, { title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(false);
    expect(r.error).toContain('FCM yapılandırılmamış');
  });
  it('UNREGISTERED (404) → kalıcı hata', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'okulin-mobil');
    vi.stubEnv('FCM_CLIENT_EMAIL', 'svc@x.iam.gserviceaccount.com');
    vi.stubEnv('FCM_PRIVATE_KEY', pkcs8.replace(/\n/g, '\\n'));
    const fetchMock = vi.fn()
      // 1. çağrı: OAuth token
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 }))
      // 2. çağrı: FCM send → 404 UNREGISTERED
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await deliver({ provider: 'fcm', target: 'dead-token' }, { title: 'T', body: 'B' });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('başarılı gönderim → ok + providerId', async () => {
    vi.stubEnv('FCM_PROJECT_ID', 'okulin-mobil');
    vi.stubEnv('FCM_CLIENT_EMAIL', 'svc@x.iam.gserviceaccount.com');
    vi.stubEnv('FCM_PRIVATE_KEY', pkcs8.replace(/\n/g, '\\n'));
    // NOT: önceki testte OAuth token cache'i module-içi (_tokenCache) dolduruldu ve
    // aynı email/key kullanıldığından burada süresi dolmamış olabilir — bu durumda
    // OAuth fetch'i ATLANIR ve tek fetch çağrısı doğrudan FCM-send'e gider.
    // Bu yüzden yanıtları çağrı SIRASINA göre değil istek URL'sine göre eşleştiriyoruz
    // (mockResolvedValueOnce zinciri cache isabetinde yanlış yanıtı eşleştirirdi).
    const fetchMock = vi.fn((url: unknown, _init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return Promise.resolve(new Response(JSON.stringify({ access_token: 'at2', expires_in: 3600 }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ name: 'projects/okulin-mobil/messages/m1' }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await deliver({ provider: 'fcm', target: 'tok2' }, { title: 'T', body: 'B', url: '/?sekme=odeme' });
    expect(r.ok).toBe(true);
    expect(r.providerId).toBe('projects/okulin-mobil/messages/m1');
    // FCM v1 gövdesi doğru mu?
    const fcmBody = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string);
    expect(fcmBody.message.token).toBe('tok2');
    expect(fcmBody.message.notification).toEqual({ title: 'T', body: 'B' });
    expect(fcmBody.message.data).toEqual({ url: '/?sekme=odeme' });
  });
});

describe('fcmAccessToken sertleştirme (taze modül)', () => {
  beforeEach(() => {
    vi.stubEnv('FCM_PROJECT_ID', 'okulin-mobil');
    vi.stubEnv('FCM_CLIENT_EMAIL', 'svc@x.iam.gserviceaccount.com');
    vi.stubEnv('FCM_PRIVATE_KEY', pkcs8.replace(/\n/g, '\\n'));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('eşzamanlı iki çağrı TEK OAuth isteği yapar (in-flight de-dup)', async () => {
    vi.resetModules();
    const { fcmAccessToken } = await import('./providers');
    let oauthCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        oauthCalls++;
        await new Promise((r) => setTimeout(r, 20)); // yarışı garantile
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      throw new Error('beklenmeyen fetch');
    }));
    const [a, b] = await Promise.all([fcmAccessToken(), fcmAccessToken()]);
    expect(a).toBe('tok');
    expect(b).toBe('tok');
    expect(oauthCalls).toBe(1);
  });

  it('bozuk OAuth gövdesi fırlatmaz, null döner', async () => {
    vi.resetModules();
    const { fcmAccessToken } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('html hata sayfası', { status: 200 })));
    expect(await fcmAccessToken()).toBeNull();
  });

  it('OAuth ağ hatası fırlatmaz, null döner', async () => {
    vi.resetModules();
    const { fcmAccessToken } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    expect(await fcmAccessToken()).toBeNull();
  });

  it('FCM 400 (payload hatası) KALICI SAYILMAZ — cihaz yanlışlıkla disable edilmez', async () => {
    vi.resetModules();
    const { deliver } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [] } }), { status: 400 });
    }));
    const r = await deliver({ provider: 'fcm', target: 'tok-x' }, { title: 't', body: 'b' });
    expect(r.ok).toBe(false);
    expect(r.permanent).toBe(false);
  });

  it('400 + details errorCode=UNREGISTERED → kalıcı (token gerçekten ölü)', async () => {
    vi.resetModules();
    const { deliver } = await import('./providers');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'UNREGISTERED' }] } }),
        { status: 400 },
      );
    }));
    const r = await deliver({ provider: 'fcm', target: 'tok-olu' }, { title: 't', body: 'b' });
    expect(r.permanent).toBe(true);
  });

  it('deliver FCM gövdesine channel_id + data.eventId koyar', async () => {
    vi.resetModules();
    const { deliver } = await import('./providers');
    const bodies: Array<Record<string, never>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      }
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ name: 'projects/x/messages/1' }), { status: 200 });
    }));
    const r = await deliver(
      { provider: 'fcm', target: 'cihaz-token' },
      { title: 't', body: 'b', tag: 'etiket', url: '/x', data: { eventId: 'ne_1' } },
    );
    expect(r.ok).toBe(true);
    const msg = (bodies[0] as { message: { android: { notification: Record<string, string> }; data: Record<string, string> } }).message;
    expect(msg.android.notification.channel_id).toBe('default');
    expect(msg.android.notification.tag).toBe('etiket');
    expect(msg.data).toEqual({ url: '/x', eventId: 'ne_1' });
  });
});
