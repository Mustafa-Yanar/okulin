import { describe, it, expect } from 'vitest';
import { currentWeekKeyTSI, shiftWeekKey, allowedBookingWeeks, isValidWeekKey, shouldRollWeek, retentionCutoffWeekKey } from './weeks';

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

describe('isValidWeekKey — ISO-8601 hafta biçimi (Faz 2 audit-fix FIX-C)', () => {
  it('geçerli haftalar (W01, W30, W53) → true', () => {
    expect(isValidWeekKey('2026-W01')).toBe(true);
    expect(isValidWeekKey('2026-W30')).toBe(true);
    expect(isValidWeekKey('2026-W53')).toBe(true);
  });
  it('W00 → false (ISO hafta 1den başlar)', () => {
    expect(isValidWeekKey('2026-W00')).toBe(false);
  });
  it('W99 / W54 → false (ölü-seri riski — effectiveFromWeek asla erişilemez olurdu)', () => {
    expect(isValidWeekKey('2026-W99')).toBe(false);
    expect(isValidWeekKey('2026-W54')).toBe(false);
  });
  it('bozuk biçim (kısa yıl, harf, boş) → false', () => {
    expect(isValidWeekKey('26-W01')).toBe(false);
    expect(isValidWeekKey('2026-W3')).toBe(false);
    expect(isValidWeekKey('abc')).toBe(false);
    expect(isValidWeekKey('')).toBe(false);
  });
});

describe('shouldRollWeek — rollover idempotency guard (Faz 4 FIX-1, Codex kritik)', () => {
  it('stored === actual → true (normal devir)', () => {
    expect(shouldRollWeek('2026-W30', '2026-W30')).toBe(true);
  });
  it('stored geride (< actual) → true (kaçırılmış hafta telafisi)', () => {
    expect(shouldRollWeek('2026-W29', '2026-W30')).toBe(true);
  });
  it('stored 1 ileri (> actual) → false (devir zaten yapılmış, çifte tetik)', () => {
    expect(shouldRollWeek('2026-W31', '2026-W30')).toBe(false);
  });
  it('yıl sınırı: stored 2027-W01, actual 2026-W53 → false (ileride, string kıyası doğru)', () => {
    expect(shouldRollWeek('2027-W01', '2026-W53')).toBe(false);
  });
  it('yıl sınırı: stored 2026-W53, actual 2027-W01 → true (geride)', () => {
    expect(shouldRollWeek('2026-W53', '2027-W01')).toBe(true);
  });
});

// Denetim B11: SlotBooking her hafta birikiyor, hiç silinmiyordu. Cleanup cron'u
// `weekKey: { lt: retentionCutoffWeekKey(61) }` ile siler — zaman boyutu Date değil
// hafta anahtarı olduğu için cutoff(days) kullanılamaz.
describe('retentionCutoffWeekKey — hafta-anahtarı saklama sınırı (B11)', () => {
  const NOW = new Date('2026-07-22T10:00:00+03:00'); // 2026-W30

  it('14 ay (61 hafta) geriye → 2025-W21', () => {
    expect(retentionCutoffWeekKey(61, NOW)).toBe('2025-W21');
  });
  it('52 hafta geriye tam bir yıl önceki aynı hafta → 2025-W30', () => {
    expect(retentionCutoffWeekKey(52, NOW)).toBe('2025-W30');
  });
  it('sınır DAHİL tutulur: cutoff haftası `lt` kıyasında silinmez, bir öncesi silinir', () => {
    const c = retentionCutoffWeekKey(61, NOW);
    expect(c < c).toBe(false);                             // cutoff haftasının kendisi kalır
    expect(retentionCutoffWeekKey(62, NOW) < c).toBe(true); // bir hafta eskisi silinir
  });
  it('güncel hafta ve cari veri ASLA silinmez (cutoff geçmişte kalır)', () => {
    const c = retentionCutoffWeekKey(61, NOW);
    expect(currentWeekKeyTSI(NOW) < c).toBe(false);
    expect(shiftWeekKey(currentWeekKeyTSI(NOW), -60) < c).toBe(false);
  });
  it('yıl sınırını doğru aşar: 2027-W02 anından 61 hafta geriye → 2025-W46', () => {
    expect(retentionCutoffWeekKey(61, new Date('2027-01-13T10:00:00+03:00'))).toBe('2025-W46');
  });
  it('yılın İLK haftasından (2026-W01) geriye iki yıl önceye taşar → 2024-W44', () => {
    expect(retentionCutoffWeekKey(61, new Date('2026-01-01T10:00:00+03:00'))).toBe('2024-W44');
  });
  it('53 haftalı yılın SON haftasından (2026-W53) → 2025-W44', () => {
    const end2026 = new Date('2026-12-31T10:00:00+03:00');
    expect(currentWeekKeyTSI(end2026)).toBe('2026-W53'); // 2026 ISO'da 53 haftalı
    expect(retentionCutoffWeekKey(61, end2026)).toBe('2025-W44');
  });
  it('üretilen anahtar geçerli ISO biçimde (string `lt` kıyası kronolojik kalsın)', () => {
    expect(isValidWeekKey(retentionCutoffWeekKey(61, NOW))).toBe(true);
  });
  // 5 haneli yıl retention'ın sıralama invaryantını bozardı ('10000-W02' < '2025-W01').
  // isValidWeekKey bunu reddeder; admin/week advanceWeek ürettiği anahtarı bu yüzden doğrular.
  it('5 haneli yıl geçersiz — sıralama invaryantını koruyan kapı', () => {
    expect(isValidWeekKey('10000-W02')).toBe(false);
    expect('10000-W02' < '2025-W01').toBe(true); // biçim doğrulanmasaydı ASLA silinmezdi
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
