const { defineConfig } = require('@playwright/test');

// okulin uçtan uca smoke testleri. Hedef site OKULIN_BASE_URL env'inden gelir
// (varsayılan canlı testkurs). Giriş bilgileri ASLA dosyada değil — env'den okunur.
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    baseURL: process.env.OKULIN_BASE_URL || 'https://testkurs.okulin.com',
    headless: true,
    viewport: { width: 1366, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  reporter: [['list']],
});
