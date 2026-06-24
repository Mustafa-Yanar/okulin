/**
 * GERÇEK UI MULTI-CONTEXT — Yoklama zinciri
 * Öğretmen yoklama girer → müdür Rehberlik>Yoklama özetinde görür.
 * Ön-koşul (gerçek akış): müdür API'den öğretmene Cumartesi m7 dersi atar (ProgramEditor'ın yaptığı).
 * Not: Öğrenci kendi devamsızlığını UI'da görmüyor → zincir öğretmen→müdür.
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';
const DIR_STATE = 'e2e/.auth/director.json';
const TEA_STATE = 'e2e/.auth/teacher.json';
const TEACHER_ID = 'd9sxbn8a'; // Matematik Öğretmeni1
const DAY = 5;     // Cumartesi
const SLOT = 'e1'; // hafta sonu ilk slot
const CLS = 'm7';

// ISO hafta anahtarı (lib/slots.getWeekKey ile aynı mantık)
function getWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

test('yoklama: öğretmen girer → müdür özetinde görür', async ({ browser }) => {
  const weekKey = getWeekKey();

  const dirSetup = await browser.newContext({ storageState: DIR_STATE });
  // ---- ÖN-KOŞUL: müdür öğretmene Cumartesi m7 dersi atar (gerçek API akışı) ----
  const setupRes = await dirSetup.request.post(`${BASE}/api/program`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { teacherId: TEACHER_ID, weekKey, program: { [DAY]: { [SLOT]: { type: 'ders', cls: CLS, fixed: true } } } },
  });
  expect(setupRes.status()).toBe(200);

  const teaCtx = await browser.newContext({ storageState: TEA_STATE });
  const dirCtx = await browser.newContext({ storageState: DIR_STATE });
  const tea = await teaCtx.newPage();
  const dir = await dirCtx.newPage();

  try {
    // ---- ÖĞRETMEN: yoklama girer ----
    await tea.goto('/');
    await tea.waitForLoadState('networkidle').catch(() => {});
    await tea.getByRole('button', { name: 'Yoklama' }).click();
    await tea.waitForTimeout(1500);
    await tea.screenshot({ path: 'e2e/shots/yoklama-01-ogretmen-liste.png', fullPage: true });

    await tea.getByRole('button', { name: /Cumartesi/ }).click(); // günü aç
    await tea.waitForTimeout(600);
    await tea.getByRole('button', { name: /1\. Ders.*M7/ }).click(); // dersi aç
    await tea.waitForTimeout(800);
    await tea.screenshot({ path: 'e2e/shots/yoklama-02-ogretmen-ders.png', fullPage: true });

    // Duha'yı "Yok" işaretle (m7'de tek öğrenci)
    await tea.getByRole('button', { name: 'Yok', exact: true }).first().click();
    await tea.getByRole('button', { name: /Yoklamasını Kaydet/ }).click();
    await expect(tea.getByText('Yoklama kaydedildi').first()).toBeVisible({ timeout: 8000 });
    await tea.screenshot({ path: 'e2e/shots/yoklama-03-ogretmen-kaydetti.png', fullPage: true });

    // ---- MÜDÜR: Rehberlik > Yoklama özetinde görür ----
    await dir.goto('/');
    await dir.waitForLoadState('networkidle').catch(() => {});
    await dir.getByRole('button', { name: 'Rehberlik' }).click();
    await dir.waitForTimeout(1500);
    // Yoklama alt-sekmesi varsayılan aktif; gün şeridinde Cumartesi (Cmt) seç
    await dir.getByRole('button', { name: /Cmt/ }).click();
    await dir.waitForTimeout(1500);
    await dir.screenshot({ path: 'e2e/shots/yoklama-04-mudur-gunluk.png', fullPage: true });

    // m7 sınıf kartı "1 yok" rozetiyle görünmeli → tıkla
    await expect(dir.getByText(/1 yok/).first()).toBeVisible({ timeout: 8000 });
    await dir.getByRole('button', { name: /M7/ }).click();
    await dir.waitForTimeout(1000);
    await dir.screenshot({ path: 'e2e/shots/yoklama-05-mudur-modal.png', fullPage: true });
    // Modalda Duha "Yok" listesinde
    await expect(dir.getByText('Duha pirinç').first()).toBeVisible({ timeout: 8000 });
  } finally {
    // ---- TEARDOWN: dersi şablondan kaldır ----
    await dirSetup.request.post(`${BASE}/api/program`, {
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      data: { teacherId: TEACHER_ID, weekKey, program: { [DAY]: { [SLOT]: null } } },
    }).catch(() => {});
    await dirSetup.close();
    await teaCtx.close();
    await dirCtx.close();
  }
});
