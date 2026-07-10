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

// Öğretmen/öğrenci hesapları .env.local'den gelir (playwright.config @next/env yükler).
// Eski sabit fikstür isimleri ('Matematik Öğretmeni1', 'Duha pirinç') canlı veriden
// silindi — bayat fallback tutmuyoruz; env eksikse net hatayla düşülür.
const DIR_USER = process.env.OKULIN_DIR_USER || 'testkurs_mudur';
const DIR_PASS = process.env.OKULIN_DIR_PASS || 'testkursmudur';
const TEA_USER = process.env.OKULIN_TEA_USER;
const TEA_PASS = process.env.OKULIN_TEA_PASS;
const STU_USER = process.env.OKULIN_STU_USER;
const STU_PASS = process.env.OKULIN_STU_PASS;

const AUTH_DIR = path.join(__dirname, '.auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function loginAndSave(context, username, password, role, file) {
  if (!username || !password) {
    throw new Error(`${role} giriş bilgileri eksik — .env.local'de OKULIN_TEA_USER/PASS ve OKULIN_STU_USER/PASS tanımlı olmalı.`);
  }
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
