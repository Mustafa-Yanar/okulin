import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const groups = require('../../e2e/safety-groups.js') as Record<string, string[]>;

describe('E2E güvenlik sınıfları', () => {
  it('her spec tam bir güvenlik sınıfına atanmıştır', () => {
    const actual = fs.readdirSync(path.join(process.cwd(), 'e2e'))
      .filter((name) => name.endsWith('.spec.js'))
      .sort();
    const classified = Object.values(groups).flat().sort();

    expect(new Set(classified).size).toBe(classified.length);
    expect(classified).toEqual(actual);
  });

  it('yerel paket dış servis ve altyapı mutasyonu içermez', () => {
    expect(groups.LOCAL_SAFE).not.toContain('int-program-solve.spec.js');
    expect(groups.LOCAL_SAFE).not.toContain('int-tenant-isolation.spec.js');
    expect(groups.LOCAL_SAFE.some((name) => name.includes('mobile') || name.includes('ratelimit'))).toBe(false);
  });
});
