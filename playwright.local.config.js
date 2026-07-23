// Tamamen yerel E2E paketi. Bu dosya doğrudan değil, DB/Redis güvenlik kilidini kuran
// `npm run test:e2e:local` ile çalıştırılır.
// Mobil uçlar kurumu güvenlik gereği yalnız Host üzerinden kabul eder. Yerelde de
// gerçek alan adı biçimini taklit et: testkurs.localhost -> testkurs, localhost -> apex.
process.env.APP_DOMAIN = 'localhost';
process.env.OKULIN_BASE_URL = 'http://testkurs.localhost:43128';
process.env.OKULIN_APEX_BASE_URL = 'http://localhost:43128';
process.env.OKULIN_FAKE_REDIS_URL = 'http://127.0.0.1:43129';
process.env.OKULIN_DIR_USER = 'testkurs_mudur';
process.env.OKULIN_DIR_PASS = 'Test1234!';
process.env.OKULIN_TEA_USER = 'testkurs_ogretmen';
process.env.OKULIN_TEA_PASS = 'Test1234!';
process.env.OKULIN_STU_USER = 'testkurs_ogrenci';
process.env.OKULIN_STU_PASS = 'Test1234!';
process.env.OKULIN_PAR_USER = '905310000101';
process.env.OKULIN_PAR_PASS = 'Test1234!';
process.env.OKULIN_ORG_CODE = 'ABC234';

const { defineConfig } = require('@playwright/test');
const base = require('./playwright.config.js');
const { LOCAL_SAFE, REDIS_REQUIRED } = require('./e2e/safety-groups.js');

module.exports = defineConfig({
  ...base,
  globalSetup: './tests/e2e/local-global-setup.mjs',
  webServer: [
    {
      command: 'node scripts/test/fake-upstash.mjs --port 43129',
      url: 'http://127.0.0.1:43129/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'node scripts/test/run-with-test-db.mjs npm run dev -- --hostname 127.0.0.1 --port 43128',
      url: process.env.OKULIN_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.js/ },
    {
      name: 'local-safe',
      testMatch: [...LOCAL_SAFE, ...REDIS_REQUIRED].map((name) => new RegExp(name.replaceAll('.', '\\.'))),
      dependencies: ['setup'],
    },
  ],
});
