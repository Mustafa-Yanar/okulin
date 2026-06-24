/**
 * GERÇEK UI MULTI-CONTEXT — Etüt rezervasyonu
 * Müdür öğretmene etüt şablonu ekler (gerçek API) → öğrenci müsait etütten rezerve eder (UI)
 * → öğrenci "Etütlerim"de + öğretmen "Program"da görür.
 */
const { test, expect } = require('@playwright/test');

const BASE = process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com';
const DIR_STATE = 'e2e/.auth/director.json';
const TEA_STATE = 'e2e/.auth/teacher.json';
const STU_STATE = 'e2e/.auth/student.json';
const TEACHER_ID = 'd9sxbn8a';   // Matematik Öğretmeni1 (TYT/AYT/Geometri)
const TEACHER_NAME = 'Matematik Öğretmeni1';
const DAY = 5; // Cumartesi

function getWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

test('etüt: öğrenci rezerve eder → öğrenci + öğretmen çizelgede görür', async ({ browser }) => {
  const weekKey = getWeekKey();
  const dirSetup = await browser.newContext({ storageState: DIR_STATE });

  // ---- ÖN-KOŞUL: müdür öğretmene Cumartesi 10:00–11:00 etüt şablonu ekler ----
  const addRes = await dirSetup.request.post(`${BASE}/api/etut-sablon`, {
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    data: { teacherId: TEACHER_ID, weekKey, sablon: { dayIndex: DAY, start: '10:00', end: '11:00', aktif: true } },
  });
  expect(addRes.status()).toBe(200);

  // Eklenen şablonun id'sini bul (teardown için)
  const allRes = await dirSetup.request.get(`${BASE}/api/etut-sablon/all?week=${weekKey}`);
  const all = await allRes.json();
  const mine = (all.etutler || []).find(e => e.teacherId === TEACHER_ID && e.start === '10:00' && e.dayIndex === DAY);
  const etutId = mine?.id;

  const stuCtx = await browser.newContext({ storageState: STU_STATE });
  const teaCtx = await browser.newContext({ storageState: TEA_STATE });
  const stu = await stuCtx.newPage();
  const tea = await teaCtx.newPage();

  try {
    // ---- ÖĞRENCİ: müsait etütten rezerve eder ----
    await stu.goto('/');
    await stu.waitForLoadState('networkidle').catch(() => {});
    await stu.getByRole('button', { name: 'Müsait Etütler' }).click();
    await stu.waitForTimeout(1500);
    await stu.screenshot({ path: 'e2e/shots/etut-01-ogrenci-musait.png', fullPage: true });

    await stu.getByRole('button', { name: new RegExp(TEACHER_NAME) }).click(); // öğretmen ağacını aç
    await stu.waitForTimeout(500);
    await stu.getByRole('button', { name: /Cumartesi/ }).click(); // günü aç
    await stu.waitForTimeout(500);
    await stu.screenshot({ path: 'e2e/shots/etut-02-ogrenci-slotlar.png', fullPage: true });
    // Geometri branş butonunu rezerve et. DİKKAT: "Geometri" öğretmen başlığında da
    // (branş listesi metni) geçer → exact:true ile yalnız branş butonunu hedefle.
    await stu.getByRole('button', { name: 'Geometri', exact: true }).click();
    await stu.waitForTimeout(1800);
    await stu.screenshot({ path: 'e2e/shots/etut-03-ogrenci-rezerve.png', fullPage: true });

    // ---- ÖĞRENCİ: "Etütlerim"de rezervasyonu görür ----
    await stu.getByRole('button', { name: 'Etütlerim' }).click();
    await stu.waitForTimeout(1500);
    await stu.screenshot({ path: 'e2e/shots/etut-04-ogrenci-etutlerim.png', fullPage: true });
    await expect(stu.getByText(/Geometri/).first()).toBeVisible({ timeout: 8000 });
    await expect(stu.getByText(new RegExp(TEACHER_NAME)).first()).toBeVisible({ timeout: 8000 });

    // ---- ÖĞRETMEN: "Program"da öğrencinin rezervasyonunu görür ----
    await tea.goto('/');
    await tea.waitForLoadState('networkidle').catch(() => {});
    await tea.getByRole('button', { name: 'Program' }).click();
    await tea.waitForTimeout(2000);
    await tea.screenshot({ path: 'e2e/shots/etut-05-ogretmen-program.png', fullPage: true });
    await expect(tea.getByText('Duha pirinç').first()).toBeVisible({ timeout: 8000 });
  } finally {
    // ---- TEARDOWN: etüt şablonunu sil (rezervasyon da gider) ----
    if (etutId) {
      await dirSetup.request.delete(`${BASE}/api/etut-sablon`, {
        headers: { 'Content-Type': 'application/json', Origin: BASE },
        data: { teacherId: TEACHER_ID, id: etutId },
      }).catch(() => {});
    }
    await dirSetup.close();
    await stuCtx.close();
    await teaCtx.close();
  }
});
