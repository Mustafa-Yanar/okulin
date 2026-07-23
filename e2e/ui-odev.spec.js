/**
 * GERÇEK UI MULTI-CONTEXT — Ödev döngüsü
 * Öğretmen ödev verir → öğrenci görür + teslim eder → öğretmen kontrol eder.
 * Üç adımlı, iki rol eşzamanlı. storageState ile login atlanır.
 *
 * Dinamik kurgu (sabit fikstür yok): ödev, OTURUM ÖĞRENCİSİNİN sınıfına verilir;
 * sınıf çipi etiketi kayıttaki görünen ad (classes registry `ad`) ile keşfedilir.
 * Temizlik afterAll'da (test timeout'unda finally kesilebilir): verilen ödev
 * başlıkla bulunup API'den silinir (teslimler kayıtla birlikte gider).
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, TEA_STATE, STU_STATE, whoami, reEscape } = require('./helpers');

const title = 'Test Ödev ' + Date.now();

test.afterAll(async ({ playwright }) => {
  const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
  try {
    const list = await (await teaReq.get(`${BASE}/api/odev`)).json();
    const mine = (list.odevler || []).find((o) => o.title === title);
    if (mine) {
      await teaReq.delete(`${BASE}/api/odev?id=${mine.id}`, { headers: JSON_HEADERS }).catch(() => {});
    }
  } catch { /* best-effort */ } finally {
    await teaReq.dispose();
  }
});

test('ödev: öğretmen verir → öğrenci teslim → öğretmen kontrol', async ({ browser }) => {
  test.setTimeout(150_000);
  const desc = 'Sayfa 42-50 arası sorular.';

  const teaCtx = await browser.newContext({ storageState: TEA_STATE });
  const stuCtx = await browser.newContext({ storageState: STU_STATE });
  const tea = await teaCtx.newPage();
  const stu = await stuCtx.newPage();

  try {
    // ---- KEŞİF: oturum öğrencisi + sınıfının görünen adı ----
    const STU = await whoami(stuCtx.request);
    const clsData = await (await teaCtx.request.get(`${BASE}/api/classes`)).json();
    const clsRow = (clsData.classes || []).find((c) => c.id === STU.cls);
    expect(clsRow, `öğrencinin sınıfı (${STU.cls}) kayıtlı olmalı`).toBeTruthy();
    const clsLabel = clsRow.ad; // ödev formundaki çip etiketi

    // ---- 1) ÖĞRETMEN: ödev verir ----
    await tea.goto('/');
    await tea.waitForLoadState('networkidle').catch(() => {});
    await tea.getByRole('button', { name: 'Ödevler' }).click();
    await tea.waitForTimeout(1200);
    await tea.getByPlaceholder(/Ödev başlığı/).fill(title);
    await tea.getByPlaceholder(/Açıklama/).fill(desc);
    await tea.getByPlaceholder('Ders / Branş').fill('Deneme Dersi');
    await tea.getByRole('button', { name: clsLabel }).click(); // öğrencinin sınıfını seç
    await tea.screenshot({ path: 'e2e/shots/odev-01-ogretmen-form.png', fullPage: true });
    await tea.getByRole('button', { name: /Ödev Ver/ }).click();
    await tea.waitForTimeout(2000);
    await expect(tea.getByText(title).first()).toBeVisible({ timeout: 10000 });
    await tea.screenshot({ path: 'e2e/shots/odev-02-ogretmen-verildi.png', fullPage: true });

    // ---- 2) ÖĞRENCİ: ödevi görür + teslim eder ----
    await stu.goto('/');
    await stu.waitForLoadState('networkidle').catch(() => {});
    await stu.getByRole('button', { name: 'Ödevlerim' }).click();
    await stu.waitForTimeout(1200);
    const stuCard = stu.getByText(title).first().locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-xl ")][1]');
    await expect(stuCard).toBeVisible({ timeout: 10000 });
    await stuCard.getByRole('button', { name: /Teslim Ettim/ }).click();
    await stu.waitForTimeout(500);
    await stuCard.getByPlaceholder(/Not/).fill('Tamamladım.');
    await stuCard.getByRole('button', { name: /^Teslim Et$/ }).click();
    await stu.waitForTimeout(1500);
    await expect(stuCard.getByText(/Teslim edildi/)).toBeVisible({ timeout: 8000 });
    await stu.screenshot({ path: 'e2e/shots/odev-03-ogrenci-teslim.png', fullPage: true });

    // ---- 3) ÖĞRETMEN: teslimi kontrol eder ----
    // Verilen ödev kartına tıkla → KontrolModal (taze SWR → öğrenci teslimini görür)
    await tea.getByText(title).first().click();
    await tea.waitForTimeout(1500);
    await tea.screenshot({ path: 'e2e/shots/odev-04-ogretmen-modal.png', fullPage: true });
    // Öğrenci teslim etti → adının yanında "Kontrol et" görünmeli
    const studentRow = tea.getByRole('dialog').getByText(new RegExp(reEscape(STU.name))).first()
      .locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-lg ")][1]');
    await expect(studentRow).toBeVisible({ timeout: 8000 });
    await studentRow.getByRole('button', { name: /Kontrol et/ }).click();
    await tea.waitForTimeout(500);
    await studentRow.getByPlaceholder(/Puan/).fill('100');
    await studentRow.getByRole('button', { name: /^Kontrol Et$/ }).click();
    // Kontrol başarısı toast ile doğrulanır (modal mutate sonrası yeniden yüklenir)
    await expect(tea.getByText('Kontrol edildi').first()).toBeVisible({ timeout: 8000 });
    await tea.screenshot({ path: 'e2e/shots/odev-05-ogretmen-kontrol.png', fullPage: true });

    // ---- Çapraz doğrulama: öğrenci puanı + kontrol durumunu görür (asıl kanıt) ----
    await stu.reload();
    await stu.waitForLoadState('networkidle').catch(() => {});
    await stu.getByRole('button', { name: 'Ödevlerim' }).click();
    await stu.waitForTimeout(1500);
    await stu.screenshot({ path: 'e2e/shots/odev-06-ogrenci-puan.png', fullPage: true });
    const checkedCard = stu.getByText(title).first().locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " rounded-xl ")][1]');
    await expect(checkedCard.getByText(/Kontrol edildi/)).toBeVisible({ timeout: 8000 });
    await expect(checkedCard.getByText(/Puan: 100/)).toBeVisible({ timeout: 8000 });
  } finally {
    // Veri temizliği afterAll'da — burada yalnız context'ler kapatılır
    await teaCtx.close();
    await stuCtx.close();
  }
});
