/**
 * ENTEGRASYON — /api/mobile/v1 çekirdeği (canlı testkurs)
 * resolve-org → bootstrap → login (token, çoklu rol) → me (çapraz-token reddi) →
 * refresh rotation → reuse detection → logout sonrası access reddi (iptal) →
 * devices → session-exchange (IP-bağlı, atomik) → çapraz-tenant reddi.
 *
 * Rate-limit bütçesi: mobil login web ile AYNI ip:username kovasını kullanır
 * (5 deneme/15dk) ama BAŞARILI her login kovayı sıfırlar (lib/ratelimit.ts).
 * Bu dosyadaki tüm login'ler başarılı (director 3, teacher 1, student 1) →
 * kalıcı yük 0; 429 görülmesi gerçek hatadır, tolere edilmez.
 *
 * DOĞRULAMA ASKIDA (2026-07-16): OTP akışı yok → login şifre doğruysa direkt token.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { BASE, DIR_STATE } = require('./helpers');

const baseHost = new URL(BASE).hostname;                          // testkurs.okulin.com
const APEX = process.env.OKULIN_APEX_BASE_URL || `https://${baseHost.split('.').slice(1).join('.')}`; // local: digerkurs.localhost
const DIR_USER = process.env.OKULIN_DIR_USER || 'testkurs_mudur';
const DIR_PASS = process.env.OKULIN_DIR_PASS;
const TEA_USER = process.env.OKULIN_TEA_USER;
const TEA_PASS = process.env.OKULIN_TEA_PASS;
const STU_USER = process.env.OKULIN_STU_USER;
const STU_PASS = process.env.OKULIN_STU_PASS;
const ORG_CODE = process.env.OKULIN_ORG_CODE;

const GRACE_WAIT_MS = 35_000; // ROTATE_GRACE_SEC (30sn) + pay

async function login(api, username, password, role) {
  const r = await api.post(`${BASE}/api/mobile/v1/auth/login`, { data: { username, password, role } });
  return r;
}

test.describe('Mobil API çekirdeği (canlı)', () => {
  test.describe.configure({ mode: 'serial' });

  let api;              // cookie'siz istemci (native taklidi — Origin başlığı YOK)
  let web;              // session-open için cookie jar'lı istemci
  let access, r0;       // director 1. login çifti (r0 = ilk refresh token)
  let r1, r2;           // rotation zinciri: r0→r1 (normal), r0→r2 (grace-içi art-arda)

  test.beforeAll(async ({ playwright }) => {
    expect(DIR_PASS, 'OKULIN_DIR_PASS .env.local\'de tanımlı olmalı').toBeTruthy();
    api = await playwright.request.newContext();
    web = await playwright.request.newContext();
  });
  test.afterAll(async () => { await api?.dispose(); await web?.dispose(); });

  test('resolve-org: kurum kodu canonical host + marka döner', async () => {
    test.skip(!ORG_CODE, 'OKULIN_ORG_CODE tanımlı değil');
    const r = await api.post(`${APEX}/api/mobile/v1/resolve-org`, { data: { code: ORG_CODE } });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.canonicalHost).toBe(baseHost);
    expect(j.orgSlug).toBeTruthy();
    expect(j.themeColor).toMatch(/^#/);
  });

  test('bootstrap: sürüm + bakım + kurum markası/modülleri', async () => {
    const r = await api.get(`${BASE}/api/mobile/v1/bootstrap`);
    expect(r.status()).toBe(200);
    const j = await r.json();
    expect(j.minSupportedVersion).toBeTruthy();
    expect(j.maintenance).toHaveProperty('active');
    expect(j.org?.slug).toBeTruthy();
    expect(j.org?.modules).toBeTruthy();
  });

  test('login: müdür token çifti (Origin başlıksız — CSRF allowlist çalışıyor)', async () => {
    const r = await login(api, DIR_USER, DIR_PASS, 'management');
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.accessToken).toBeTruthy();
    expect(j.refreshToken).toMatch(/^mrt_/);
    expect(j.session.role).toBe('director');
    access = j.accessToken; r0 = j.refreshToken;
  });

  test('login: öğretmen ve öğrenci de token alır (çoklu rol)', async () => {
    test.skip(!TEA_PASS || !STU_PASS, 'öğretmen/öğrenci bilgileri tanımlı değil');
    const t = await login(api, TEA_USER, TEA_PASS, 'teacher');
    expect(t.status(), await t.text()).toBe(200);
    expect((await t.json()).session.role).toBe('teacher');
    const s = await login(api, STU_USER, STU_PASS, 'student');
    expect(s.status(), await s.text()).toBe(200);
    expect((await s.json()).session.role).toBe('student');
  });

  test('me: geçerli Bearer 200; çöp token ve web cookie JWT 401', async () => {
    const ok = await api.get(`${BASE}/api/mobile/v1/me`, { headers: { Authorization: `Bearer ${access}` } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).session.role).toBe('director');

    const bad = await api.get(`${BASE}/api/mobile/v1/me`, { headers: { Authorization: 'Bearer bozuk-token' } });
    expect(bad.status()).toBe(401);

    // Web cookie JWT'si Bearer olarak sunulamaz (ayrı secret + aud).
    const state = JSON.parse(fs.readFileSync(DIR_STATE, 'utf8'));
    const cookieJwt = (state.cookies || []).find((c) => c.name === 'etut_session')?.value;
    expect(cookieJwt, 'setup storageState içinde etut_session olmalı').toBeTruthy();
    const cross = await api.get(`${BASE}/api/mobile/v1/me`, { headers: { Authorization: `Bearer ${cookieJwt}` } });
    expect(cross.status()).toBe(401);
  });

  test('refresh: rotation yeni çift üretir (r0 → r1)', async () => {
    const r = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r0 } });
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    expect(j.refreshToken).toMatch(/^mrt_/);
    expect(j.refreshToken).not.toBe(r0);
    r1 = j.refreshToken;
  });

  test('grace-içi art-arda: r0 hemen tekrar → r2 (meşru retry, sonsuz DEĞİL)', async () => {
    // r0 az önce r1'e rotate edildi; grace (30sn) içinde r0 tekrar sunulur (kayıp yanıt
    // senaryosu) → yeni çift (r2). rotate'te prev = önceki güncel (r1), r0 DEĞİL →
    // r0 artık ne refreshHash ne prev → üçüncü kullanımda ölür (Codex #1 düzeltmesi).
    const again = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r0 } });
    expect(again.status(), await again.text()).toBe(200);
    r2 = (await again.json()).refreshToken;
    expect(r2).not.toBe(r1);
    // r0 üçüncü kez → artık tanınmıyor → 401 (oturum bulunamadı; revoke değil)
    const third = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r0 } });
    expect(third.status()).toBe(401);
  });

  test('reuse detection: grace DIŞI eski refresh (r1) OTURUMU KAPATIR', async () => {
    test.setTimeout(150_000);
    await new Promise((res) => setTimeout(res, GRACE_WAIT_MS));
    // r1 artık prev (güncel r2); grace dışı prev kullanımı = reuse → revoke
    const replay = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r1 } });
    expect(replay.status()).toBe(401);
    // Oturum TAMAMEN kapandı: güncel r2 de reddedilir
    const after = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: r2 } });
    expect(after.status()).toBe(401);
  });

  test('iptal: logout sonrası access token ANINDA geçersiz (withMobileAuth iptal kontrolü)', async () => {
    // Yeni (SON) login — rate-limit bütçesi (bkz. dosya başı)
    const r = await login(api, DIR_USER, DIR_PASS, 'management');
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    const bearer = { Authorization: `Bearer ${j.accessToken}` };

    // logout
    const lo = await api.post(`${BASE}/api/mobile/v1/auth/logout`, { headers: bearer });
    expect(lo.status()).toBe(200);
    // access token imzası geçerli ama oturum iptal → me artık 401
    const me = await api.get(`${BASE}/api/mobile/v1/me`, { headers: bearer });
    expect(me.status()).toBe(401);
    // refresh de geçersiz
    const ref = await api.post(`${BASE}/api/mobile/v1/auth/refresh`, { data: { refreshToken: j.refreshToken } });
    expect(ref.status()).toBe(401);
  });

  test('devices + session-exchange (IP-bağlı, tek kullanımlık) + çapraz-tenant reddi', async () => {
    // Not: bu blok setup rate-limit'ini paylaşan 2. director login DEĞİL — yukarıdaki
    // iptal testinin token'ı iptal edildi; taze token için TEK login daha:
    const r = await login(api, DIR_USER, DIR_PASS, 'management');
    // 429 kabul EDİLMEZ: başarılı login'ler kovayı sıfırlar; 429 = bütçe invariant'ı bozuldu.
    expect(r.status(), await r.text()).toBe(200);
    const j = await r.json();
    const bearer = { Authorization: `Bearer ${j.accessToken}` };

    const dv = await api.get(`${BASE}/api/mobile/v1/auth/devices`, { headers: bearer });
    expect(dv.status()).toBe(200);
    expect((await dv.json()).devices.some((d) => d.current)).toBe(true);

    // session-exchange → aynı istemci (aynı IP) session-open yapar → cookie oturumu
    const ex = await api.post(`${BASE}/api/mobile/v1/session-exchange`, { headers: bearer });
    expect(ex.status(), await ex.text()).toBe(200);
    const { code } = await ex.json();
    // AYNI istemci (api) ile aç → IP eşleşir
    const open = await api.get(`${BASE}/api/mobile/v1/session-open?code=${code}&next=/`);
    expect(open.status()).toBe(200); // 302 takip edildi
    // Aynı kod ikinci kez → 403 (tek kullanımlık, atomik tüketim)
    const again = await api.get(`${BASE}/api/mobile/v1/session-open?code=${code}&next=/`);
    expect(again.status()).toBe(403);

    // Çapraz-tenant: testkurs token'ı apex'te (farklı tenant bağlamı) reddedilir
    const crossTenant = await api.get(`${APEX}/api/mobile/v1/me`, { headers: bearer });
    expect(crossTenant.status()).toBe(401);
  });
});
