import { describe, it, expect } from 'vitest';
import type { EtutSablon, EtutReservation } from '@prisma/client';
import { timeConflicts, branchConflicts, mathFamilyConflict, pickAllowedBranches, buildEtutAllList } from './rezervasyon';

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

describe('pickAllowedBranches — öğrencinin izinli dersleri (registry-öncelikli)', () => {
  it('registry dersleri varsa onları kullanır (özel şube s_UUID regresyonu)', () => {
    // s_UUID cls: constants colKeyForClass parseInt→NaN ile yanlış "Lise Ortak_9"a düşerdi;
    // registry dersleri kullanılınca 'TYT Matematik' geçerli kalır → "Geçersiz ders" hatası olmaz.
    const registry = ['TYT Matematik', 'Geometri', 'Fizik'];
    expect(pickAllowedBranches(registry, 's_14ca08ac-61a9-42b4-9e31-96ab67175758')).toEqual(registry);
    expect(pickAllowedBranches(registry, 's_14ca08ac-61a9-42b4-9e31-96ab67175758')).toContain('TYT Matematik');
  });
  it('registry boş/yoksa constants fallback (legacy sayısal sınıf)', () => {
    const out = pickAllowedBranches([], '401');
    expect(out).toContain('TYT Matematik'); // COL_COURSES Lise Sayısal_12
    expect(pickAllowedBranches(null, '401')).toEqual(out);
  });
  it('registry de constants da yoksa boş', () => {
    expect(pickAllowedBranches(null, null)).toEqual([]);
  });
});

describe('buildEtutAllList', () => {
  const T = [{ id: 't1', name: 'Ali Hoca', branches: ['Fizik'], allowedGroups: ['lise'] }];
  const sb = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cuid1', legacyId: 'e1', teacherId: 't1', dayIndex: 1, start: '14:00', end: '15:00',
    aktif: true, pasifHaftalar: [] as string[], deletedAt: null, ...over,
  }) as unknown as EtutSablon;
  const rez = (over: Partial<Record<string, unknown>> = {}) => ({
    sablonId: 'cuid1', scope: 'WEEK', status: 'ACTIVE', weekKey: '2026-W30',
    studentId: 's1', studentName: 'İrem', studentCls: '11A', dersBranch: 'Fizik', bookedByRole: 'student',
    ...over,
  }) as unknown as EtutReservation;

  it('boş rezervasyon → booked:false, studentName:null, scope:null', () => {
    const out = buildEtutAllList([sb()], T, new Map(), '2026-W30');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'e1', booked: false, studentId: null, scope: null, teacherName: 'Ali Hoca', dayLabel: 'Salı' });
  });
  it('efektif WEEK rezervasyon → alanlar dolu + scope:WEEK', () => {
    const out = buildEtutAllList([sb()], T, new Map([['cuid1', rez()]]), '2026-W30');
    expect(out[0]).toMatchObject({ booked: true, studentId: 's1', studentName: 'İrem', studentCls: '11A', branch: 'Fizik', bookedBy: 'student', scope: 'WEEK' });
  });
  it('RECURRING efektif → scope:RECURRING', () => {
    const out = buildEtutAllList([sb()], T, new Map([['cuid1', rez({ scope: 'RECURRING', weekKey: '*', bookedByRole: 'director' })]]), '2026-W30');
    expect(out[0]).toMatchObject({ scope: 'RECURRING', bookedBy: 'director' });
  });
  it('o hafta pasif şablon listelenmez (pasifHaftalar)', () => {
    expect(buildEtutAllList([sb({ pasifHaftalar: ['2026-W30'] })], T, new Map(), '2026-W30')).toHaveLength(0);
  });
  it('kalıcı pasif şablon listelenmez (aktif:false)', () => {
    expect(buildEtutAllList([sb({ aktif: false })], T, new Map(), '2026-W30')).toHaveLength(0);
  });
  it('öğretmeni silinmiş/yok şablon atlanır', () => {
    expect(buildEtutAllList([sb({ teacherId: 'yok' })], T, new Map(), '2026-W30')).toHaveLength(0);
  });
  it('gün+saat sıralı döner', () => {
    const rows = [sb({ id: 'c2', legacyId: 'e2', dayIndex: 0, start: '16:00' }), sb({ id: 'c3', legacyId: 'e3', dayIndex: 0, start: '09:00' }), sb()];
    const out = buildEtutAllList(rows, T, new Map(), '2026-W30');
    expect(out.map(r => r.id)).toEqual(['e3', 'e2', 'e1']);
  });
});
