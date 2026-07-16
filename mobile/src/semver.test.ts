import { describe, it, expect } from 'vitest';
import { semverLt } from './semver';

describe('semverLt', () => {
  it('küçük < büyük', () => {
    expect(semverLt('0.1.0', '0.2.0')).toBe(true);
    expect(semverLt('1.9.9', '2.0.0')).toBe(true);
    expect(semverLt('1.0.9', '1.1.0')).toBe(true);
  });
  it('eşit ve büyük → false', () => {
    expect(semverLt('1.2.3', '1.2.3')).toBe(false);
    expect(semverLt('2.0.0', '1.9.9')).toBe(false);
  });
  it('bozuk/eksik parça 0 sayılır', () => {
    expect(semverLt('1.2', '1.2.1')).toBe(true);
    expect(semverLt('abc', '0.0.1')).toBe(true);
    expect(semverLt('1.0.0', '')).toBe(false);
  });
});
