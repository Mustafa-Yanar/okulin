/**
 * SQL GÖÇ TESTİ — Auth negatif/güvenlik
 * Pozitif login (3 rol) auth.setup.js'te kanıtlanır (storageState HTTP 200 şartı).
 * Bu dosya yalnız REDDEDİLMESİ gereken durumları test eder.
 *
 * Rate-limit bütçesi: buradaki 2 negatif deneme suite'in müdür kovasındaki TEK
 * kalıcı yüktür (başarılı login'ler kovayı sıfırlar — lib/ratelimit.ts). 429 artık
 * kabul EDİLMEZ: görülürse bütçe invariant'ı bozulmuş demektir (bkz auth.setup.js).
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

test('yanlış şifre → 401', async ({ request }) => {
  const status = await login(request, DIR_USER, 'kesinlikle_yanlis_xyz', 'management');
  expect(status).toBe(401);
});

test('yanlış rol → 403 (doğru-rol yönlendirmesi)', async ({ request }) => {
  // Director bilgileriyle teacher rolü denemesi — verifyLogin gateMismatch 403 döner
  const status = await login(request, DIR_USER, DIR_PASS, 'teacher');
  expect(status).toBe(403);
});

test('eksik alan → 400 (şema doğrulama, rate-limit\'i tüketmez)', async ({ request }) => {
  const res = await request.post(`${BASE}/api/auth`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { action: 'login', username: DIR_USER }, // password yok
  });
  expect(res.status()).toBe(400);
});
