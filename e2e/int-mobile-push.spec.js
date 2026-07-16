/**
 * ENTEGRASYON — mobil push cihaz kaydı + F1 hesap-silme temizliği (canlı testkurs)
 * register (yeni / token rotasyonu / reinstall devri / yetkisiz) → unregister →
 * F1: geçici REHBER hesabı silinince access token ANINDA ölür (purgeMobileAccess).
 *
 * Rate-limit bütçesi: login kovası ip:username (5/15dk) — STU 1 + geçici rehber 1
 * (farklı username → ayrı kova). register kovası rl:mreg 20/10dk (IP ve sid ayrı
 * kovalar) — testte ~9 kayıt isteği, limite uzak.
 * Temizlik: geçici rehber afterAll'da her koşulda silinir.
 */
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { BASE, DIR_STATE } = require('./helpers');

const STU_USER = process.env.OKULIN_STU_USER;
const STU_PASS = process.env.OKULIN_STU_PASS;

test.describe('Mobil push kaydı + F1 hesap silme (canlı)', () => {
  test.describe.configure({ mode: 'serial' });

  let api; // native taklidi (Origin başlığı YOK, cookie yok)
  let web; // director web oturumu (geçici rehber CRUD)
  let access;
  let couId = null; // geçici rehber — afterAll temizliği
  const instA = 'e2e-inst-' + crypto.randomUUID();
  const instB = 'e2e-inst-' + crypto.randomUUID();
  const tokA = 'e2e-fcm-' + crypto.randomUUID();
  const tokB = 'e2e-fcm-' + crypto.randomUUID();

  test.beforeAll(async ({ playwright }) => {
    expect(STU_PASS, "OKULIN_STU_USER/PASS .env.local'de tanımlı olmalı").toBeTruthy();
    api = await playwright.request.newContext();
    web = await playwright.request.newContext({
      storageState: DIR_STATE,
      extraHTTPHeaders: { Origin: BASE }, // cookie-auth mutasyonlar CSRF için Origin ister
    });
    const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, {
      data: { username: STU_USER, password: STU_PASS, role: 'student', installationId: instA, platform: 'android' },
    });
    expect(r.status(), await r.text()).toBe(200);
    access = (await r.json()).accessToken;
  });

  test.afterAll(async () => {
    if (couId) await web.delete(`${BASE}/api/counselors`, { data: { id: couId } }).catch(() => {});
    await api?.dispose();
    await web?.dispose();
  });

  const H = (t) => ({ Authorization: `Bearer ${t || access}` });

  test('register: yeni cihaz 200', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instA, platform: 'android', token: tokA, appVersion: '0.1.0' },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test('register: aynı installation yeni token (rotasyon) 200', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instA, platform: 'android', token: tokB },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test('register: aynı token BAŞKA installation (reinstall devri) 200', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instB, platform: 'android', token: tokB },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test("register: Bearer'sız 403 (CSRF middleware önce çalışır)", async () => {
    // Native istemci hiçbir zaman Origin göndermez (middleware.js yorumu) — bu yüzden
    // Bearer YOKKEN gerçek bir çağrı ne Origin ne Bearer taşır. Mutasyon isteklerinde
    // middleware CSRF kontrolü (Origin/Referer host eşleşmesi) mobil auth katmanından
    // ÖNCE çalışır; MOBILE_CSRF_EXEMPT bu yolu içermez (Bearer korumalı uçlar normalde
    // Bearer istisnasından geçer, ama Bearer YOKSA istisna da devreye girmez) → 403
    // "CSRF koruması" (withMobileAuth'un 401 "Giriş gerekli"sine hiç ulaşılmaz).
    // Sonuç yine ret (fail-closed, iki katman) — sadece durum kodu farklı.
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      data: { installationId: instA, platform: 'android', token: tokA },
    });
    expect(r.status()).toBe(403);
  });

  test('register: geçersiz gövde 400', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instA, platform: 'windows', token: tokA },
    });
    expect(r.status()).toBe(400);
  });

  test('unregister: 200', async () => {
    const r = await api.delete(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(),
      data: { installationId: instB },
    });
    expect(r.status(), await r.text()).toBe(200);
  });

  test("eşzamanlı iki kayıt aynı token ile yarışırsa ikisi de 200 (P2002 retry)", async () => {
    const tokC = 'e2e-fcm-' + crypto.randomUUID();
    const [r1, r2] = await Promise.all([
      api.post(`${BASE}/api/mobile/v1/push/register`, {
        headers: H(),
        data: { installationId: 'e2e-inst-' + crypto.randomUUID(), platform: 'android', token: tokC },
      }),
      api.post(`${BASE}/api/mobile/v1/push/register`, {
        headers: H(),
        data: { installationId: 'e2e-inst-' + crypto.randomUUID(), platform: 'android', token: tokC },
      }),
    ]);
    expect(r1.status(), await r1.text()).toBe(200);
    expect(r2.status(), await r2.text()).toBe(200);
  });

  test('F1: rehber silinince mobil erişim ANINDA ölür (+ sahiplik 409)', async () => {
    // 1) Geçici rehber (director web API; username = name, counselors route kuralı)
    const name = 'E2E F1 Rehber ' + Date.now();
    const pass = 'e2e-F1-' + crypto.randomUUID().slice(0, 8);
    const instF = 'e2e-inst-' + crypto.randomUUID();
    const c = await web.post(`${BASE}/api/counselors`, { data: { name, password: pass } });
    expect(c.status(), await c.text()).toBe(200);
    couId = (await c.json()).id;

    // 2) Mobil login (management kategorisi) + cihaz kaydı + me yeşil
    const l = await api.post(`${BASE}/api/mobile/v1/auth/login`, {
      data: { username: name, password: pass, role: 'management', installationId: instF, platform: 'android' },
    });
    expect(l.status(), await l.text()).toBe(200);
    const { accessToken: couAccess, refreshToken: couRefresh } = await l.json();
    const reg = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(couAccess),
      data: { installationId: instF, platform: 'android', token: 'e2e-fcm-' + crypto.randomUUID() },
    });
    expect(reg.status(), await reg.text()).toBe(200);
    const me1 = await api.get(`${BASE}/api/mobile/v1/me`, { headers: H(couAccess) });
    expect(me1.status()).toBe(200);

    // 3) Sahiplik sınırı: BAŞKA kullanıcı (öğrenci) rehberin installationId'sini
    //    FARKLI token'la devralamaz → 409 (İnceleme Codex #3)
    const hijack = await api.post(`${BASE}/api/mobile/v1/push/register`, {
      headers: H(), // öğrenci access'i
      data: { installationId: instF, platform: 'android', token: 'e2e-fcm-' + crypto.randomUUID() },
    });
    expect(hijack.status(), await hijack.text()).toBe(409);

    // 4) Hesabı sil (director) → purgeMobileAccess silmeden önce koşar
    const d = await web.delete(`${BASE}/api/counselors`, { data: { id: couId } });
    expect(d.status(), await d.text()).toBe(200);
    couId = null;

    // 5) Access ANINDA geçersiz (15 dk exp BEKLENMEZ) + refresh de ölü (İnceleme Codex #14)
    const me2 = await api.get(`${BASE}/api/mobile/v1/me`, { headers: H(couAccess) });
    expect(me2.status()).toBe(401);
    const ref = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: couRefresh } });
    expect(ref.status()).toBe(401);
  });
});
