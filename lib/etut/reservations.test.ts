import { describe, it, expect } from 'vitest';
import { resolveEffective, RECURRING_WEEKKEY } from './reservations';
import type { EtutReservation } from '@prisma/client';

// Test satırı üreticisi — yalnız çözümleyicinin okuduğu alanlar anlamlı.
const row = (over: Partial<EtutReservation>): EtutReservation => ({
  id: 'r1', orgSlug: 'o', branch: 'main', sablonId: 's1', teacherId: 't1',
  scope: 'WEEK', status: 'ACTIVE', weekKey: '2026-W30', effectiveFromWeek: null,
  studentId: 'st1', studentName: 'Öğrenci', studentCls: 'c1', dersBranch: 'Fizik',
  bookedByRole: 'student', bookedById: 'st1', bookedAt: new Date(0),
  cancelledByRole: null, cancelledById: null, cancelledAt: null, cancelReason: null,
  dayIndex: 0, startsAt: '15:30', endsAt: '16:00', createdAt: new Date(0), updatedAt: new Date(0),
  ...over,
} as EtutReservation);

describe('resolveEffective — WEEK önceliği + tombstone + recurring (spec §3.3)', () => {
  it('yalnız WEEK ACTIVE → o satır', () => {
    const m = resolveEffective([row({})], '2026-W30');
    expect(m.get('s1')?.studentId).toBe('st1');
  });
  it('WEEK CANCELLED (tombstone) → hafta BOŞ (recurring olsa bile)', () => {
    const rec = row({ id: 'r2', scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', studentId: 'st2' });
    const tomb = row({ status: 'CANCELLED' });
    expect(resolveEffective([rec, tomb], '2026-W30').has('s1')).toBe(false);
  });
  it('WEEK ACTIVE recurring\'i EZER (override)', () => {
    const rec = row({ id: 'r2', scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', studentId: 'st2' });
    const wk = row({ studentId: 'st3' });
    expect(resolveEffective([rec, wk], '2026-W30').get('s1')?.studentId).toBe('st3');
  });
  it('yalnız RECURRING ACTIVE + effectiveFromWeek <= hafta → recurring', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', studentId: 'st2' });
    expect(resolveEffective([rec], '2026-W30').get('s1')?.studentId).toBe('st2');
  });
  it('RECURRING effectiveFromWeek İLERİDE → henüz görünmez', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W32' });
    expect(resolveEffective([rec], '2026-W30').has('s1')).toBe(false);
  });
  it('RECURRING CANCELLED → görünmez', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W28', status: 'CANCELLED' });
    expect(resolveEffective([rec], '2026-W30').has('s1')).toBe(false);
  });
  it('farklı sablonlar bağımsız çözülür', () => {
    const a = row({}); const b = row({ id: 'r2', sablonId: 's2', studentId: 'st9' });
    const m = resolveEffective([a, b], '2026-W30');
    expect(m.get('s2')?.studentId).toBe('st9');
  });
  it('hafta anahtarı string karşılaştırması ISO formatta güvenli (W09 < W10)', () => {
    const rec = row({ scope: 'RECURRING', weekKey: RECURRING_WEEKKEY, effectiveFromWeek: '2026-W09' });
    expect(resolveEffective([rec], '2026-W10').has('s1')).toBe(true);
  });
});
