import { describe, it, expect } from 'vitest';
import {
  getWeekKey,
  weekRangeLabel,
  classToGroup,
  classLabel,
  allowedBranchesForClass,
  colKeyForClass,
  branchesForGroup,
  branchesForGroups,
  slotsForDay,
  MATH_FAMILY,
  STUDENT_GROUPS,
} from './constants.js';

describe('getWeekKey (ISO-8601 hafta no)', () => {
  it('bilinen tarihleri doğru haftaya eşler', () => {
    expect(getWeekKey(new Date('2026-05-25T12:00:00'))).toBe('2026-W22');
    expect(getWeekKey(new Date('2026-01-01T12:00:00'))).toBe('2026-W01');
    // ISO haftası yıl sınırını aşar: 29 Aralık 2025 → 2026-W01
    expect(getWeekKey(new Date('2025-12-29T12:00:00'))).toBe('2026-W01');
  });
});

describe('weekRangeLabel', () => {
  it('weekKey → okunabilir Türkçe tarih aralığı', () => {
    expect(weekRangeLabel('2026-W22')).toEqual({ startStr: '25 Mayıs', endStr: '31 Mayıs', yearStr: 2026 });
  });
  it('geçersiz girdide boş döner (NaN sızdırmaz)', () => {
    expect(weekRangeLabel('garbage')).toEqual({ startStr: '', endStr: '', yearStr: '' });
    expect(weekRangeLabel('')).toEqual({ startStr: '', endStr: '', yearStr: '' });
    expect(weekRangeLabel(null)).toEqual({ startStr: '', endStr: '', yearStr: '' });
  });
});

describe('classToGroup', () => {
  it('sınıfı doğru gruba eşler', () => {
    expect(classToGroup('701')).toBe('ortaokul');
    expect(classToGroup('301')).toBe('lise');
    expect(classToGroup('m3')).toBe('mezun');
  });
  it('bilinmeyen sınıf → null', () => {
    expect(classToGroup('999')).toBeNull();
    expect(classToGroup('')).toBeNull();
  });
});

describe('classLabel', () => {
  it('11 ve 12. sınıfta Sayısal/EA ayrımı yapar', () => {
    expect(classLabel('301')).toBe('11.Sınıf Sayısal (301)');
    expect(classLabel('304')).toBe('11.Sınıf EA (304)');
    expect(classLabel('401')).toBe('12.Sınıf Sayısal (401)');
    expect(classLabel('406')).toBe('12.Sınıf EA (406)');
  });
  it('mezun sınıflarını etiketler', () => {
    expect(classLabel('m1')).toBe('Mezun Sayısal (M1)');
    expect(classLabel('m6')).toBe('Mezun EA (M6)');
  });
});

describe('colKeyForClass', () => {
  it('sınıfı ders yükü sütununa eşler', () => {
    expect(colKeyForClass('301')).toBe('Lise Sayısal_11');
    expect(colKeyForClass('304')).toBe('Lise Eşit Ağırlık_11');
    expect(colKeyForClass('401')).toBe('Lise Sayısal_12');
    expect(colKeyForClass('m1')).toBe('Mezun Sayısal');
    expect(colKeyForClass('m6')).toBe('Mezun Eşit Ağırlık');
  });
  it('boş/bilinmeyen → Lise Ortak_9 fallback', () => {
    expect(colKeyForClass('')).toBe('Lise Ortak_9');
    expect(colKeyForClass(null)).toBe('Lise Ortak_9');
  });
});

describe('allowedBranchesForClass', () => {
  it('12. sınıf sayısal matematik ailesini içerir', () => {
    const b = allowedBranchesForClass('401');
    expect(b).toContain('TYT Matematik');
    expect(b).toContain('AYT Matematik');
    expect(b).toContain('Geometri');
    expect(b).not.toContain('Matematik'); // 12'de düz Matematik yok
  });
  it('ortaokul düz Matematik görür, TYT/AYT görmez', () => {
    const b = allowedBranchesForClass('701');
    expect(b).toContain('Matematik');
    expect(b).not.toContain('TYT Matematik');
  });
  it('boş sınıf → boş dizi', () => {
    expect(allowedBranchesForClass('')).toEqual([]);
  });
});

describe('branchesForGroup / branchesForGroups', () => {
  it('grup branşlarını döner', () => {
    expect(branchesForGroup('ortaokul')).toContain('Fen Bilgisi');
    expect(branchesForGroup('bilinmeyen')).toEqual([]);
  });
  it('birden çok grubu dedup ederek birleştirir', () => {
    const merged = branchesForGroups(['lise', 'mezun']);
    expect(merged.length).toBe(new Set(merged).size); // tekrar yok
    expect(merged).toContain('TYT Matematik');
  });
});

describe('slotsForDay', () => {
  it('hafta içi w-slotları, hafta sonu e-slotları döner (12şer)', () => {
    expect(slotsForDay(0)).toHaveLength(12);
    expect(slotsForDay(5)).toHaveLength(12);
    expect(slotsForDay(0)[0].id).toBe('w1');
    expect(slotsForDay(5)[0].id).toBe('e1');
  });
});

describe('sabitler (regresyon kilidi)', () => {
  it('MATH_FAMILY tam olarak 3 matematik dersi', () => {
    expect(MATH_FAMILY).toEqual(['TYT Matematik', 'AYT Matematik', 'Geometri']);
  });
  it('STUDENT_GROUPS sınıf sayıları', () => {
    expect(STUDENT_GROUPS.ortaokul.classes).toHaveLength(4);
    expect(STUDENT_GROUPS.lise.classes).toHaveLength(20);
    expect(STUDENT_GROUPS.mezun.classes).toHaveLength(10);
  });
});
