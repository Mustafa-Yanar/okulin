import { describe, it, expect, vi, beforeEach } from 'vitest';

// softDeleteSablon testleri tdb()/tenant bağlamını mock'lar (gerçek DB bağlantısı YOK).
// vi.mock hoisted — aşağıdaki static import'lardan ÖNCE çalışır (level-pool.test.ts ile aynı desen).
// Saf fonksiyonlar (toSablonDTO/applyToggle/mergeSablonRez) bu mock'lardan etkilenmez.
vi.mock('@/lib/sqldb', () => ({ tdb: vi.fn(), withScope: (d: unknown) => d }));
vi.mock('@/lib/tenant', () => ({ currentOrg: () => 'o', currentBranch: () => 'main' }));

import { toSablonDTO, applyToggle, mergeSablonRez, softDeleteSablon } from './sablon-service';
import { tdb } from '@/lib/sqldb';
import { RECURRING_WEEKKEY } from './reservations';
import { currentWeekKeyTSI } from './weeks';
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

// 2026-07-22 denetim (canlı kanıtlı hata): şablon soft-delete edilince rezervasyon satırı
// ACTIVE kalıyordu → hiçbir ekranda görünmeyen "öksüz" satır decideBooking kural 10/11/12
// üzerinden öğrenciyi sessizce kilitliyordu. Karar yolu getWeekReservations'ta süzülüyor
// (reservations.test.ts), TEMİZLİK de burada: cari+gelecek+recurring CANCELLED'a çekilir.
describe('softDeleteSablon — silme, canlı taahhütleri de iptal eder (geçmişe dokunmaz)', () => {
  const SABLON = row({ id: 'cuid-secret', legacyId: 'leg1' });

  // Argüman tipleri AÇIKÇA yazılı — vi.fn(async () => ...) argüman tuple'ını boş ([]) çıkarır
  // ve mock.calls[0][0] tsc'de "no element at index 0" verir.
  type UpdateArg = { where: { id: string }; data: { deletedAt: Date } };
  type UpdateManyArg = { where: Record<string, unknown>; data: Record<string, unknown> };

  function fakeDb(found: EtutSablon | null) {
    const tx = {
      etutSablon: { update: vi.fn(async (_a: UpdateArg) => ({})) },
      etutReservation: { updateMany: vi.fn(async (_a: UpdateManyArg) => ({ count: 1 })) },
    };
    const db = {
      etutSablon: { findFirst: vi.fn(async () => found), findMany: vi.fn(async () => (found ? [found] : [])) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    vi.mocked(tdb).mockImplementation(() => db as never);
    return { db, tx };
  }

  beforeEach(() => { vi.mocked(tdb).mockReset(); });

  it('şablon deletedAt=now ile işaretlenir', async () => {
    const { tx } = fakeDb(SABLON);
    await softDeleteSablon('t1', 'leg1', { role: 'director', id: 'd1' });
    const arg = tx.etutSablon.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'cuid-secret' });
    expect(arg.data.deletedAt).toBeInstanceOf(Date);
  });

  it("CARİ+GELECEK haftalar (gte) ve RECURRING '*' ayrı OR ayaklarıyla hedeflenir; geçmiş DIŞARIDA", async () => {
    const { tx } = fakeDb(SABLON);
    await softDeleteSablon('t1', 'leg1', { role: 'director', id: 'd1' });
    const where = tx.etutReservation.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ orgSlug: 'o', branch: 'main', sablonId: 'cuid-secret', status: 'ACTIVE' });
    expect(where.OR).toEqual([{ weekKey: { gte: currentWeekKeyTSI() } }, { weekKey: RECURRING_WEEKKEY }]);
  });

  it("RECURRING '*' ASCII'de rakamlardan KÜÇÜK — gte ayağına takılmaz, ayrı OR ayağı ZORUNLU", () => {
    // Bu invariant bozulursa (weekKey formatı değişirse) yukarıdaki iki-ayaklı OR gereksizleşir
    // ya da tersine recurring sessizce kaçar. String kıyası kronolojik: '2026-W29' < '2026-W30'.
    expect(RECURRING_WEEKKEY >= '2026-W30').toBe(false);
    expect('2026-W29' >= '2026-W30').toBe(false);
    expect('2026-W31' >= '2026-W30').toBe(true);
  });

  it('iptal alanları aktörle birlikte yazılır (cancelReason=sablon-silindi)', async () => {
    const { tx } = fakeDb(SABLON);
    await softDeleteSablon('t1', 'leg1', { role: 'counselor', id: 'c9' });
    const data = tx.etutReservation.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({
      status: 'CANCELLED', cancelledByRole: 'counselor', cancelledById: 'c9', cancelReason: 'sablon-silindi',
    });
    expect(data.cancelledAt).toBeInstanceOf(Date);
  });

  it('şablon bulunamazsa SESSİZ no-op — transaction hiç açılmaz (toggleSablon ile aynı davranış)', async () => {
    const { db } = fakeDb(null);
    await softDeleteSablon('t1', 'yok', { role: 'director', id: 'd1' });
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
