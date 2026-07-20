import { describe, it, expect } from 'vitest';
import { currentWeekKeyTSI, shiftWeekKey, allowedBookingWeeks } from './weeks';

// Referans: Pzt 20 Tem 2026 = 2026-W30 başlangıcı; Pazar 19 Tem = W29'un son günü.
describe('currentWeekKeyTSI — sunucu-UTC bağımsız TSİ haftası', () => {
  it('Çarşamba 22 Tem 10:00 TSİ → W30', () => {
    expect(currentWeekKeyTSI(new Date('2026-07-22T10:00:00+03:00'))).toBe('2026-W30');
  });
  it('Pazar 19 Tem 16:00 TSİ → W29 (Pazar haftanın SON günü)', () => {
    expect(currentWeekKeyTSI(new Date('2026-07-19T16:00:00+03:00'))).toBe('2026-W29');
  });
  it('KRİTİK sınır: Pzt 00:30 TSİ = Pazar 21:30 UTC → YENİ hafta W30 (sunucu-yerel getWeekKey burada yanılır)', () => {
    expect(currentWeekKeyTSI(new Date('2026-07-20T00:30:00+03:00'))).toBe('2026-W30');
  });
});

describe('shiftWeekKey', () => {
  it('W30 +1 → W31; W30 -1 → W29', () => {
    expect(shiftWeekKey('2026-W30', 1)).toBe('2026-W31');
    expect(shiftWeekKey('2026-W30', -1)).toBe('2026-W29');
  });
  it('yıl sınırı: 2026-W53 +1 → 2027-W01', () => {
    expect(shiftWeekKey('2026-W53', 1)).toBe('2027-W01');
  });
});

describe('allowedBookingWeeks — Pazar 11:00 TSİ açılma kuralı', () => {
  it('öğrenci, Çarşamba → sadece bu hafta', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-22T10:00:00+03:00'))).toEqual(['2026-W30']);
  });
  it('öğrenci, Pazar 10:59 TSİ → sonraki hafta HENÜZ KAPALI', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-19T10:59:00+03:00'))).toEqual(['2026-W29']);
  });
  it('öğrenci, Pazar 11:00 TSİ → sonraki hafta AÇILDI', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-19T11:00:00+03:00'))).toEqual(['2026-W29', '2026-W30']);
  });
  it('öğrenci, Pazar 23:30 → hâlâ açık', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-19T23:30:00+03:00'))).toEqual(['2026-W29', '2026-W30']);
  });
  it('öğrenci, Pzt 00:30 TSİ → pencere yeni haftaya SIFIRLANDI (tek hafta)', () => {
    expect(allowedBookingWeeks('student', new Date('2026-07-20T00:30:00+03:00'))).toEqual(['2026-W30']);
  });
  it('öğretmen = öğrenciyle aynı pencere', () => {
    expect(allowedBookingWeeks('teacher', new Date('2026-07-19T11:00:00+03:00'))).toEqual(['2026-W29', '2026-W30']);
  });
  it('müdür/rehber → cur..+2 (saatten bağımsız)', () => {
    expect(allowedBookingWeeks('director', new Date('2026-07-22T10:00:00+03:00'))).toEqual(['2026-W30', '2026-W31', '2026-W32']);
    expect(allowedBookingWeeks('counselor', new Date('2026-07-22T10:00:00+03:00'))).toEqual(['2026-W30', '2026-W31', '2026-W32']);
  });
});
