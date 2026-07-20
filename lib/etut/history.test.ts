import { describe, it, expect } from 'vitest';
import { buildEtutHistoryWeeks, selectRecurringToFreeze } from './history';
import type { EtutReservation } from '@prisma/client';

// Test satırı üreticisi — yalnız buildEtutHistoryWeeks'in okuduğu alanlar anlamlı
// (reservations.test.ts / sablon-service.test.ts ile AYNI idiom: düz obje + as unknown as).
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  weekKey: '2026-W30', scope: 'WEEK', status: 'ACTIVE', sablonId: 'c1', teacherId: 't1',
  studentId: 's1', studentName: 'İrem', studentCls: '11A', dersBranch: 'Fizik', bookedByRole: 'student',
  dayIndex: 1, startsAt: '14:00', endsAt: '15:00',
  ...over,
}) as unknown as EtutReservation;

describe('buildEtutHistoryWeeks — SAF: gruplama + sıralama + ArchiveEntry şekli', () => {
  it('haftalara gruplar, hafta DESC sıralar', () => {
    const rows = [row({ weekKey: '2026-W30' }), row({ weekKey: '2026-W31', sablonId: 'c2' })];
    const weeks = buildEtutHistoryWeeks(rows, new Map());
    expect(weeks.map(w => w.weekKey)).toEqual(['2026-W31', '2026-W30']);
  });

  it('hafta içinde gün+saat ASC sıralar', () => {
    const rows = [
      row({ sablonId: 'c2', dayIndex: 2, startsAt: '10:00', endsAt: '11:00' }),
      row({ sablonId: 'c3', dayIndex: 1, startsAt: '15:00', endsAt: '16:00' }),
      row({ sablonId: 'c4', dayIndex: 1, startsAt: '09:00', endsAt: '10:00' }),
    ];
    const weeks = buildEtutHistoryWeeks(rows, new Map());
    expect(weeks[0].entries.map(e => `${e.day}:${e.slotLabel}`)).toEqual([
      '1:09:00–10:00', '1:15:00–16:00', '2:10:00–11:00',
    ]);
  });

  it('entry alanları ArchiveEntry şekliyle eşleşir (slotId etut:<sablonId>, slotLabel start–end, branch=dersBranch, teacherName map’ten)', () => {
    const weeks = buildEtutHistoryWeeks([row({})], new Map([['t1', 'Ahmet Öğretmen']]));
    expect(weeks[0].entries[0]).toEqual({
      day: 1, dayLabel: 'Salı', slotId: 'etut:c1', slotLabel: '14:00–15:00',
      studentId: 's1', studentName: 'İrem', studentCls: '11A',
      bookedBy: 'student', fixed: false,
      teacherId: 't1', teacherName: 'Ahmet Öğretmen', branch: 'Fizik',
    });
  });

  it('öğretmen adı map’te yoksa teacherId gösterilir (boş değil)', () => {
    const weeks = buildEtutHistoryWeeks([row({ teacherId: 't9' })], new Map());
    expect(weeks[0].entries[0].teacherName).toBe('t9');
  });

  // Faz 4 audit-fix FIX-2 A: history.ts'in cari-hafta efektif enjeksiyonu, RECURRING
  // satırları `{ ...r, weekKey: cur }` kopyasıyla geçirir (RECURRING'in ham weekKey'i '*'
  // marker'ıdır — yeniden yazılmazsa buildEtutHistoryWeeks onu ayrı, hayalet bir "hafta"ya
  // koyardı). Bu test o kopyalama deseninin doğru haftaya girdiğini SAF düzeyde doğrular.
  it('weekKey yeniden-yazılmış RECURRING satırı (cari-hafta efektif enjeksiyon şekli) doğru haftaya girer', () => {
    const rows = [
      row({ weekKey: '2026-W30', scope: 'WEEK', sablonId: 'c1' }),
      row({ weekKey: '2026-W32', scope: 'RECURRING', sablonId: 'c9' }),
    ];
    const weeks = buildEtutHistoryWeeks(rows, new Map());
    expect(weeks.map(w => w.weekKey)).toEqual(['2026-W32', '2026-W30']);
    expect(weeks[0].entries[0].slotId).toBe('etut:c9');
  });

  it('aynı haftada (WEEK satırı + weekKey yeniden-yazılmış RECURRING kopyası) birlikte gruplanır, gün+saat ASC sıralanır', () => {
    const rows = [
      row({ weekKey: '2026-W32', scope: 'WEEK', sablonId: 'c1', dayIndex: 2, startsAt: '10:00', endsAt: '11:00' }),
      row({ weekKey: '2026-W32', scope: 'RECURRING', sablonId: 'c9', dayIndex: 1, startsAt: '09:00', endsAt: '10:00' }),
    ];
    const weeks = buildEtutHistoryWeeks(rows, new Map());
    expect(weeks).toHaveLength(1);
    expect(weeks[0].entries.map(e => e.slotId)).toEqual(['etut:c9', 'etut:c1']);
  });
});

describe('selectRecurringToFreeze — SAF: efektif haritadan yalnız scope RECURRING satırlar', () => {
  it('yalnız scope RECURRING efektif satırlar döner (WEEK satırları dondurulmaz)', () => {
    // Not: resolveEffective (reservations.ts) zaten WEEK-öncelikli çözülüyor — bir (sablon,hafta)
    // için harita ya WEEK ya RECURRING satırı taşır, ikisini birden değil (bkz. reservations.test.ts
    // "WEEK ACTIVE recurring'i EZER"). Bu test selectRecurringToFreeze'in KENDİ süzgecini
    // (scope==='RECURRING') doğrudan doğrular; tombstone/CANCELLED satırlar zaten resolveEffective
    // aşamasında haritaya hiç girmez (composition garantisi, ayrıca reservations.test.ts'te kanıtlı).
    const effective = new Map<string, EtutReservation>([
      ['c1', row({ scope: 'RECURRING', sablonId: 'c1' })],
      ['c2', row({ scope: 'WEEK', sablonId: 'c2' })],
    ]);
    const result = selectRecurringToFreeze(effective);
    expect(result).toHaveLength(1);
    expect(result[0].sablonId).toBe('c1');
  });

  it('boş map → boş liste', () => {
    expect(selectRecurringToFreeze(new Map())).toEqual([]);
  });
});
