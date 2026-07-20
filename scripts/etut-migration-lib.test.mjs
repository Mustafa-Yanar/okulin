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
