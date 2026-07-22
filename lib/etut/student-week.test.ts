import { describe, it, expect } from 'vitest';
import { normalizeEtutBookings } from './student-week';
import type { EtutReservation } from '@prisma/client';

// Test satırı üreticisi — yalnız normalizeEtutBookings'in okuduğu alanlar anlamlı.
const etutRow = (over: Partial<EtutReservation>): EtutReservation => ({
  id: 'r1', orgSlug: 'o', branch: 'main', sablonId: 's1', teacherId: 't1',
  scope: 'WEEK', status: 'ACTIVE', weekKey: '2026-W30', effectiveFromWeek: null,
  studentId: 'st1', studentName: 'Öğrenci', studentCls: 'c1', dersBranch: 'Fizik',
  bookedByRole: 'student', bookedById: 'st1', bookedAt: new Date(0),
  cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  dayIndex: 0, startsAt: '15:30', endsAt: '16:00', createdAt: new Date(0), updatedAt: new Date(0),
  ...over,
} as EtutReservation);

describe('normalizeEtutBookings — etüt satırı normalizasyonu', () => {
  it('tek etüt → 1 kayıt, weeklyCount=1, source=etut, dersBranch pass-through', () => {
    const { list, weeklyCount } = normalizeEtutBookings([etutRow({})]);
    expect(weeklyCount).toBe(1);
    expect(list).toHaveLength(1);
    expect(list[0].source).toBe('etut');
    expect(list[0].dersBranch).toBe('Fizik');
  });

  it('boş liste → 0 kayıt, weeklyCount=0', () => {
    const { list, weeklyCount } = normalizeEtutBookings([]);
    expect(list).toHaveLength(0);
    expect(weeklyCount).toBe(0);
  });

  it('exclude: çağıran taraf sablonId hariç bırakmışsa (liste önceden filtrelenmiş) o kayıt YOK', () => {
    // bookEtut excludeSablonId'yi EFEKTİF HARİTADA filtreler — buraya zaten süzülmüş bir
    // liste gelir; burada yalnızca pass-through doğru mu diye bakıyoruz.
    const kept = etutRow({ id: 'r1', sablonId: 's1' });
    const { list, weeklyCount } = normalizeEtutBookings([kept]);
    expect(list).toHaveLength(1);
    expect(weeklyCount).toBe(1);
  });

  it('dakika dönüşümü: "09:05"→545, "16:00"→960 (toMin doğru uygulanıyor)', () => {
    const { list } = normalizeEtutBookings([
      etutRow({ dayIndex: 1, startsAt: '09:05', endsAt: '09:40' }),
      etutRow({ id: 'r2', sablonId: 's2', dayIndex: 2, startsAt: '15:30', endsAt: '16:00' }),
    ]);
    expect(list[0].startMin).toBe(545);
    expect(list[0].endMin).toBe(9 * 60 + 40);
    expect(list[1].endMin).toBe(960);
  });

  it('çoklu satır: weeklyCount = satır sayısı, dayIndex korunur', () => {
    const rows = [0, 1, 2].map((d) => etutRow({ id: `r${d}`, sablonId: `s${d}`, dayIndex: d }));
    const { list, weeklyCount } = normalizeEtutBookings(rows);
    expect(weeklyCount).toBe(3);
    expect(list.map((b) => b.dayIndex)).toEqual([0, 1, 2]);
  });

  it('dersBranch boş string → null normalize edilir', () => {
    const { list } = normalizeEtutBookings([etutRow({ dersBranch: '' })]);
    expect(list[0].dersBranch).toBeNull();
  });
});
