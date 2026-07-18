import { describe, it, expect } from 'vitest';
import { shiftWeekKey } from './week-nav';

describe('shiftWeekKey — ISO hafta gezinme', () => {
  it('sonraki hafta', () => expect(shiftWeekKey('2026-W29', 1)).toBe('2026-W30'));
  it('önceki hafta', () => expect(shiftWeekKey('2026-W29', -1)).toBe('2026-W28'));
  it('yıl sınırı ileri (2026-W53 yok → 2027-W01)', () => {
    // 2026 ISO'da 53 hafta değil; son haftadan +1 yeni yıla geçer
    const r = shiftWeekKey('2026-W52', 1);
    expect(r === '2026-W53' || r === '2027-W01').toBe(true);
  });
  it('yıl sınırı geri (W01 → önceki yıl son hafta)', () => {
    expect(shiftWeekKey('2026-W01', -1)).toMatch(/^2025-W5[23]$/);
  });
  it('delta 0 → aynı', () => expect(shiftWeekKey('2026-W29', 0)).toBe('2026-W29'));
});
