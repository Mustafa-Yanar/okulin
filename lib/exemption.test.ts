import { describe, it, expect } from 'vitest';
import { isExemptOn } from './exemption';

describe('isExemptOn', () => {
  it('aralık içinde true, iki uç DAHİL', () => {
    expect(isExemptOn('2026-07-20', '2026-07-25', '2026-07-22')).toBe(true);
    expect(isExemptOn('2026-07-20', '2026-07-25', '2026-07-20')).toBe(true);
    expect(isExemptOn('2026-07-20', '2026-07-25', '2026-07-25')).toBe(true);
  });
  it('aralık dışında false', () => {
    expect(isExemptOn('2026-07-20', '2026-07-25', '2026-07-19')).toBe(false);
    expect(isExemptOn('2026-07-20', '2026-07-25', '2026-07-26')).toBe(false);
  });
  it('tek günlük aralık (from === until) o gün true', () => {
    expect(isExemptOn('2026-07-21', '2026-07-21', '2026-07-21')).toBe(true);
    expect(isExemptOn('2026-07-21', '2026-07-21', '2026-07-22')).toBe(false);
  });
  it('eksik uç ya da tarih → false (muafiyet tanımsız sayılır)', () => {
    expect(isExemptOn(null, '2026-07-25', '2026-07-22')).toBe(false);
    expect(isExemptOn('2026-07-20', null, '2026-07-22')).toBe(false);
    expect(isExemptOn('', '', '2026-07-22')).toBe(false);
    expect(isExemptOn('2026-07-20', '2026-07-25', undefined)).toBe(false);
  });
  it('yıl/ay sınırlarında sözlük karşılaştırması kronolojiyle aynı', () => {
    expect(isExemptOn('2026-12-28', '2027-01-03', '2027-01-01')).toBe(true);
    expect(isExemptOn('2026-09-30', '2026-10-02', '2026-10-01')).toBe(true);
  });
});
