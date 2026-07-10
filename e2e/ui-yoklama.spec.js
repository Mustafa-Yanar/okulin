/**
 * GERÇEK UI MULTI-CONTEXT — Yoklama zinciri
 * Öğretmen yoklama girer → müdür Rehberlik>Yoklama özetinde görür.
 *
 * Dinamik kurgu (sabit fikstür yok):
 * - Öğretmen = oturum sahibi (whoami). Öğrenci = teste özel oluşturulan kayıt;
 *   sınıf = registry'den keşfedilen, öğrencisi olmayan SON mezun şubesi
 *   (int-slots-rules İLK boş şubeyi alır → paralel koşuda çakışmazlar; boş
 *   şube sayesinde gerçek öğrenci/veliye push riski de yok).
 * - Ders şablonu GELECEK haftanın weekKey'i ile yazılır (geçmiş-slot guard'ına
 *   takılmaz; şablon haftadan bağımsızdır), sonra boş diff'li POST ile BU hafta
 *   satırları şablondan yeniden kurulur → müdür özeti bu haftanın grid'ini okur.
 * - Slot çakışmaları için (gün 0-3 × slot 1-6) deneme döngüsü: 'Çakışma' dönerse
 *   sıradaki slota geçilir.
 *
 * TEMİZLİK afterAll'da (test timeout'unda finally kesilebilir — afterAll kendi
 * bütçesiyle her durumda koşar): yoklama boşaltılır, şablon girdisi silinir,
 * hafta yeniden kurulur, test öğrencisi silinir — kalıcı çöp yok.
 */
const { test, expect } = require('@playwright/test');
const {
  BASE, JSON_HEADERS, DIR_STATE, TEA_STATE,
  getWeekKey, shiftWeek, dateForDay, DAY_LABELS, DAY_SHORTS, whoami, reEscape,
} = require('./helpers');

// afterAll temizliğinin ihtiyaç duyduğu kimlikler (test sırasında dolar)
const created = { stuId: null, teaId: null, day: -1, slotId: null, attDate: null, cls: null };

test.afterAll(async ({ playwright }) => {
  const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
  const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
  try {
    // 1) Yoklama kaydını boşalt (öğretmen rolü gerekir)
    if (created.attDate && created.cls) {
      await teaReq.post(`${BASE}/api/attendance`, {
        headers: JSON_HEADERS,
        data: { date: created.attDate, cls: created.cls, lessonNo: '1', attendance: {} },
      }).catch(() => {});
    }
    // 2) Şablondaki dersi kaldır + bu haftayı şablona göre yeniden kur
    if (created.slotId && created.teaId) {
      const weekKey = getWeekKey();
      await dirReq.post(`${BASE}/api/program`, {
        headers: JSON_HEADERS,
        data: { teacherId: created.teaId, weekKey: shiftWeek(weekKey, 1), program: { [created.day]: { [created.slotId]: null } } },
      }).catch(() => {});
      await dirReq.post(`${BASE}/api/program`, {
        headers: JSON_HEADERS,
        data: { teacherId: created.teaId, weekKey, program: {} },
      }).catch(() => {});
    }
    // 3) Test öğrencisini sil
    if (created.stuId) {
      await dirReq.delete(`${BASE}/api/students`, {
        headers: JSON_HEADERS,
        data: { id: created.stuId },
      }).catch(() => {});
    }
  } finally {
    await dirReq.dispose();
    await teaReq.dispose();
  }
});

test('yoklama: öğretmen girer → müdür özetinde görür', async ({ browser }) => {
  test.setTimeout(150_000);
  const weekKey = getWeekKey();
  const nextWeek = shiftWeek(weekKey, 1);

  const dirSetup = await browser.newContext({ storageState: DIR_STATE });
  const teaProbe = await browser.newContext({ storageState: TEA_STATE });
  const TEA = await whoami(teaProbe.request);
  await teaProbe.close();
  created.teaId = TEA.id;

  // ---- KEŞİF: öğrencisi olmayan bir mezun şubesi (sondan seç) ----
  const [clsData, students] = await Promise.all([
    (await dirSetup.request.get(`${BASE}/api/classes`)).json(),
    (await dirSetup.request.get(`${BASE}/api/students`)).json(),
  ]);
  const usedCls = new Set((students || []).map((s) => s.cls));
  const emptyMezun = (clsData.classes || []).filter((c) => c.group === 'mezun' && !usedCls.has(c.id));
  expect(emptyMezun.length, 'öğrencisiz mezun şubesi bulunamadı').toBeGreaterThan(0);
  const TEST_CLS = emptyMezun[emptyMezun.length - 1].id;
  created.cls = TEST_CLS;

  // ---- ÖN-KOŞUL 1: teste özel öğrenci ----
  const stuName = `E2E Yoklama ${Date.now().toString(36)}`;
  const createRes = await dirSetup.request.post(`${BASE}/api/students`, {
    headers: JSON_HEADERS,
    data: {
      name: stuName, cls: TEST_CLS, password: 'e2e-gecici-sifre',
      parentName: 'E2E Test Velisi', parentPhone: '0532 999 00 01',
    },
  });
  expect(createRes.status(), await createRes.text()).toBe(200);
  created.stuId = (await createRes.json()).id;

  // ---- ÖN-KOŞUL 2: müdür öğretmene ders atar (boş gün/slot keşfiyle) ----
  let day = -1, slotId = null;
  outer: for (let d = 0; d <= 3; d++) {
    for (let s = 1; s <= 6; s++) {
      const cand = `d${d}s${s}`;
      const res = await dirSetup.request.post(`${BASE}/api/program`, {
        headers: JSON_HEADERS,
        data: { teacherId: TEA.id, weekKey: nextWeek, program: { [d]: { [cand]: { type: 'ders', cls: TEST_CLS, fixed: true } } } },
      });
      if (res.status() === 200) { day = d; slotId = cand; break outer; }
      const err = (await res.json().catch(() => ({}))).error || '';
      if (!/Çakışma/i.test(err)) throw new Error(`Program atama beklenmedik hata (${cand}): ${err}`);
    }
  }
  expect(slotId, 'gün 0-3 / slot 1-6 içinde boş slot bulunamadı').toBeTruthy();
  created.day = day;
  created.slotId = slotId;

  // Bu haftanın satırlarını şablondan yeniden kur (boş diff → yalnız init)
  const initRes = await dirSetup.request.post(`${BASE}/api/program`, {
    headers: JSON_HEADERS,
    data: { teacherId: TEA.id, weekKey, program: {} },
  });
  expect(initRes.status()).toBe(200);

  created.attDate = dateForDay(weekKey, day); // öğretmen panelinin yazacağı tarih

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

    await tea.getByRole('button', { name: new RegExp(DAY_LABELS[day]) }).click(); // günü aç
    await tea.waitForTimeout(600);
    await tea.getByRole('button', { name: new RegExp(`1\\. Ders.*${TEST_CLS.toUpperCase()}`) }).click(); // dersi aç
    await tea.waitForTimeout(800);
    await tea.screenshot({ path: 'e2e/shots/yoklama-02-ogretmen-ders.png', fullPage: true });

    // Test öğrencisini "Yok" işaretle — satır bazlı hedefleme (sınıfta başka
    // test kaydı olsa bile yanlış öğrenci işaretlenmez)
    await expect(tea.getByText(stuName).first()).toBeVisible({ timeout: 8000 });
    const stuRow = tea.locator(`xpath=//span[text()="${stuName}"]/ancestor::div[contains(@class,"justify-between")][1]`).first();
    await stuRow.getByRole('button', { name: 'Yok', exact: true }).click();
    await tea.getByRole('button', { name: /Yoklamasını Kaydet/ }).click();
    await expect(tea.getByText('Yoklama kaydedildi').first()).toBeVisible({ timeout: 8000 });
    await tea.screenshot({ path: 'e2e/shots/yoklama-03-ogretmen-kaydetti.png', fullPage: true });

    // ---- MÜDÜR: Rehberlik > Yoklama özetinde görür ----
    await dir.goto('/');
    await dir.waitForLoadState('networkidle').catch(() => {});
    await dir.getByRole('button', { name: 'Rehberlik' }).click();
    await dir.waitForTimeout(1500);
    // Yoklama alt-sekmesi varsayılan aktif; gün şeridinde ilgili günü seç
    await dir.getByRole('button', { name: new RegExp(DAY_SHORTS[day], 'i') }).first().click();
    await dir.waitForTimeout(1500);
    await dir.screenshot({ path: 'e2e/shots/yoklama-04-mudur-gunluk.png', fullPage: true });

    // Sınıf kartı "N yok" rozetiyle görünmeli → tıkla
    await expect(dir.getByText(/\d+ yok/).first()).toBeVisible({ timeout: 8000 });
    await dir.getByRole('button', { name: new RegExp(TEST_CLS.toUpperCase()) }).first().click();
    await dir.waitForTimeout(1000);
    await dir.screenshot({ path: 'e2e/shots/yoklama-05-mudur-modal.png', fullPage: true });
    // Modalda test öğrencisi "Yok" listesinde
    await expect(dir.getByText(new RegExp(reEscape(stuName))).first()).toBeVisible({ timeout: 8000 });
  } finally {
    await dirSetup.close();
    await teaCtx.close();
    await dirCtx.close();
  }
});
