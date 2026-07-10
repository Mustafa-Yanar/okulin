/**
 * ENTEGRASYON — Kiracı (tenant) izolasyonu
 * Superadmin GEÇİCİ bir test kurumu açar (subdomain otomatik provision edilir);
 * testkurs oturumu/kimliği o kurumda İŞLEMEZ, yeni kurum boş veriyle başlar,
 * yeni kurumun oturumu da testkurs'ta işlemez. Test sonunda kurum tamamen silinir
 * (+ Vercel domain kaydı best-effort temizlenir).
 *
 * GÜVENLİK SINIRI: yalnız testkurs + burada oluşturulan geçici kurum hedeflenir;
 * gerçek kurumlara (akyazicozum vb.) HİÇBİR istek atılmaz.
 *
 * Superadmin girişi yalnız apex'ten (okulin.com) yapılabilir; bilgiler .env.local'den
 * (OKULIN_SA_USER/OKULIN_SA_PASS). Rate-limit düzeni: superadmin + geçici müdür
 * kendi kullanıcı-adı kovalarını kullanır (testkurs_mudur kovasına dokunulmaz);
 * login deneyen negatif test [401, 429] ikisini de kabul eder.
 */
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const fs = require('fs');
const { BASE, DIR_STATE } = require('./helpers');

// storageState dosyasındaki oturum cookie'sini "Cookie:" başlığı olarak çıkar.
// Cookie'ler host-only olduğundan çapraz-subdomain isteklerde otomatik GÖNDERİLMEZ —
// izolasyonu gerçekten test etmek için JWT'yi isteğe açıkça iliştiririz (getSession
// token'ın org'u ile isteğin org'unu karşılaştırıp reddetmeli).
function cookieHeaderFrom(storageStatePath) {
  const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf8'));
  const c = (state.cookies || []).find((x) => x.name === 'etut_session');
  if (!c) throw new Error(`${storageStatePath} içinde etut_session cookie'si yok`);
  return `etut_session=${c.value}`;
}

const baseHost = new URL(BASE).hostname;                       // testkurs.okulin.com
const APEX = `https://${baseHost.split('.').slice(1).join('.')}`; // https://okulin.com
const SA_USER = process.env.OKULIN_SA_USER;
const SA_PASS = process.env.OKULIN_SA_PASS;

const SLUG = 'e2eizo' + Date.now().toString(36);
const TMP_DIR_USER = 'e2e_izo_mudur_' + Date.now().toString(36);
const TMP_DIR_PASS = crypto.randomBytes(9).toString('hex');

test.describe('Kiracı izolasyonu (geçici kurum)', () => {
  test.describe.configure({ mode: 'serial' });

  let saReq;          // superadmin (apex) oturumu
  let TEMP;           // https://<slug>.okulin.com
  let orgCreated = false;

  test.beforeAll(async ({ playwright }, testInfo) => {
    testInfo.setTimeout(240_000); // domain SSL sertifikası ~30sn-2dk sürebilir
    expect(SA_USER && SA_PASS, 'OKULIN_SA_USER/OKULIN_SA_PASS .env.local\'de tanımlı olmalı').toBeTruthy();

    // Superadmin girişi — yalnız apex domain kabul eder
    saReq = await playwright.request.newContext();
    const login = await saReq.post(`${APEX}/api/auth`, {
      headers: { 'Content-Type': 'application/json', Origin: APEX },
      data: { action: 'login', username: SA_USER, password: SA_PASS, role: 'superadmin' },
    });
    expect(login.status(), await login.text()).toBe(200);

    // Geçici kurum oluştur (domain otomatik Vercel'e eklenir)
    const created = await saReq.post(`${APEX}/api/superadmin`, {
      headers: { 'Content-Type': 'application/json', Origin: APEX },
      data: {
        action: 'create', slug: SLUG, name: 'E2E İzolasyon Geçici Kurum',
        sektor: 'dershane', mulkiyet: 'ozel',
        directorUsername: TMP_DIR_USER, directorPassword: TMP_DIR_PASS, directorName: 'E2E Geçici Müdür',
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    const body = await created.json();
    orgCreated = true;
    TEMP = `https://${body.domain}`;
    expect(body.domain).toContain(SLUG);

    // Subdomain'in yayına girmesini bekle (SSL sertifikası üretimi asenkron)
    let up = false;
    for (let i = 0; i < 36 && !up; i++) {
      try {
        const ping = await saReq.get(`${TEMP}/api/auth`, { timeout: 8_000 });
        if (ping.status() === 200) up = true;
      } catch { /* sertifika hazır değil — bekle */ }
      if (!up) await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(up, `${TEMP} 3 dakika içinde yayına girmedi`).toBe(true);
  });

  test.afterAll(async ({ }, testInfo) => {
    testInfo.setTimeout(120_000);
    if (saReq && orgCreated) {
      // Kurumu ve TÜM verisini kalıcı sil
      const del = await saReq.delete(`${APEX}/api/superadmin`, {
        headers: { 'Content-Type': 'application/json', Origin: APEX },
        data: { slug: SLUG },
      }).catch(() => null);
      if (!del || del.status() !== 200) {
        console.warn(`UYARI: geçici kurum (${SLUG}) silinemedi — superadmin panelinden elle silin.`);
      }
      // Vercel domain kaydını da kaldır (superadmin DELETE bunu yapmaz) — best-effort
      const { VERCEL_TOKEN, VERCEL_PROJECT_ID, VERCEL_TEAM_ID } = process.env;
      if (VERCEL_TOKEN && VERCEL_PROJECT_ID && TEMP) {
        const domain = new URL(TEMP).hostname;
        const qs = VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(VERCEL_TEAM_ID)}` : '';
        await fetch(`https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}${qs}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
        }).catch(() => {});
      }
    }
    if (saReq) await saReq.dispose();
  });

  test('testkurs müdür JWT\'si geçici kurumda İŞLEMEZ (veri sızmaz)', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const testkursCookie = cookieHeaderFrom(DIR_STATE);
    try {
      for (const path of ['/api/students', '/api/teachers', '/api/finance']) {
        const res = await anon.get(`${TEMP}${path}`, { headers: { Cookie: testkursCookie } });
        expect([401, 403], `${path} testkurs JWT'siyle veri DÖNDÜRMEMELİ`).toContain(res.status());
        // Gövdede veri listesi de olmamalı (4xx gövdesi { error } taşır)
        const body = await res.json().catch(() => ({}));
        expect(Array.isArray(body)).toBe(false);
      }
    } finally {
      await anon.dispose();
    }
  });

  test('testkurs JWT\'siyle geçici kurumda mutasyon da reddedilir', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const testkursCookie = cookieHeaderFrom(DIR_STATE);
    try {
      const res = await anon.post(`${TEMP}/api/students`, {
        headers: { 'Content-Type': 'application/json', Origin: TEMP, Cookie: testkursCookie },
        data: { name: 'Sızma Denemesi', cls: '801', parentName: 'X', parentPhone: '0532 111 22 33' },
      });
      expect([401, 403]).toContain(res.status());
    } finally {
      await anon.dispose();
    }
  });

  test('geçici kurum müdürü kendi kurumunda BOŞ veri görür (testkurs sızmaz)', async ({ playwright }) => {
    const tmpReq = await playwright.request.newContext();
    try {
      const login = await tmpReq.post(`${TEMP}/api/auth`, {
        headers: { 'Content-Type': 'application/json', Origin: TEMP },
        data: { action: 'login', username: TMP_DIR_USER, password: TMP_DIR_PASS, role: 'management' },
      });
      expect(login.status(), await login.text()).toBe(200);

      const students = await (await tmpReq.get(`${TEMP}/api/students`)).json();
      expect(Array.isArray(students)).toBe(true);
      expect(students, 'yeni kurumda testkurs öğrencileri GÖRÜNMEMELİ').toHaveLength(0);

      const teachers = await (await tmpReq.get(`${TEMP}/api/teachers`)).json();
      expect(teachers, 'yeni kurumda testkurs öğretmenleri GÖRÜNMEMELİ').toHaveLength(0);

      // Ters yön: geçici kurumun JWT'si testkurs'ta işlemez (açık Cookie başlığıyla)
      const state = await tmpReq.storageState();
      const tmpCookie = (state.cookies || []).find((c) => c.name === 'etut_session');
      expect(tmpCookie, 'geçici müdür oturum cookie\'si alınamadı').toBeTruthy();
      const cross = await tmpReq.get(`${BASE}/api/students`, {
        headers: { Cookie: `etut_session=${tmpCookie.value}` },
      });
      expect([401, 403]).toContain(cross.status());
    } finally {
      await tmpReq.dispose();
    }
  });

  test('geçici kurum müdür bilgileri testkurs girişinde geçersiz', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    try {
      const res = await anon.post(`${BASE}/api/auth`, {
        headers: { 'Content-Type': 'application/json', Origin: BASE },
        data: { action: 'login', username: TMP_DIR_USER, password: TMP_DIR_PASS, role: 'management' },
      });
      expect([401, 429]).toContain(res.status()); // kendi kullanıcı-adı kovası; 429 = rate-limit toleransı
    } finally {
      await anon.dispose();
    }
  });
});
