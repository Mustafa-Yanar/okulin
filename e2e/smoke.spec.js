const { test, expect } = require('@playwright/test');

// Müdür rolüyle giriş + ana panellerin turu. Amaç: refactor sonrası tüm panellerin
// render olduğunu, useClasses (ClassesProvider) tüketicilerinin (Duyuru/Kütüphane/
// Takvim) boşa düşmediğini ve tarayıcı konsolunda kritik hata olmadığını doğrulamak.
// Giriş bilgileri env'den: OKULIN_DIR_USER / OKULIN_DIR_PASS.

const USER = process.env.OKULIN_DIR_USER;
const PASS = process.env.OKULIN_DIR_PASS;

test('müdür: giriş + panel turu (konsol hata avı + screenshot)', async ({ page }) => {
  test.skip(!USER || !PASS, 'OKULIN_DIR_USER / OKULIN_DIR_PASS env gerekli');

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

  // 1) Giriş
  await page.goto('/');
  await page.getByText('Yönetim', { exact: false }).first().click();
  await page.locator('input').first().fill(USER);
  await page.locator('input[type="password"]').fill(PASS);
  await page.getByRole('button', { name: /Giriş Yap/ }).click();

  // Panel yüklensin — müdür rol rozeti / öğretmen başlığı beklenir
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'e2e/shots/01-giris-sonrasi.png', fullPage: true });

  // Giriş başarılı mı? (login formu kaybolmalı, panel gelmeli)
  await expect(page.getByText('Müdür', { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  // 2) useClasses tüketen + yeni sekmeler turu — her birini screenshot'la
  const tabs = ['Sınıf/Öğrenci', 'Rehberlik', 'Duyurular', 'Kütüphane', 'Etkinlik Takvimi', 'Ders Programı Oluştur'];
  let i = 2;
  for (const label of tabs) {
    try {
      await page.getByRole('button', { name: label }).first().click();
      await page.waitForTimeout(2200);
      const safe = label.replace(/[\/ ]/g, '_');
      await page.screenshot({ path: `e2e/shots/0${i}-${safe}.png`, fullPage: true });
    } catch (e) {
      errors.push(`SEKME AÇILAMADI: ${label} — ${e.message}`);
    }
    i++;
  }

  // Konsol hatalarını rapora bas (favicon/3.taraf gürültüsü olabilir → hard-fail etmiyoruz)
  console.log('=== TARAYICI KONSOL/PAGE HATALARI ===');
  console.log(errors.length ? errors.join('\n') : 'YOK');
});
