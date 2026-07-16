import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

describe('mobil api tipleri senkron', () => {
  it('mobile/src/api/types.ts, lib/mobile/api-types.ts ile birebir aynı (npm run mobile:types)', () => {
    const src = readFileSync('lib/mobile/api-types.ts', 'utf8');
    const copy = readFileSync('mobile/src/api/types.ts', 'utf8');
    expect(copy).toBe(src);
  });
});
