/**
 * SQL GÖÇ TESTİ — Oturum kurulumu (storageState)
 * Her rol için BİR KEZ login olur, cookie'yi diske kaydeder; test dosyaları bu
 * kayıtlı oturumları paylaşır.
 *
 * LOGIN BÜTÇESİ INVARIANT'I (yeni spec eklerken OKU):
 * rl:login kovası ip:username, 5 deneme/15dk; BAŞARILI oturum kurulumu kovayı
 * SIFIRLAR (lib/ratelimit.ts resetLoginBudget). Suite kuralları:
 * 1) Başarısız-login testi paylaşılan hesapla YAZILMAZ — kendi (uydurma/geçici)
 *    kullanıcı-adı kovasını kullanır (örn. sql-auth'un 2 negatifi tek istisna,
 *    int-ratelimit mühürleri kendi kovalarında).
 * 2) Aynı hesapla eşzamanlı başarılı login sayısı + o hesabın bekleyen başarısızlıkları
 *    5'i aşmamalı (başarı reset'i yanıt dönerken işler; eşzamanlılık penceresinde
 *    sayaç geçici birikir — bugünkü en kötü durum: müdür kovasında 2 negatif + 3
 *    paralel başarı = 5, tam sınırda).
 * 3) 429 hiçbir testte tolere edilmez/atlanmaz — görülürse bu invariant bozulmuştur,
 *    testi maskeleme, bütçeyi düzelt.
 */
const { test: setup } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.OKULIN_BASE_URL;
if (!BASE) throw new Error('GÜVENLİK KİLİDİ: E2E için OKULIN_BASE_URL zorunlu.');

// Öğretmen/öğrenci hesapları .env.local'den gelir (playwright.config @next/env yükler).
// Eski sabit fikstür isimleri ('Matematik Öğretmeni1', 'Duha pirinç') canlı veriden
// silindi — bayat fallback tutmuyoruz; env eksikse net hatayla düşülür.
const DIR_USER = process.env.OKULIN_DIR_USER;
const DIR_PASS = process.env.OKULIN_DIR_PASS;
const TEA_USER = process.env.OKULIN_TEA_USER;
const TEA_PASS = process.env.OKULIN_TEA_PASS;
const STU_USER = process.env.OKULIN_STU_USER;
const STU_PASS = process.env.OKULIN_STU_PASS;

const AUTH_DIR = path.join(__dirname, '.auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

async function loginAndSave(context, username, password, role, file) {
  if (!username || !password) {
    throw new Error(`${role} giriş bilgileri eksik — E2E rol kullanıcı adı/şifresi env üzerinden açıkça verilmelidir.`);
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
