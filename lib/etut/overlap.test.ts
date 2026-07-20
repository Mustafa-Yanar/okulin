import { describe, it, expect } from 'vitest';
import { toMin, intervalsOverlap, findTimeConflict, type NormalizedBooking } from './overlap';

describe('toMin', () => {
  it('"15:30" → 930; "00:00" → 0', () => {
    expect(toMin('15:30')).toBe(930);
    expect(toMin('00:00')).toBe(0);
  });
});

describe('intervalsOverlap — yarı-açık [start, end)', () => {
  it('kısmi örtüşme → true (14:00-15:00 vs 14:30-15:30)', () => {
    expect(intervalsOverlap(840, 900, 870, 930)).toBe(true);
  });
  it('bitişik → false (14:00-15:00 vs 15:00-16:00)', () => {
    expect(intervalsOverlap(840, 900, 900, 960)).toBe(false);
  });
  it('içerme → true (14:00-16:00 vs 14:30-15:00)', () => {
    expect(intervalsOverlap(840, 960, 870, 900)).toBe(true);
  });
  it('ayrık → false', () => {
    expect(intervalsOverlap(840, 900, 960, 1020)).toBe(false);
  });
});

describe('findTimeConflict', () => {
  const mk = (d: number, s: string, e: string, src: 'slot' | 'etut' = 'etut'): NormalizedBooking =>
    ({ dayIndex: d, startMin: toMin(s), endMin: toMin(e), dersBranch: 'Fizik', source: src });
  it('aynı gün örtüşen → çakışan kaydı döner', () => {
    const hit = findTimeConflict([mk(2, '14:00', '15:00', 'slot')], { dayIndex: 2, startMin: toMin('14:30'), endMin: toMin('15:30') });
    expect(hit?.source).toBe('slot');
  });
  it('farklı gün → null', () => {
    expect(findTimeConflict([mk(3, '14:00', '15:00')], { dayIndex: 2, startMin: 870, endMin: 930 })).toBeNull();
  });
  it('aynı gün bitişik → null', () => {
    expect(findTimeConflict([mk(2, '14:00', '15:00')], { dayIndex: 2, startMin: toMin('15:00'), endMin: toMin('16:00') })).toBeNull();
  });
});
