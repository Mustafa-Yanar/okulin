import { describe, it, expect } from 'vitest';
import { decideBooking, type BookingContext } from './booking-rules';
import type { NormalizedBooking } from './overlap';

// Sabit referans zamanlar — TSİ hafta hesabından bağımsız, sade karşılaştırma.
const NOW = new Date('2026-07-20T10:00:00.000Z');
const PAST = new Date('2026-07-20T09:00:00.000Z');
const FUTURE = new Date('2026-07-21T10:00:00.000Z');
const WK = '2026-W30';

// Her alanı geçerli varsayılanlı ctx üretici — testler yalnız ilgili alanı override eder.
// Varsayılan: WEEK scope, öğrenci, tüm kurallardan geçen "mutlu yol" (ok:true) senaryosu.
function mk(overrides: Partial<BookingContext> = {}): BookingContext {
  return {
    actor: { role: 'student', id: 'stu-1', isManager: false, readOnlyCounselor: false },
    scope: 'WEEK',
    weekKey: WK,
    allowedWeeks: [WK],
    slotStartsAt: FUTURE,
    now: NOW,
    sablon: { aktif: true, pasifHaftalar: [], deletedAt: null },
    teacher: { legacyId: 'teacher-1', branches: ['Matematik'], allowedGroups: ['lise'] },
    student: { id: 'stu-1', group: 'lise' },
    levelPool: ['Matematik', 'Fizik'],
    dersBranch: 'Matematik',
    currentEffective: null,
    otherBookings: [],
    candidate: { dayIndex: 1, startMin: 600, endMin: 660 },
    weeklyCount: 0,
    maxWeeklyPerStudent: null,
    studentSelfBookingEnabled: true,
    force: undefined,
    ...overrides,
  };
}

const booking = (over: Partial<NormalizedBooking> = {}): NormalizedBooking => ({
  dayIndex: 1, startMin: 600, endMin: 660, dersBranch: 'Matematik', source: 'etut', ...over,
});

describe('mutlu yol', () => {
  it('varsayılan ctx → ok', () => {
    expect(decideBooking(mk())).toEqual({ ok: true });
  });
});

describe('Kural 1: salt-okunur rehber', () => {
  it('readOnlyCounselor → 403 Salt-okunur rehber etüt rezervasyonu yapamaz', () => {
    const res = decideBooking(mk({ actor: { role: 'counselor', id: 'c-1', isManager: true, readOnlyCounselor: true } }));
    expect(res).toEqual({ error: 'Salt-okunur rehber etüt rezervasyonu yapamaz', status: 403 });
  });
});

describe('Kural 2: RECURRING yalnız müdür/rehber', () => {
  it('öğrenci RECURRING isteyemez → 403', () => {
    const res = decideBooking(mk({ scope: 'RECURRING' }));
    expect(res).toEqual({ error: 'Tekrarlayan atama yalnız müdür/rehber tarafından yapılabilir', status: 403 });
  });
  it('öğretmen RECURRING isteyemez → 403', () => {
    const res = decideBooking(mk({
      scope: 'RECURRING',
      actor: { role: 'teacher', id: 'teacher-1', isManager: false, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ error: 'Tekrarlayan atama yalnız müdür/rehber tarafından yapılabilir', status: 403 });
  });
  it('müdür RECURRING isteyebilir → ok', () => {
    const res = decideBooking(mk({
      scope: 'RECURRING',
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 3: öğrenci self-booking (app/api/slots/route.ts POST metniyle birebir)', () => {
  it('kapalıysa → 403 Etüt rezervasyonu kurum tarafından kapatılmış. Lütfen öğretmeninize başvurun.', () => {
    const res = decideBooking(mk({ studentSelfBookingEnabled: false }));
    expect(res).toEqual({ error: 'Etüt rezervasyonu kurum tarafından kapatılmış. Lütfen öğretmeninize başvurun.', status: 403 });
  });
  it('öğretmen/müdür self-booking kapalı olsa da muaf (rol student değil)', () => {
    const res = decideBooking(mk({
      studentSelfBookingEnabled: false,
      actor: { role: 'teacher', id: 'teacher-1', isManager: false, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 4: hafta penceresi (YENİ)', () => {
  it('pencere dışı hafta (öğrenci, W31 kapalıyken) → 403 Bu hafta için rezervasyon henüz açık değil', () => {
    const res = decideBooking(mk({ weekKey: '2026-W31', allowedWeeks: [WK] }));
    expect(res).toEqual({ error: 'Bu hafta için rezervasyon henüz açık değil', status: 403 });
  });
  it('müdür penceresi: cur..+2 içinde → ok', () => {
    const res = decideBooking(mk({
      weekKey: '2026-W32',
      allowedWeeks: ['2026-W30', '2026-W31', '2026-W32'],
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
  it('müdür penceresi: dışında → 403', () => {
    const res = decideBooking(mk({
      weekKey: '2026-W33',
      allowedWeeks: ['2026-W30', '2026-W31', '2026-W32'],
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ error: 'Bu hafta için rezervasyon henüz açık değil', status: 403 });
  });
  it('RECURRING scope pencere kontrolünden muaf (weekKey allowedWeeks dışında olsa da müdür geçer)', () => {
    const res = decideBooking(mk({
      scope: 'RECURRING',
      weekKey: '2099-W01',
      allowedWeeks: [WK],
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 5: şablon/öğretmen/öğrenci varlık+aktiflik (lib/etut/rezervasyon.ts reserveEtut metniyle birebir)', () => {
  it('sablon yok → 404 Etüt bulunamadı', () => {
    expect(decideBooking(mk({ sablon: null }))).toEqual({ error: 'Etüt bulunamadı', status: 404 });
  });
  it('sablon silinmiş (deletedAt) → 404 Etüt bulunamadı', () => {
    const res = decideBooking(mk({ sablon: { aktif: true, pasifHaftalar: [], deletedAt: new Date() } }));
    expect(res).toEqual({ error: 'Etüt bulunamadı', status: 404 });
  });
  it('sablon.aktif === false → 400 Bu etüt bu hafta aktif değil', () => {
    const res = decideBooking(mk({ sablon: { aktif: false, pasifHaftalar: [], deletedAt: null } }));
    expect(res).toEqual({ error: 'Bu etüt bu hafta aktif değil', status: 400 });
  });
  it('sablon.pasifHaftalar bu haftayı içeriyor → aynı 400 metni', () => {
    const res = decideBooking(mk({ sablon: { aktif: true, pasifHaftalar: [WK], deletedAt: null } }));
    expect(res).toEqual({ error: 'Bu etüt bu hafta aktif değil', status: 400 });
  });
  it('öğretmen yok → 404 Öğretmen bulunamadı', () => {
    expect(decideBooking(mk({ teacher: null }))).toEqual({ error: 'Öğretmen bulunamadı', status: 404 });
  });
  it('öğrenci yok → 404 Öğrenci bulunamadı', () => {
    expect(decideBooking(mk({ student: null }))).toEqual({ error: 'Öğrenci bulunamadı', status: 404 });
  });
});

describe('Kural 6: geçmiş slot (WEEK; lib/etut/rezervasyon.ts metniyle birebir)', () => {
  it('slotStartsAt <= now → 400 Geçmiş bir etüde rezervasyon yapılamaz', () => {
    const res = decideBooking(mk({ slotStartsAt: PAST }));
    expect(res).toEqual({ error: 'Geçmiş bir etüde rezervasyon yapılamaz', status: 400 });
  });
  it('RECURRING geçmiş-slot kontrolünden muaf', () => {
    const res = decideBooking(mk({
      scope: 'RECURRING',
      slotStartsAt: PAST,
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 7: grup (lib/etut/rezervasyon.ts metniyle birebir)', () => {
  it('öğretmenin grup etiketi yok → 400 Bu öğretmenin grup etiketi tanımlanmamış', () => {
    const res = decideBooking(mk({ teacher: { legacyId: 'teacher-1', branches: ['Matematik'], allowedGroups: [] } }));
    expect(res).toEqual({ error: 'Bu öğretmenin grup etiketi tanımlanmamış', status: 400 });
  });
  it('öğrenci grup dışı → 400 Bu öğrenci bu öğretmenin etütlerine kayıt olamaz', () => {
    const res = decideBooking(mk({ student: { id: 'stu-1', group: 'ortaokul' } }));
    expect(res).toEqual({ error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz', status: 400 });
  });
});

describe('Kural 8: ders — öğretmen branşı ∩ düzey havuzu (§4a; lib/etut/rezervasyon.ts metniyle birebir)', () => {
  const DENY = { error: 'Geçersiz veya seçilmemiş ders. Uygun bir ders seçin.', status: 400 };
  it('dersBranch belirtilmemiş → 400', () => {
    expect(decideBooking(mk({ dersBranch: undefined }))).toEqual(DENY);
  });
  it('ders öğretmen branşında yok → 400', () => {
    const res = decideBooking(mk({ dersBranch: 'Fizik', teacher: { legacyId: 'teacher-1', branches: ['Matematik'], allowedGroups: ['lise'] } }));
    expect(res).toEqual(DENY);
  });
  it('ders düzey havuzunda yok (lise → İnkılap) → aynı 400 metni', () => {
    const res = decideBooking(mk({
      dersBranch: 'İnkılap',
      teacher: { legacyId: 'teacher-1', branches: ['Matematik', 'İnkılap'], allowedGroups: ['lise'] },
      levelPool: ['Matematik', 'Fizik'], // lise havuzunda İnkılap yok
    }));
    expect(res).toEqual(DENY);
  });
  it('düzey havuzunda olan sınıf-dışı ders → ok (§4a: sınıf listesiyle sınırlı değil)', () => {
    const res = decideBooking(mk({
      dersBranch: 'Fizik',
      teacher: { legacyId: 'teacher-1', branches: ['Matematik', 'Fizik'], allowedGroups: ['lise'] },
      levelPool: ['Matematik', 'Fizik'],
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 9: doluluk (lib/etut/rezervasyon.ts metniyle birebir)', () => {
  it('başka öğrenci dolu → 400 Bu etüt zaten dolu', () => {
    const res = decideBooking(mk({ currentEffective: { studentId: 'stu-2' } }));
    expect(res).toEqual({ error: 'Bu etüt zaten dolu', status: 400 });
  });
  it('aynı öğrenci zaten kayıtlı → 400 Bu öğrenci zaten bu etüde kayıtlı', () => {
    const res = decideBooking(mk({ currentEffective: { studentId: 'stu-1' } }));
    expect(res).toEqual({ error: 'Bu öğrenci zaten bu etüde kayıtlı', status: 400 });
  });
  it('müdür + force bile doluluğu geçemez (force yalnız Kural 10 saat-çakışmasını bypass eder)', () => {
    const res = decideBooking(mk({
      currentEffective: { studentId: 'stu-2' },
      force: true,
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ error: 'Bu etüt zaten dolu', status: 400 });
  });
});

describe('Kural 10: saat çakışması (YENİ mekanik — interval bazlı, eski metin)', () => {
  it('çakışma var → 400 Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı', () => {
    const res = decideBooking(mk({ otherBookings: [booking({ dersBranch: 'Fizik' })] }));
    expect(res).toEqual({ error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı', status: 400 });
  });
  it('müdür force OLMADAN çakışmayı geçemez → aynı 400', () => {
    const res = decideBooking(mk({
      otherBookings: [booking({ dersBranch: 'Fizik' })],
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı', status: 400 });
  });
  it('müdür + force çakışmayı geçer → ok', () => {
    const res = decideBooking(mk({
      otherBookings: [booking({ dersBranch: 'Fizik' })],
      force: true,
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 11: aynı ders / matematik ailesi (yalnız yönetici-olmayan; lib/etut/rezervasyon.ts metniyle birebir)', () => {
  it('aynı ders bu hafta zaten alınmış (öğrenci) → 400', () => {
    const res = decideBooking(mk({ otherBookings: [booking({ dayIndex: 4, dersBranch: 'Matematik' })] }));
    expect(res).toEqual({ error: 'Bu öğrenci bu hafta Matematik dersinden zaten etüt almış', status: 400 });
  });
  it('müdür aynı-ders kuralından muaf → ok', () => {
    const res = decideBooking(mk({
      otherBookings: [booking({ dayIndex: 4, dersBranch: 'Matematik' })],
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
  it('matematik ailesi çakışması (öğrenci) → 400', () => {
    const res = decideBooking(mk({
      dersBranch: 'AYT Matematik',
      teacher: { legacyId: 'teacher-1', branches: ['AYT Matematik'], allowedGroups: ['lise'] },
      levelPool: ['AYT Matematik', 'Geometri'],
      otherBookings: [booking({ dayIndex: 4, dersBranch: 'Geometri' })],
    }));
    expect(res).toEqual({ error: 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış', status: 400 });
  });
  it('müdür matematik ailesi kuralından muaf → ok', () => {
    const res = decideBooking(mk({
      dersBranch: 'AYT Matematik',
      teacher: { legacyId: 'teacher-1', branches: ['AYT Matematik'], allowedGroups: ['lise'] },
      levelPool: ['AYT Matematik', 'Geometri'],
      otherBookings: [booking({ dayIndex: 4, dersBranch: 'Geometri' })],
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
});

describe('Kural 12: haftalık limit (yalnız öğrenci self-booking; app/api/slots/route.ts POST metni+status birebir)', () => {
  it('weeklyCount >= max (öğrenci) → 403 interpolated metin', () => {
    const res = decideBooking(mk({ maxWeeklyPerStudent: 2, weeklyCount: 2 }));
    expect(res).toEqual({ error: 'Bu hafta en fazla 2 etüt alabilirsiniz (2 dolu).', status: 403 });
  });
  it('öğretmen limit kuralından muaf (rol student değil)', () => {
    const res = decideBooking(mk({
      maxWeeklyPerStudent: 2,
      weeklyCount: 5,
      actor: { role: 'teacher', id: 'teacher-1', isManager: false, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
  it('müdür limit kuralından muaf', () => {
    const res = decideBooking(mk({
      maxWeeklyPerStudent: 2,
      weeklyCount: 5,
      actor: { role: 'director', id: 'dir-1', isManager: true, readOnlyCounselor: false },
    }));
    expect(res).toEqual({ ok: true });
  });
  it('maxWeeklyPerStudent null → limitsiz, öğrenci de geçer', () => {
    const res = decideBooking(mk({ maxWeeklyPerStudent: null, weeklyCount: 999 }));
    expect(res).toEqual({ ok: true });
  });
});
