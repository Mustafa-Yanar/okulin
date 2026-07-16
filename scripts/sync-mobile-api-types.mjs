// lib/mobile/api-types.ts → mobile/src/api/types.ts birebir kopya.
// Tek kaynak web tarafıdır; mobil kopya ELLE DÜZENLENMEZ.
// Drift denetimi: lib/mobile/api-types.sync.test.ts (npm test).
import { copyFileSync, mkdirSync } from 'node:fs';

mkdirSync('mobile/src/api', { recursive: true });
copyFileSync('lib/mobile/api-types.ts', 'mobile/src/api/types.ts');
console.log('mobile/src/api/types.ts güncellendi (lib/mobile/api-types.ts kopyası)');
