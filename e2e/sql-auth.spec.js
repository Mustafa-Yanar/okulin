/**
 * SQL GÖÇ TESTİ — Auth negatif/güvenlik
 * Pozitif login (3 rol) auth.setup.js'te kanıtlanır (storageState HTTP 200 şartı).
 * Bu dosya yalnız REDDEDİLMESİ gereken durumları test eder.
 * Login denemesi sayısı düşük tutulur (rate-limit: 5/15dk).
 */
const { test, expect } = require('@playwright/test');

const BASE     = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';
const DIR_USER = process.env.OKULIN_DIR_USER || 'testkurs_mudur';
const DIR_PASS = process.env.OKULIN_DIR_PASS || 'testkursmudur';

async function login(request, username, password, role) {
  const res = await request.post(`${BASE}/api/auth`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { action: 'login', username, password, role },
  });
  return res.status();
}

test('yanlış şifre → 401 (veya rate-limit 429)', async ({ request }) => {
  const status = await login(request, DIR_USER, 'kesinlikle_yanlis_xyz', 'management');
  expect([401, 429]).toContain(status);
});

test('yanlış rol → reddedilir (4xx)', async ({ request }) => {
  // Director bilgileriyle teacher rolü denemesi
  const status = await login(request, DIR_USER, DIR_PASS, 'teacher');
  expect(status).toBeGreaterThanOrEqual(400);
});

test('eksik alan → 400 (şema doğrulama, rate-limit\'i tüketmez)', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { action: 'login', username: DIR_USER }, // password yok
  });
  expect(res.status()).toBe(400);
});
