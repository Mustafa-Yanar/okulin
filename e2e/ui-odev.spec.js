/**
 * GERÇEK UI MULTI-CONTEXT — Ödev döngüsü
 * Öğretmen ödev verir → öğrenci görür + teslim eder → öğretmen kontrol eder.
 * Üç adımlı, iki rol eşzamanlı. storageState ile login atlanır.
 */
const { test, expect } = require('@playwright/test');

const TEA_STATE = 'e2e/.auth/teacher.json';
const STU_STATE = 'e2e/.auth/student.json';
const CLASS_LABEL = 'Mezun EA (M7)'; // Duha pirinç'in sınıfı

test('ödev: öğretmen verir → öğrenci teslim → öğretmen kontrol', async ({ browser }) => {
  const title = 'Test Ödev ' + Date.now();
  const desc = 'Sayfa 42-50 arası sorular.';

  const teaCtx = await browser.newContext({ storageState: TEA_STATE });
  const stuCtx = await browser.newContext({ storageState: STU_STATE });
  const tea = await teaCtx.newPage();
  const stu = await stuCtx.newPage();

  try {
    // ---- 1) ÖĞRETMEN: ödev verir ----
    await tea.goto('/');
    await tea.waitForLoadState('networkidle').catch(() => {});
    await tea.getByRole('button', { name: 'Ödevler' }).click();
    await tea.waitForTimeout(1200);
    await tea.getByPlaceholder(/Ödev başlığı/).fill(title);
    await tea.getByPlaceholder(/Açıklama/).fill(desc);
    await tea.getByPlaceholder('Ders / Branş').fill('Matematik');
    await tea.getByRole('button', { name: CLASS_LABEL }).click(); // m7 sınıfını seç
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
    await expect(stu.getByText(title).first()).toBeVisible({ timeout: 10000 });
    await stu.getByRole('button', { name: /Teslim Ettim/ }).click();
    await stu.waitForTimeout(500);
    await stu.getByPlaceholder(/Not/).fill('Tamamladım.');
    await stu.getByRole('button', { name: /^Teslim Et$/ }).click();
    await stu.waitForTimeout(1500);
    await expect(stu.getByText(/Teslim edildi/).first()).toBeVisible({ timeout: 8000 });
    await stu.screenshot({ path: 'e2e/shots/odev-03-ogrenci-teslim.png', fullPage: true });

    // ---- 3) ÖĞRETMEN: teslimi kontrol eder ----
    // Verilen ödev kartına tıkla → KontrolModal (taze SWR → öğrenci teslimini görür)
    await tea.getByText(title).first().click();
    await tea.waitForTimeout(1500);
    await tea.screenshot({ path: 'e2e/shots/odev-04-ogretmen-modal.png', fullPage: true });
    // Öğrenci teslim etti → "Kontrol et" görünmeli
    await expect(tea.getByText('Duha pirinç').first()).toBeVisible({ timeout: 8000 });
    await tea.getByRole('button', { name: /Kontrol et/ }).click();
    await tea.waitForTimeout(500);
    await tea.getByPlaceholder(/Puan/).fill('100');
    await tea.getByRole('button', { name: /^Kontrol Et$/ }).click();
    // Kontrol başarısı toast ile doğrulanır (modal mutate sonrası yeniden yüklenir)
    await expect(tea.getByText('Kontrol edildi').first()).toBeVisible({ timeout: 8000 });
    await tea.screenshot({ path: 'e2e/shots/odev-05-ogretmen-kontrol.png', fullPage: true });

    // ---- Çapraz doğrulama: öğrenci puanı + kontrol durumunu görür (asıl kanıt) ----
    await stu.reload();
    await stu.waitForLoadState('networkidle').catch(() => {});
    await stu.getByRole('button', { name: 'Ödevlerim' }).click();
    await stu.waitForTimeout(1500);
    await stu.screenshot({ path: 'e2e/shots/odev-06-ogrenci-puan.png', fullPage: true });
    await expect(stu.getByText(/Kontrol edildi/).first()).toBeVisible({ timeout: 8000 });
    await expect(stu.getByText(/Puan: 100/).first()).toBeVisible({ timeout: 8000 });
  } finally {
    await teaCtx.close();
    await stuCtx.close();
  }
});
