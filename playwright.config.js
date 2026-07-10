const { defineConfig } = require('@playwright/test');

// Giriş bilgileri .env.local'den (Playwright kendiliğinden okumaz; Next'in yükleyicisi kullanılır).
require('@next/env').loadEnvConfig(process.cwd());

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
  // Projeler: 'setup' rol oturumlarını bir kez kaydeder (storageState), 'sql' testleri
  // ona bağlıdır (login tekrarı yok → rate-limit'e takılmaz). 'smoke' bağımsız (kendi login'i).
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    { name: 'sql', testMatch: /sql-.*\.spec\.js/, dependencies: ['setup'] },
    { name: 'ui', testMatch: /ui-.*\.spec\.js/, dependencies: ['setup'] },
    { name: 'smoke', testMatch: /smoke\.spec\.js/ },
  ],
});
