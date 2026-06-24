/**
 * SQL GÖÇ TESTİ — Oturum kurulumu (storageState)
 * Her rol için BİR KEZ login olur, cookie'yi diske kaydeder.
 * Tüm test dosyaları bu kayıtlı oturumları paylaşır → toplam login sayısı = 3.
 * Bu, login rate-limit'ine (5/15dk) takılmayı önler.
 */
const { test: setup } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';

const DIR_USER = process.env.OKULIN_DIR_USER || 'testkurs_mudur';
const DIR_PASS = process.env.OKULIN_DIR_PASS || 'testkursmudur';
const TEA_USER = process.env.OKULIN_TEA_USER || 'Matematik Öğretmeni1';
const TEA_PASS = process.env.OKULIN_TEA_PASS || 'test_ogrt_2026';
const STU_USER = process.env.OKULIN_STU_USER || 'Duha pirinç';
const STU_PASS = process.env.OKULIN_STU_PASS || 'test_ogrenci_2026';

const AUTH_DIR = path.join(__dirname, '.auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function loginAndSave(context, username, password, role, file) {
  const res = await context.request.post(`${BASE}/api/auth`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { action: 'login', username, password, role },
  });
  if (res.status() !== 200) {
    throw new Error(`Login başarısız (${role}): HTTP ${res.status()} — ${await res.text()}`);
  }
  await context.storageState({ path: path.join(AUTH_DIR, file) });
}

setup('director oturumu kaydet', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  await loginAndSave(ctx, DIR_USER, DIR_PASS, 'management', 'director.json');
  await ctx.close();
});

setup('teacher oturumu kaydet', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  await loginAndSave(ctx, TEA_USER, TEA_PASS, 'teacher', 'teacher.json');
  await ctx.close();
});

setup('student oturumu kaydet', async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: BASE });
  await loginAndSave(ctx, STU_USER, STU_PASS, 'student', 'student.json');
  await ctx.close();
});
