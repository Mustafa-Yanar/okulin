import { describe, it, expect } from 'vitest';
import { toSablonDTO, applyToggle, mergeSablonRez } from './sablon-service';
import type { EtutSablon, EtutReservation } from '@prisma/client';

// Test satırı üreticisi — yalnız fonksiyonların okuduğu alanlar anlamlı.
const row = (over: Partial<EtutSablon> = {}): EtutSablon => ({
  id: 'cuid-secret', orgSlug: 'o', branch: 'main', legacyId: 'legacy1', teacherId: 't1',
  dayIndex: 2, start: '15:00', end: '16:00', aktif: true, pasifHaftalar: [],
  deletedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  ...over,
} as EtutSablon);

describe('toSablonDTO — DB satırı → DTO (id=legacyId, cuid sızmaz)', () => {
  it('id alanı legacyId olur, cuid dışa sızmaz', () => {
    const dto = toSablonDTO(row({ legacyId: 'leg-x', id: 'cuid-secret' }));
    expect(dto.id).toBe('leg-x');
    expect(dto.id).not.toBe('cuid-secret');
  });
  it('dayIndex/start/end/aktif/pasifHaftalar birebir aktarılır', () => {
    const dto = toSablonDTO(row({ dayIndex: 4, start: '09:00', end: '10:00', aktif: false, pasifHaftalar: ['2026-W30'] }));
    expect(dto).toEqual({ id: 'legacy1', dayIndex: 4, start: '09:00', end: '10:00', aktif: false, pasifHaftalar: ['2026-W30'] });
  });
});

describe('applyToggle — mevcut PUT /api/etut-sablon davranışıyla BİREBİR', () => {
  it('scope=all, aktif=true → pasifHaftalar temizlenir', () => {
    const r = applyToggle({ aktif: false, pasifHaftalar: ['2026-W28', '2026-W29'] }, 'all', undefined, true);
    expect(r).toEqual({ aktif: true, pasifHaftalar: [] });
  });
  it('scope=all, aktif=false → aktif kapanır, pasifHaftalar DOKUNULMAZ', () => {
    const r = applyToggle({ aktif: true, pasifHaftalar: ['2026-W28'] }, 'all', undefined, false);
    expect(r).toEqual({ aktif: false, pasifHaftalar: ['2026-W28'] });
  });
  it("scope=week, aktif=false → weekKey pasifHaftalar'a EKLENİR, aktif alanı sabit kalır", () => {
    const r = applyToggle({ aktif: true, pasifHaftalar: [] }, 'week', '2026-W30', false);
    expect(r).toEqual({ aktif: true, pasifHaftalar: ['2026-W30'] });
  });
  it("scope=week, aktif=true → weekKey pasifHaftalar'dan ÇIKARILIR", () => {
    const r = applyToggle({ aktif: true, pasifHaftalar: ['2026-W29', '2026-W30'] }, 'week', '2026-W30', true);
    expect(r).toEqual({ aktif: true, pasifHaftalar: ['2026-W29'] });
  });
  it('scope=week, aktif=false tekrarlı çağrı idempotent (kopya eklenmez)', () => {
    const once = applyToggle({ aktif: true, pasifHaftalar: [] }, 'week', '2026-W30', false);
    const twice = applyToggle(once, 'week', '2026-W30', false);
    expect(twice).toEqual({ aktif: true, pasifHaftalar: ['2026-W30'] });
  });
});

describe('mergeSablonRez', () => {
  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'cuid1', legacyId: 'e1', teacherId: 't1', dayIndex: 2, start: '10:00', end: '11:00',
    aktif: true, pasifHaftalar: [] as string[], deletedAt: null, ...over,
  }) as unknown as EtutSablon;
  const rez = (over: Partial<Record<string, unknown>> = {}) => ({
    sablonId: 'cuid1', scope: 'RECURRING', status: 'ACTIVE',
    studentId: 's1', studentName: 'Ahmet', studentCls: '8B', dersBranch: 'Matematik', bookedByRole: 'director',
    ...over,
  }) as unknown as EtutReservation;

  it('rezervasyonsuz şablon → rez alanları null (SablonDTO alanları aynen)', () => {
    const out = mergeSablonRez([row()], new Map());
    expect(out[0]).toMatchObject({ id: 'e1', dayIndex: 2, aktif: true, studentId: null, rezScope: null });
  });
  it('efektif rezervasyon → alanlar dolu + rezScope', () => {
    const out = mergeSablonRez([row()], new Map([['cuid1', rez()]]));
    expect(out[0]).toMatchObject({ studentId: 's1', studentName: 'Ahmet', studentCls: '8B', branch: 'Matematik', bookedBy: 'director', rezScope: 'RECURRING' });
  });
  it('pasif şablon da LİSTELENİR (ProgramEditor pasifleri gösterir; süzme YOK)', () => {
    expect(mergeSablonRez([row({ aktif: false })], new Map())).toHaveLength(1);
  });
});
