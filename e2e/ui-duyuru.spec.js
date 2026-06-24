/**
 * GERÇEK UI MULTI-CONTEXT — Duyuru yayını
 * Müdür gerçek tarayıcıda duyuru gönderir → öğrenci tarayıcısında ekranda belirir.
 * storageState ile login atlanır (auth.setup.js). SQL + UI render birlikte test edilir.
 */
const { test, expect } = require('@playwright/test');

const DIR_STATE = 'e2e/.auth/director.json';
const STU_STATE = 'e2e/.auth/student.json';

test('duyuru: müdür gönderir → öğrenci ekranında belirir', async ({ browser }) => {
  const title = 'Otomatik Test Duyuru ' + Date.now();
  const body = 'Bu bir multi-context UI test duyurusudur.';

  const dirCtx = await browser.newContext({ storageState: DIR_STATE });
  const stuCtx = await browser.newContext({ storageState: STU_STATE });
  const dir = await dirCtx.newPage();
  const stu = await stuCtx.newPage();

  try {
    // ---- MÜDÜR: duyuru gönderir ----
    await dir.goto('/');
    await dir.waitForLoadState('networkidle').catch(() => {});
    await dir.getByRole('button', { name: 'Duyurular' }).click();
    await dir.waitForTimeout(1500);
    await dir.screenshot({ path: 'e2e/shots/duyuru-01-mudur-sekme.png', fullPage: true });

    await dir.getByPlaceholder('Başlık').fill(title);
    await dir.getByPlaceholder('Duyuru metni…').fill(body);
    // Rol seçici: ilk select (Veliler/Öğrenciler/Öğretmenler) → Öğrenciler
    await dir.locator('select').first().selectOption('student');
    await dir.screenshot({ path: 'e2e/shots/duyuru-02-mudur-form.png', fullPage: true });

    await dir.getByRole('button', { name: 'Gönder' }).click();
    await dir.waitForTimeout(2000);
    await dir.screenshot({ path: 'e2e/shots/duyuru-03-mudur-gonderildi.png', fullPage: true });

    // Gönderilen Duyurular listesinde başlık görünmeli
    await expect(dir.getByText(title).first()).toBeVisible({ timeout: 10000 });

    // ---- ÖĞRENCİ: duyuruyu görür ----
    await stu.goto('/');
    await stu.waitForLoadState('networkidle').catch(() => {});
    await stu.getByRole('button', { name: 'Duyurular' }).click();
    await stu.waitForTimeout(1500);
    await stu.screenshot({ path: 'e2e/shots/duyuru-04-ogrenci-gelen.png', fullPage: true });

    // Duyuru başlığı öğrenci gelen kutusunda görünmeli
    await expect(stu.getByText(title).first()).toBeVisible({ timeout: 10000 });

    // Tıkla → içerik açılır
    await stu.getByText(title).first().click();
    await stu.waitForTimeout(800);
    await stu.screenshot({ path: 'e2e/shots/duyuru-05-ogrenci-acik.png', fullPage: true });
    await expect(stu.getByText(body).first()).toBeVisible({ timeout: 5000 });
  } finally {
    await dirCtx.close();
    await stuCtx.close();
  }
});
