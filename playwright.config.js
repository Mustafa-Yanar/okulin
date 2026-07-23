const { defineConfig } = require('@playwright/test');

// Giriş bilgileri .env.local'den (Playwright kendiliğinden okumaz; Next'in yükleyicisi kullanılır).
require('@next/env').loadEnvConfig(process.cwd());

// okulin uçtan uca smoke testleri. Hedef site OKULIN_BASE_URL env'inden gelir.
// Güvenlik: sessiz canlı varsayılan YOK. testkurs canlı hedefi bile açık onay env'i ister;
// akyazicozum her durumda reddedilir. Yerel hedefler onaysız kullanılabilir.
const configuredBase = process.env.OKULIN_BASE_URL;
if (!configuredBase) {
  throw new Error('GÜVENLİK KİLİDİ: OKULIN_BASE_URL zorunlu. Canlı hedef varsayılanı kaldırıldı.');
}
const target = new URL(configuredBase);
if (target.hostname === 'akyazicozum.okulin.com' || target.hostname.endsWith('.akyazicozum.okulin.com')) {
  throw new Error('GÜVENLİK KİLİDİ: akyazicozum uçtan uca test hedefi olamaz.');
}
const isLocalTarget = ['127.0.0.1', 'localhost'].includes(target.hostname) || target.hostname.endsWith('.localhost');
if (isLocalTarget && process.env.OKULIN_TEST_DB_GUARDED !== 'YES') {
  throw new Error('GÜVENLİK KİLİDİ: yerel E2E yalnız "npm run test:e2e:local" ile çalıştırılabilir.');
}
if (!isLocalTarget && target.hostname === 'testkurs.okulin.com' && process.env.OKULIN_ALLOW_LIVE_TESTKURS !== 'YES') {
  throw new Error('GÜVENLİK KİLİDİ: canlı testkurs için OKULIN_ALLOW_LIVE_TESTKURS=YES açık onayı gerekli.');
}
if (!isLocalTarget && target.hostname !== 'testkurs.okulin.com') {
  throw new Error(`GÜVENLİK KİLİDİ: izin verilmeyen E2E hedefi: ${target.hostname}`);
}
const infraIgnore = process.env.OKULIN_ALLOW_INFRA_E2E === 'YES' ? [] : [/int-tenant-isolation\.spec\.js/];

// Giriş bilgileri ASLA dosyada değil — env'den okunur.
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  use: {
    baseURL: configuredBase,
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
    // Entegrasyon testleri: ödeme callback'i, slot kuralları, çözücü, kiracı izolasyonu.
    { name: 'int', testMatch: /int-.*\.spec\.js/, testIgnore: infraIgnore, dependencies: ['setup'] },
    { name: 'smoke', testMatch: /smoke\.spec\.js/ },
  ],
});
