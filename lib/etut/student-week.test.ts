import { describe, it, expect, vi, afterEach } from 'vitest';
import { combineBookings, type SlotRowLike } from './student-week';
import type { NormalizedSlotTimes } from '@/lib/slots';
import type { EtutReservation } from '@prisma/client';

// Test satırı üreticileri — yalnız combineBookings'in okuduğu alanlar anlamlı.
const etutRow = (over: Partial<EtutReservation>): EtutReservation => ({
  id: 'r1', orgSlug: 'o', branch: 'main', sablonId: 's1', teacherId: 't1',
  scope: 'WEEK', status: 'ACTIVE', weekKey: '2026-W30', effectiveFromWeek: null,
  studentId: 'st1', studentName: 'Öğrenci', studentCls: 'c1', dersBranch: 'Fizik',
  bookedByRole: 'student', bookedById: 'st1', bookedAt: new Date(0),
  cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  dayIndex: 0, startsAt: '15:30', endsAt: '16:00', createdAt: new Date(0), updatedAt: new Date(0),
  ...over,
} as EtutReservation);

const slotRow = (over: Partial<SlotRowLike>): SlotRowLike => ({
  dayIndex: 2, slotId: 'd2s2', startsAt: null, endsAt: null, dersBranch: null, data: null,
  ...over,
});

// 2. gün (Çarşamba) için 3 slotluk config — daySlots(2, cfg) → d2s1/d2s2/d2s3.
const slotTimes: NormalizedSlotTimes = {
  days: {
    2: {
      count: 3,
      times: [
        { start: '09:00', end: '09:35' },
        { start: '09:45', end: '10:20' },
        { start: '10:30', end: '11:05' },
      ],
    },
  },
};

describe('combineBookings — etüt+slot birleşimi', () => {
  it('bir etüt + bir slot → iki kayıtlı liste, weeklyCount=2, source doğru', () => {
    const { list, weeklyCount } = combineBookings(
      [etutRow({})],
      [slotRow({ startsAt: '11:00', endsAt: '11:35' })],
      slotTimes,
    );
    expect(weeklyCount).toBe(2);
    expect(list.map((b) => b.source).sort()).toEqual(['etut', 'slot']);
  });

  it('exclude: çağıran taraf sablonId hariç bırakmışsa (etutRows önceden filtrelenmiş) o kayıt listede YOK', () => {
    // studentWeekBookings excludeSablonId'yi EFEKTİF HARİTADA filtreler — combineBookings'e
    // zaten süzülmüş bir liste gelir; burada yalnızca pass-through doğru mu diye bakıyoruz.
    const kept = etutRow({ id: 'r1', sablonId: 's1' });
    // s2 çağıran tarafından dışlandığı için combineBookings'e HİÇ verilmiyor:
    const { list, weeklyCount } = combineBookings([kept], [], slotTimes);
    expect(list).toHaveLength(1);
    expect(list[0].dersBranch).toBe('Fizik');
    expect(weeklyCount).toBe(1);
  });

  it('snapshot-öncelik: startsAt/endsAt DOLU ise slot config yoksayılır', () => {
    const { list } = combineBookings(
      [],
      [slotRow({ dayIndex: 2, slotId: 'd2s2', startsAt: '20:00', endsAt: '20:30' })],
      slotTimes,
    );
    // d2s2'nin config saati 09:45-10:20 — snapshot (20:00-20:30) KAZANMALI.
    expect(list[0].startMin).toBe(20 * 60);
    expect(list[0].endMin).toBe(20 * 60 + 30);
  });

  it('snapshot yok → slot tanımından çözülür (route.ts:155/309 deseni)', () => {
    const { list } = combineBookings([], [slotRow({ dayIndex: 2, slotId: 'd2s2' })], slotTimes);
    expect(list[0].startMin).toBe(9 * 60 + 45);
    expect(list[0].endMin).toBe(10 * 60 + 20);
  });

  it('saati bilinmeyen slot (snapshot yok + config’te yok) → listeden HARİÇ ama weeklyCount’a DAHİL + console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { list, weeklyCount } = combineBookings(
      [],
      [slotRow({ dayIndex: 2, slotId: 'd2s99' })], // config'te yalnız d2s1..d2s3 var
      slotTimes,
    );
    expect(list).toHaveLength(0);
    expect(weeklyCount).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/slot saati çözülemedi/);
    warn.mockRestore();
  });

  it('dakika dönüşümü: etüt "09:05"→545, slot config "10:30"→630 (toMin doğru uygulanıyor)', () => {
    const { list } = combineBookings(
      [etutRow({ dayIndex: 1, startsAt: '09:05', endsAt: '09:40' })],
      [slotRow({ dayIndex: 2, slotId: 'd2s3' })],
      slotTimes,
    );
    const etut = list.find((b) => b.source === 'etut')!;
    const slot = list.find((b) => b.source === 'slot')!;
    expect(etut.startMin).toBe(545);
    expect(slot.startMin).toBe(630);
    expect(slot.endMin).toBe(665);
  });

  it('dersBranch: slot data.branch VARSA dersBranch kolonunu EZER (route.ts:230 önceliği)', () => {
    const { list } = combineBookings(
      [],
      [slotRow({ dersBranch: 'Fizik', data: { branch: 'Kimya' } })],
      slotTimes,
    );
    expect(list[0].dersBranch).toBe('Kimya');
  });

  it('dersBranch: data yoksa/branch’siz ise dersBranch kolonuna düşer', () => {
    const { list } = combineBookings(
      [],
      [slotRow({ dersBranch: 'Fizik', data: null }), slotRow({ dayIndex: 2, slotId: 'd2s3', dersBranch: 'Kimya', data: {} })],
      slotTimes,
    );
    expect(list.map((b) => b.dersBranch).sort()).toEqual(['Fizik', 'Kimya']);
  });

  it('dersBranch: ikisi de yoksa null (etüt tarafında dersBranch her zaman dolu — şema NOT NULL)', () => {
    const { list } = combineBookings([], [slotRow({ dersBranch: null, data: null })], slotTimes);
    expect(list[0].dersBranch).toBeNull();
  });
});
