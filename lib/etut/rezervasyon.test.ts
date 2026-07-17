import { describe, it, expect } from 'vitest';
import { timeConflicts, branchConflicts, mathFamilyConflict } from './rezervasyon';

const sb = (dayIndex: number, start: string, branch?: string) => ({ id: 'x', dayIndex, start, end: '00:00', branch });

describe('timeConflicts — aynı gün+saat başka etüt', () => {
  it('aynı gün aynı saat → çakışır', () => {
    expect(timeConflicts([sb(2, '14:00')], 2, '14:00')).toBe(true);
  });
  it('farklı saat → çakışmaz', () => {
    expect(timeConflicts([sb(2, '14:00')], 2, '15:00')).toBe(false);
  });
  it('farklı gün → çakışmaz', () => {
    expect(timeConflicts([sb(3, '14:00')], 2, '14:00')).toBe(false);
  });
  it('boş liste → çakışmaz', () => {
    expect(timeConflicts([], 2, '14:00')).toBe(false);
  });
});

describe('branchConflicts — aynı dersten ikinci etüt', () => {
  it('aynı branş yazılı → çakışır', () => {
    expect(branchConflicts([sb(1, '10:00', 'Fizik')], 'Fizik')).toBe(true);
  });
  it('farklı branş → çakışmaz', () => {
    expect(branchConflicts([sb(1, '10:00', 'Fizik')], 'Kimya')).toBe(false);
  });
});

describe('mathFamilyConflict — matematik ailesi tek etüt', () => {
  it('TYT Matematik yazılıyken AYT Matematik → çakışır', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'TYT Matematik')], 'AYT Matematik')).toBe(true);
  });
  it('Geometri yazılıyken TYT Matematik → çakışır', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'Geometri')], 'TYT Matematik')).toBe(true);
  });
  it('yeni branş matematik değil → çakışmaz', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'TYT Matematik')], 'Fizik')).toBe(false);
  });
  it('matematik ailesinden hiç yazılı yok → çakışmaz', () => {
    expect(mathFamilyConflict([sb(1, '10:00', 'Fizik')], 'TYT Matematik')).toBe(false);
  });
});
