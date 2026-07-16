import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Vitest birim testleri. İki sorunu çözer:
// 1) e2e/ Playwright testleri (*.spec.js) vitest'e karışmasın → exclude.
// 2) Next.js '@/*' path alias'ı vitest'te de çözülsün (örn lib/finance.test.js → @/lib/sqldb).
export default defineConfig({
  test: {
    exclude: ['e2e/**', 'node_modules/**', '.next/**', 'out-render/**', 'scripts/**', 'mobile/**'],
  },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./', import.meta.url)) },
  },
});
