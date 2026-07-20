import { describe, it, expect } from 'vitest';
import {
  isoWeekKeyTSI, slotStartTSI, nearestFutureActiveWeek, classifyReservation, validateSablon,
} from './etut-migration-lib.mjs';

// Sabit "şimdi": Çarşamba 2026-07-22 10:00 TSİ (W30 içi; Pzt 20 Tem geçmiş)
const NOW = new Date('2026-07-22T10:00:00+03:00');
const sb = (over = {}) => ({ id: 'x', dayIndex: 0, start: '15:30', end: '16:00', ...over });

describe('isoWeekKeyTSI', () => {
  it('Çarşamba 22 Tem 2026 → 2026-W30', () => {
    expect(isoWeekKeyTSI(NOW)).toBe('2026-W30');
  });
  it('Pazar 19 Tem 2026 → 2026-W29 (Pazar haftanın SON günü)', () => {
    expect(isoWeekKeyTSI(new Date('2026-07-19T16:00:00+03:00'))).toBe('2026-W29');
  });
  it('TSİ gece yarısı sınırı: Pzt 00:30 TSİ (UTC hâlâ Pazar) → YENİ hafta', () => {
    expect(isoWeekKeyTSI(new Date('2026-07-20T00:30:00+03:00'))).toBe('2026-W30');
  });
});

describe('slotStartTSI', () => {
  it('W30 Pzt 15:30 = 2026-07-20T15:30+03', () => {
    expect(slotStartTSI('2026-W30', 0, '15:30').toISOString()).toBe('2026-07-20T12:30:00.000Z');
  });
  it('W30 Pazar 10:00 = 2026-07-26T10:00+03', () => {
    expect(slotStartTSI('2026-W30', 6, '10:00').toISOString()).toBe('2026-07-26T07:00:00.000Z');
  });
});

describe('nearestFutureActiveWeek', () => {
  it('bu haftanın günü GEÇMİŞSE → sonraki hafta (Pzt slotu, Çarşamba günü) → W31', () => {
    expect(nearestFutureActiveWeek(sb(), NOW)).toBe('2026-W31');
  });
  it('bu haftanın günü GELECEKSE → bu hafta (Cuma slotu) → W30', () => {
    expect(nearestFutureActiveWeek(sb({ dayIndex: 4 }), NOW)).toBe('2026-W30');
  });
  it('pasifHaftalar atlanır: Cuma slotu W30 pasif → W31', () => {
    expect(nearestFutureActiveWeek(sb({ dayIndex: 4, pasifHaftalar: ['2026-W30'] }), NOW)).toBe('2026-W31');
  });
  it('kalıcı pasif (aktif=false) → null', () => {
    expect(nearestFutureActiveWeek(sb({ aktif: false }), NOW)).toBeNull();
  });
  it('horizon içindeki tüm haftalar pasifse → null', () => {
    const pasif = ['2026-W30','2026-W31','2026-W32','2026-W33','2026-W34','2026-W35','2026-W36','2026-W37','2026-W38'];
    expect(nearestFutureActiveWeek(sb({ dayIndex: 4, pasifHaftalar: pasif }), NOW)).toBeNull();
  });
});

describe('classifyReservation', () => {
  it('studentId yok → none', () => {
    expect(classifyReservation(sb(), NOW)).toEqual({ action: 'none' });
  });
  it('studentId var + gelecek hafta bulunur → migrate (TEK-HAFTA; bookedBy=director bile RECURRING YAPMAZ)', () => {
    expect(classifyReservation(sb({ studentId: 's1', bookedBy: 'director' }), NOW))
      .toEqual({ action: 'migrate', weekKey: '2026-W31' });
  });
  it('studentId var + aktif hafta yok → unresolved', () => {
    const r = classifyReservation(sb({ studentId: 's1', aktif: false }), NOW);
    expect(r.action).toBe('unresolved');
    expect(r.reason).toContain('aktif');
  });
});

describe('validateSablon', () => {
  it('geçerli şablon → ok:true', () => {
    expect(validateSablon(sb())).toEqual({ ok: true });
  });
  it('null → ok:false', () => {
    expect(validateSablon(null).ok).toBe(false);
  });
  it('dayIndex 7 → ok:false', () => {
    expect(validateSablon(sb({ dayIndex: 7 })).ok).toBe(false);
  });
  it('dayIndex NaN → ok:false', () => {
    expect(validateSablon(sb({ dayIndex: NaN })).ok).toBe(false);
  });
  it("start '9:00' (regex fail) → ok:false", () => {
    expect(validateSablon(sb({ start: '9:00' })).ok).toBe(false);
  });
  it('end==start → ok:false', () => {
    expect(validateSablon(sb({ start: '15:30', end: '15:30' })).ok).toBe(false);
  });
  it("start '25:99' (invalid hour/minute) → ok:false", () => {
    expect(validateSablon(sb({ start: '25:99' })).ok).toBe(false);
  });
});

// ---- Faz 5 reconcile karar çekirdeği ----
import { reconcileSablonDeletes, reconcileReservationOps } from './etut-migration-lib.mjs';

describe('reconcileSablonDeletes', () => {
  const tRow = (legacyId, deletedAt = null) => ({ legacyId, deletedAt });
  it('JSON\'da olmayan ACTIVE tablo şablonu → soft-delete adayı', () => {
    expect(reconcileSablonDeletes(['a'], [tRow('a'), tRow('b')])).toEqual(['b']);
  });
  it('zaten soft-deleted satır tekrar aday OLMAZ (idempotent)', () => {
    expect(reconcileSablonDeletes(['a'], [tRow('b', new Date())])).toEqual([]);
  });
  it('JSON boşsa tüm ACTIVE şablonlar aday', () => {
    expect(reconcileSablonDeletes([], [tRow('a'), tRow('b')])).toEqual(['a', 'b']);
  });
});

describe('reconcileReservationOps', () => {
  // NOW: Çarşamba 2026-07-22 10:00 TSİ → currentWeek 2026-W30 (dosya başındaki NOW ile aynı)
  const res = (over = {}) => ({
    weekKey: '2026-W30', status: 'ACTIVE', scope: 'WEEK',
    studentId: 's1', bookedById: 'migration', ...over,
  });
  const sbJson = (over = {}) => ({
    id: 'x', dayIndex: 4, start: '15:30', end: '16:00', // Cuma — NOW'dan ileride
    studentId: 's1', studentName: 'Ali', studentCls: '11', branch: 'Matematik', bookedBy: 'student',
    ...over,
  });

  it('1a: aynı öğrenci ACTIVE gelecek satırda → synced', () => {
    expect(reconcileReservationOps(sbJson(), [res()], NOW)).toEqual([{ op: 'synced', weekKey: '2026-W30' }]);
  });
  it('1b: farklı öğrenci, migration satırı → update (aynı hafta, çift üretme yok)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: 's2', studentName: 'Veli' }), [res()], NOW);
    expect(out).toEqual([{ op: 'update', weekKey: '2026-W30', studentId: 's2', studentName: 'Veli', studentCls: '11', dersBranch: 'Matematik', bookedByRole: 'student' }]);
  });
  it('1c: farklı öğrenci, migration-OLMAYAN satır → conflict (dokunma)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: 's2' }), [res({ bookedById: 'u_99' })], NOW);
    expect(out).toEqual([{ op: 'conflict', weekKey: '2026-W30', tableStudentId: 's1' }]);
  });
  it('1d: hiç gelecek satır yok → create (classifyReservation hedefi)', () => {
    const out = reconcileReservationOps(sbJson(), [], NOW);
    expect(out).toEqual([{ op: 'create', weekKey: '2026-W30' }]); // Cuma slotu NOW'dan ileride → W30
  });
  it('1d-unresolved: tüm hedefler geçmişte → unresolved', () => {
    const out = reconcileReservationOps(sbJson({ aktif: false }), [], NOW);
    expect(out).toEqual([{ op: 'unresolved', reason: expect.stringContaining('aktif=false') }]);
  });
  it('1e: hedef haftada CANCELLED satır → conflict-cancelled (post-deploy iptali ezme)', () => {
    const out = reconcileReservationOps(sbJson(), [res({ status: 'CANCELLED', bookedById: 'u_5' })], NOW);
    expect(out).toEqual([{ op: 'conflict-cancelled', weekKey: '2026-W30' }]);
  });
  it('2a: JSON öğrencisiz, migration ACTIVE gelecek satırlar → cancel', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res(), res({ weekKey: '2026-W31' })], NOW);
    expect(out).toEqual([{ op: 'cancel', weekKeys: ['2026-W30', '2026-W31'] }]);
  });
  it('2b: JSON öğrencisiz, migration-olmayan ACTIVE satır → tableOnly (dokunma)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ bookedById: 'u_7' })], NOW);
    expect(out).toEqual([{ op: 'tableOnly', weekKeys: ['2026-W30'] }]);
  });
  it('2c: JSON öğrencisiz, tablo da boş → none', () => {
    expect(reconcileReservationOps(sbJson({ studentId: null }), [], NOW)).toEqual([{ op: 'none' }]);
  });
  it('RECURRING satırlar karara girmez, recurring raporu döner', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ scope: 'RECURRING', weekKey: '*', bookedById: 'u_1' })], NOW);
    expect(out).toEqual([{ op: 'recurringPresent', count: 1 }, { op: 'none' }]);
  });
  it('geçmiş hafta satırı (W29) karara girmez', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ weekKey: '2026-W29' })], NOW);
    expect(out).toEqual([{ op: 'none' }]);
  });
  it('CANCELLED gelecek satır 2a cancel listesine GİRMEZ (idempotent ikinci koşu)', () => {
    const out = reconcileReservationOps(sbJson({ studentId: null }), [res({ status: 'CANCELLED' })], NOW);
    expect(out).toEqual([{ op: 'none' }]);
  });
  it('FIX-C: create hedefi + table-first RECURRING varsa → conflict-recurring (gölgeleme yok)', () => {
    const out = reconcileReservationOps(sbJson(), [res({ scope: 'RECURRING', weekKey: '*', bookedById: 'u_1' })], NOW);
    expect(out).toEqual([{ op: 'recurringPresent', count: 1 }, { op: 'conflict-recurring', weekKey: '2026-W30' }]);
  });
});
