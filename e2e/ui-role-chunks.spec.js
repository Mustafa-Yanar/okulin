const { test, expect } = require('@playwright/test');

const BASE = process.env.OKULIN_BASE_URL;
const MANAGEMENT_PASSWORD = process.env.OKULIN_DIR_PASS;

const ROLES = [
  { label: 'müdür', username: process.env.OKULIN_DIR_USER, password: MANAGEMENT_PASSWORD, loginRole: 'management', nav: 'Sınıf/Öğrenci' },
  { label: 'müdür yardımcısı', username: process.env.OKULIN_AST_USER, password: MANAGEMENT_PASSWORD, loginRole: 'management', nav: 'Sınıf/Öğrenci' },
  { label: 'rehber', username: process.env.OKULIN_COU_USER, password: MANAGEMENT_PASSWORD, loginRole: 'management', nav: 'Rehberlik' },
  { label: 'muhasebeci', username: process.env.OKULIN_ACC_USER, password: MANAGEMENT_PASSWORD, loginRole: 'management', nav: 'Öğrenci Ödemeleri' },
  { label: 'kurum yöneticisi', username: process.env.OKULIN_HQ_USER, password: MANAGEMENT_PASSWORD, loginRole: 'management', heading: 'Şubeler' },
  { label: 'öğretmen', username: process.env.OKULIN_TEA_USER, password: process.env.OKULIN_TEA_PASS, loginRole: 'teacher', nav: 'Yoklama' },
  { label: 'öğrenci', username: process.env.OKULIN_STU_USER, password: process.env.OKULIN_STU_PASS, loginRole: 'student', nav: 'Müsait Etütler' },
  { label: 'veli', username: process.env.OKULIN_PAR_USER, password: process.env.OKULIN_PAR_PASS, loginRole: 'parent', nav: 'Ödeme' },
];

test.describe.serial('rol bazlı dinamik panel yükleme', () => {
  for (const role of ROLES) {
    test(`${role.label} yalnız kendi panel parçasını hatasız yükler`, async ({ browser }) => {
      test.skip(!BASE || !role.username || !role.password, `${role.label} E2E bilgileri env üzerinden gerekli`);

      const context = await browser.newContext({ baseURL: BASE });
      const page = await context.newPage();
      const runtimeErrors = [];
      const chunkErrors = [];
      page.on('pageerror', (error) => runtimeErrors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') runtimeErrors.push(message.text());
      });
      page.on('response', (response) => {
        if (response.url().includes('/_next/static/chunks/') && response.status() >= 400) {
          chunkErrors.push(`${response.status()} ${response.url()}`);
        }
      });
      page.on('requestfailed', (request) => {
        if (request.url().includes('/_next/static/chunks/')) {
          chunkErrors.push(`${request.failure()?.errorText || 'başarısız'} ${request.url()}`);
        }
      });

      const login = await context.request.post(`${BASE}/api/auth`, {
        headers: { 'Content-Type': 'application/json', Origin: BASE },
        data: { action: 'login', username: role.username, password: role.password, role: role.loginRole },
      });
      expect(login.status(), `${role.label} giriş yanıtı`).toBe(200);

      await page.goto('/');
      if (role.heading) {
        await expect(page.getByRole('heading', { name: role.heading, exact: true })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: role.nav, exact: true }).first()).toBeVisible();
        await expect(page.locator('main')).not.toContainText('Yükleniyor...');
        expect(await page.locator('main').evaluate((node) => node.childElementCount)).toBeGreaterThan(0);
      }

      expect(chunkErrors, `${role.label} panel chunk hataları`).toEqual([]);
      expect(runtimeErrors, `${role.label} tarayıcı hataları`).toEqual([]);
      await context.close();
    });
  }
});
