import { defineConfig } from 'vitest/config';

// Yalnız saf (RN import'suz) src modülleri test edilir — ekran/native testleri
// Maestro/Detox ile Plan 4+ (spec §13).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
