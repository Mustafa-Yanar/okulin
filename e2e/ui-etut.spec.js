/**
 * GERÇEK UI MULTI-CONTEXT — Etüt (serbest şablon) rezervasyonu
 * Müdür uygun bir öğretmene etüt şablonu ekler (gerçek API) → OTURUM ÖĞRENCİSİ
 * müsait etütten UI ile rezerve eder → "Etütlerim"de görür → oturum ÖĞRETMENİ
 * aynı veriyi API'den çapraz doğrular.
 *
 * Dinamik kurgu (sabit fikstür yok):
 * - Öğrenci = oturum sahibi (whoami). Şablon sahibi öğretmen = öğrencinin
 *   grubuna (allowedGroups) ve sınıfının ders listesine UYUMLU ilk öğretmen —
 *   oturum öğretmeni her kurulumda öğrenciyle aynı grupta olmayabilir, bu
 *   yüzden partner keşifle seçilir; oturum öğretmeni doğrulayıcı roldedir.
 * - Gün/saat dinamik: bu haftanın geleceğinde kalan ilk gün, 23:00–23:30
 *   (geçmiş-etüt filtresine takılmaz, gerçek programla çakışmaz).
 * Temizlik afterAll'da (test timeout'unda finally kesilebilir): eklenen şablon
 * silinir (rezervasyon da birlikte gider).
 */
const { test, expect } = require('@playwright/test');
const {
  BASE, JSON_HEADERS, DIR_STATE, TEA_STATE, STU_STATE,
  getWeekKey, slotStartTime, DAY_LABELS, whoami, reEscape,
} = require('./helpers');

const MATH_FAMILY = ['TYT Matematik', 'AYT Matematik', 'Geometri'];
const START = '23:00', END = '23:30';
const SLOT_LABEL = `${START}–${END}`;

// afterAll temizliğinin ihtiyaç duyduğu kimlikler (test sırasında dolar)
const created = { partnerId: null, etutId: null };

test.afterAll(async ({ playwright }) => {
  if (!created.etutId) return;
  const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
  try {
    await dirReq.delete(`${BASE}/api/etut-sablon`, {
      headers: JSON_HEADERS,
      data: { teacherId: created.partnerId, id: created.etutId },
    }).catch(() => {});
  } finally {
    await dirReq.dispose();
  }
});

test('etüt: öğrenci rezerve eder → öğrenci + öğretmen tarafı doğrular', async ({ browser }) => {
  test.setTimeout(150_000);
  const weekKey = getWeekKey();
  const dirSetup = await browser.newContext({ storageState: DIR_STATE });

  // ---- KEŞİF: oturum öğrencisi + uyumlu partner öğretmen + branş ----
  const stuProbe = await browser.newContext({ storageState: STU_STATE });
  const STU = await whoami(stuProbe.request);
  await stuProbe.close();

  const clsData = await (await dirSetup.request.get(`${BASE}/api/classes`)).json();
  const clsRow = (clsData.classes || []).find((c) => c.id === STU.cls);
  const clsDersler = clsRow?.dersler || [];
  expect(clsDersler.length, `öğrencinin sınıfı (${STU.cls}) ders listesiyle kayıtlı olmalı`).toBeGreaterThan(0);

  const allEtut = await (await dirSetup.request.get(`${BASE}/api/etut-sablon/all?week=${weekKey}`)).json();
  const myBookings = (allEtut.etutler || []).filter((e) => e.booked && e.studentId === STU.id);
  const bookedBranches = new Set(myBookings.map((b) => b.branch).filter(Boolean));
  const mathTaken = myBookings.some((b) => MATH_FAMILY.includes(b.branch));

  const teachers = await (await dirSetup.request.get(`${BASE}/api/teachers`)).json();
  const selectableFor = (t) => (t.branches || []).filter((b) =>
    clsDersler.includes(b) && !bookedBranches.has(b) && !(MATH_FAMILY.includes(b) && mathTaken));
  const partner = teachers.find((t) =>
    (t.allowedGroups || []).includes(STU.group) && selectableFor(t).length > 0);
  expect(partner, `öğrencinin grubuna (${STU.group}) uyumlu branşlı öğretmen bulunamadı`).toBeTruthy();
  const branch = selectableFor(partner)[0]; // UI'nin göstereceği ilk seçilebilir branş

  // Gün: bu hafta 23:00'ı henüz geçmemiş ilk gün
  const now = Date.now();
  let day = -1;
  for (let d = 0; d <= 6; d++) {
    if (slotStartTime(weekKey, d, START).getTime() > now + 15 * 60 * 1000) { day = d; break; }
  }
  expect(day, 'bu hafta gelecekte kalan gün yok (Pazar gece yarısına çok yakın)').toBeGreaterThanOrEqual(0);

  // ---- ÖN-KOŞUL: müdür partnere etüt şablonu ekler ----
  const addRes = await dirSetup.request.post(`${BASE}/api/etut-sablon`, {
    headers: JSON_HEADERS,
    data: { teacherId: partner.id, weekKey, sablon: { dayIndex: day, start: START, end: END, aktif: true } },
  });
  expect(addRes.status(), await addRes.text()).toBe(200);

  // Eklenen şablonun id'sini bul (teardown + çapraz doğrulama için)
  const allRes = await dirSetup.request.get(`${BASE}/api/etut-sablon/all?week=${weekKey}`);
  const all = await allRes.json();
  const mine = (all.etutler || []).find((e) =>
    e.teacherId === partner.id && e.dayIndex === day && e.start === START && !e.booked);
  const etutId = mine?.id;
  expect(etutId, 'eklenen şablon listede bulunamadı').toBeTruthy();
  created.partnerId = partner.id;
  created.etutId = etutId;

  const stuCtx = await browser.newContext({ storageState: STU_STATE });
  const teaCtx = await browser.newContext({ storageState: TEA_STATE });
  const stu = await stuCtx.newPage();

  try {
    // ---- ÖĞRENCİ: müsait etütten rezerve eder ----
    await stu.goto('/');
    await stu.waitForLoadState('networkidle').catch(() => {});
    await stu.getByRole('button', { name: 'Müsait Etütler' }).click();
    await stu.waitForTimeout(1500);
    await stu.screenshot({ path: 'e2e/shots/etut-01-ogrenci-musait.png', fullPage: true });

    await stu.getByRole('button', { name: new RegExp(reEscape(partner.name)) }).first().click(); // öğretmen ağacını aç
    await stu.waitForTimeout(500);
    await stu.getByRole('button', { name: new RegExp(`^${DAY_LABELS[day]}`) }).first().click(); // günü aç
    await stu.waitForTimeout(500);
    await stu.screenshot({ path: 'e2e/shots/etut-02-ogrenci-slotlar.png', fullPage: true });

    // Şablon satırı (23:00–23:30) içindeki branş butonuna tıkla.
    // Tek branşta etiket "X · Al", çok branşta düz "X" → ^X regex ikisini de yakalar.
    const row = stu.locator(`xpath=//span[text()="${SLOT_LABEL}"]/ancestor::div[contains(@class,"justify-between")][1]`).first();
    await expect(row).toBeVisible({ timeout: 8000 });
    await row.getByRole('button', { name: new RegExp(`^${reEscape(branch)}`) }).click();
    // Rezervasyonun GERÇEKTEN başarılı olduğunu anında doğrula (hata toast'ı
    // sessizce yutulup sonraki adımlarda kafa karıştırmasın)
    await expect(stu.getByText('Etüde kaydoldunuz').first()).toBeVisible({ timeout: 8000 });
    await stu.waitForTimeout(1200);
    await stu.screenshot({ path: 'e2e/shots/etut-03-ogrenci-rezerve.png', fullPage: true });

    // ---- ÖĞRENCİ: "Etütlerim"de rezervasyonu görür ----
    await stu.getByRole('button', { name: 'Etütlerim' }).click();
    await stu.getByText('Yükleniyor').first().waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await stu.waitForTimeout(800);
    await stu.screenshot({ path: 'e2e/shots/etut-04-ogrenci-etutlerim.png', fullPage: true });
    // Gün başlığı + "N etüt" sayacı = rezervasyon öğrenci paneline yansıdı
    await expect(stu.getByText(new RegExp(DAY_LABELS[day])).first()).toBeVisible({ timeout: 10000 });
    await expect(stu.getByText(/\d+ etüt/).first()).toBeVisible({ timeout: 8000 });

    // ---- OTURUM ÖĞRETMENİ tarafı: veri düzeyinde çapraz doğrulama ----
    const teaView = await teaCtx.request.get(`${BASE}/api/etut-sablon/all?week=${weekKey}`);
    expect(teaView.status()).toBe(200);
    const teaEtuts = (await teaView.json()).etutler || [];
    const booked = teaEtuts.find((e) => e.id === etutId && e.teacherId === partner.id);
    expect(booked, 'etüt öğretmen tarafında görünmeli').toBeTruthy();
    expect(booked.booked, 'etüt rezerve görünmeli').toBe(true);
    expect(booked.studentName).toBe(STU.name);
    expect(booked.branch).toBe(branch);
  } finally {
    // Veri temizliği afterAll'da — burada yalnız context'ler kapatılır
    await dirSetup.close();
    await stuCtx.close();
    await teaCtx.close();
  }
});
