// Etüt şablonu (EtutSablon tablosu) veri katmanı — Faz 2b Task 1.
// GET/POST/PUT/DELETE /api/etut-sablon bu servisi çağırır (PATCH — öğrenci atama — HALA
// JSON'da, Faz 2b Task 5'te taşınır). Dış sözleşme: id = legacyId (DB cuid'i asla sızmaz).
//
// Tenant deseni: teachers.ts/courses.ts'teki mevcut idiomu izler — önce tenant-scoped
// `findFirst` (teacherId+legacyId+deletedAt:null; $extends orgSlug/branch'i otomatik
// enjekte eder) satırı bulur, sonra o satırın CUID `id`'siyle update/delete yapılır
// (cuid zaten bulma adımıyla tenant'a scope'lanmış olduğundan ek orgSlug/branch gerekmez).
// create'de `withScope()` — değerler $extends tarafından çalışma anında enjekte edilir.
import { tdb, withScope } from '@/lib/sqldb';
import { newId } from '@/lib/id';
import { slotStartTime } from '@/lib/slots';
import { getWeekKey } from '@/lib/constants';
import { HttpError } from '@/lib/errors';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { getWeekReservations, resolveEffective, RECURRING_WEEKKEY } from './reservations';
import { currentWeekKeyTSI } from './weeks';
import type { EtutSablon, EtutReservation } from '@prisma/client';

export interface SablonDTO {
  id: string; // legacyId — dış sözleşme
  dayIndex: number;
  start: string;
  end: string;
  aktif: boolean;
  pasifHaftalar: string[];
}

export function toSablonDTO(row: EtutSablon): SablonDTO {
  return {
    id: row.legacyId,
    dayIndex: row.dayIndex,
    start: row.start,
    end: row.end,
    aktif: row.aktif,
    pasifHaftalar: row.pasifHaftalar,
  };
}

export interface ToggleableFields { aktif: boolean; pasifHaftalar: string[] }

// Saf yardımcı — mevcut PUT /api/etut-sablon davranışıyla BİREBİR:
// scope=all → aktif set edilir; aktif=true ise pasifHaftalar SIFIRLANIR (false ise dokunulmaz).
// scope=week → aktif alanı SABİT kalır; yalnız o haftanın pasifHaftalar üyeliği eklenir/çıkarılır.
export function applyToggle(row: ToggleableFields, scope: 'all' | 'week', weekKey: string | undefined, aktif: boolean): ToggleableFields {
  if (scope === 'all') {
    return { aktif, pasifHaftalar: aktif ? [] : row.pasifHaftalar };
  }
  const set = new Set(row.pasifHaftalar);
  if (aktif) set.delete(weekKey as string); else set.add(weekKey as string);
  return { aktif: row.aktif, pasifHaftalar: Array.from(set) };
}

// Tenant-scoped tekil satır — teacherId=legacyId + legacyId + deletedAt:null.
async function findRow(teacherLegacyId: string, legacyId: string): Promise<EtutSablon | null> {
  return tdb().etutSablon.findFirst({ where: { teacherId: teacherLegacyId, legacyId, deletedAt: null } });
}

export async function listSablonlar(teacherLegacyId: string): Promise<SablonDTO[]> {
  const rows = await tdb().etutSablon.findMany({
    where: { teacherId: teacherLegacyId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(toSablonDTO);
}

// Faz 3: ProgramEditor için şablon + o haftanın EFEKTİF rezervasyonu (WEEK-ezer-RECURRING).
// listSablonlar'ın rez'li üstkümesi; pasif/pasifHaftalar şablonlar da DÖNER (editör gösterir).
// deletedAt:null süzgeci findMany where'inde (silinen şablon editörde de görünmez).
export interface SablonRezDTO extends SablonDTO {
  studentId: string | null; studentName: string | null; studentCls: string | null;
  branch: string | null; bookedBy: string | null;
  rezScope: 'WEEK' | 'RECURRING' | null; // 'scope' adı PUT ToggleSchema'nın scope'uyla karışmasın diye rezScope
}

export function mergeSablonRez(rows: EtutSablon[], effectiveMap: Map<string, EtutReservation>): SablonRezDTO[] {
  return rows.map((r) => {
    const eff = effectiveMap.get(r.id) ?? null;
    return {
      ...toSablonDTO(r),
      studentId: eff?.studentId ?? null, studentName: eff?.studentName ?? null,
      studentCls: eff?.studentCls ?? null, branch: eff?.dersBranch ?? null,
      bookedBy: eff?.bookedByRole ?? null,
      rezScope: eff ? (eff.scope as 'WEEK' | 'RECURRING') : null,
    };
  });
}

export async function listSablonlarWithRez(teacherLegacyId: string, weekKey: string): Promise<SablonRezDTO[]> {
  const orgSlug = currentOrg();
  const branch = currentBranch();
  // Faz 3 audit-fix FIX-B: SIRALI (paralel değil) — önce bu öğretmenin şablon satırları
  // alınır, sonra rezervasyon sorgusu yalnız o şablonların id'lerine (sablonId: in) daraltılır.
  // Eskiden getWeekReservations tenant-genelinde TÜM haftanın satırlarını çekiyordu; kurum
  // büyüdükçe (çok öğretmen) boşa satır aktarımı olurdu.
  const rows = await tdb().etutSablon.findMany({ where: { teacherId: teacherLegacyId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  const allReservations = await getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey, rows.map((r) => r.id));
  return mergeSablonRez(rows, resolveEffective(allReservations, weekKey));
}

function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export interface SablonInput { id?: string; dayIndex: number; start: string; end: string; aktif?: boolean }

// POST /api/etut-sablon davranışıyla BİREBİR — id yoksa create (legacyId=newId()), varsa update
// (satır bulunamazsa eski davranış gibi SESSİZCE no-op). weekKey: geçmiş-gün/saat doğrulamasının
// referans haftası — route'tan iletilir (ProgramEditor gelecek haftayı görüntülerken o haftaya
// göre doğrular, `weekKey` yoksa mevcut haftaya düşer — eski route body'sindeki `wk || getWeekKey()`
// AYNEN). Not: brief'teki kısaltılmış imza (yalnız teacherLegacyId+s) `weekKey`'i atlıyordu; bu,
// ProgramEditor'ün +1/+2 hafta ileri görünümünde YANLIŞ ret üretirdi (bkz. task-1-report.md) —
// üçüncü opsiyonel parametre olarak eklendi, dış GET/POST/PUT/DELETE sözleşmesini etkilemiyor.
export async function saveSablon(teacherLegacyId: string, s: SablonInput, weekKey?: string): Promise<SablonDTO[]> {
  if (toMin(s.end) <= toMin(s.start)) {
    throw new HttpError(400, 'Bitiş saati başlangıçtan sonra olmalı');
  }
  const wk = weekKey || getWeekKey();
  const startAt = slotStartTime(wk, s.dayIndex, s.start);
  if (startAt.getTime() <= Date.now()) {
    throw new HttpError(400, 'Geçmiş bir gün/saate etüt eklenemez');
  }

  if (s.id) {
    const row = await findRow(teacherLegacyId, s.id);
    if (row) {
      await tdb().etutSablon.update({
        where: { id: row.id },
        data: { dayIndex: s.dayIndex, start: s.start, end: s.end, ...(s.aktif !== undefined ? { aktif: s.aktif } : {}) },
      });
    }
  } else {
    await tdb().etutSablon.create({
      data: withScope({
        legacyId: newId(), teacherId: teacherLegacyId,
        dayIndex: s.dayIndex, start: s.start, end: s.end, aktif: s.aktif ?? true,
      }),
    });
  }
  return listSablonlar(teacherLegacyId);
}

// PUT /api/etut-sablon davranışıyla BİREBİR (satır bulunamazsa sessiz no-op).
export async function toggleSablon(teacherLegacyId: string, legacyId: string, scope: 'all' | 'week', weekKey: string | undefined, aktif: boolean): Promise<SablonDTO[]> {
  const row = await findRow(teacherLegacyId, legacyId);
  if (row) {
    const next = applyToggle(row, scope, weekKey, aktif);
    await tdb().etutSablon.update({ where: { id: row.id }, data: next });
  }
  return listSablonlar(teacherLegacyId);
}

// DELETE /api/etut-sablon — SOFT delete (deletedAt=now). Rezervasyon satırları SİLİNMEZ
// (EtutReservation hard-cascade yalnız bilinçli hard-delete/reset-all yollarında) ama
// CARİ + GELECEK haftalar ile RECURRING serisi CANCELLED'a çekilir (2026-07-22 denetim):
// silinen etüt artık yapılmayacağı için o kayıtlar canlı bir taahhüt değildir; ACTIVE
// bırakılırlarsa öğrenci göremediği bir kayıt yüzünden o saate/derse kilitlenirdi.
// GEÇMİŞ haftalara DOKUNULMAZ — onlar olmuş bir etüdün tarihsel kaydıdır (yoklama
// etiketleri attendance-label üzerinden silinen şablonu bilerek okur).
// weekKey ISO 'YYYY-Www' string kıyası kronolojiktir; RECURRING '*' ASCII'de rakamlardan
// KÜÇÜK olduğu için gte'ye TAKILMAZ, ayrı OR ayağıyla açıkça yakalanır.
export async function softDeleteSablon(
  teacherLegacyId: string,
  legacyId: string,
  by: { role: string; id: string },
): Promise<SablonDTO[]> {
  const row = await findRow(teacherLegacyId, legacyId);
  if (row) {
    const orgSlug = currentOrg(); const branch = currentBranch();
    const cur = currentWeekKeyTSI();
    await tdb(orgSlug, branch).$transaction(async (tx) => {
      await tx.etutSablon.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
      // orgSlug/branch AÇIKÇA — $extends updateMany.where'e zaten enjekte eder, ama
      // reservations.ts:36 idiomu: tenant sınırı yazma yolunda yapısal olarak da durur.
      await tx.etutReservation.updateMany({
        where: {
          orgSlug, branch, sablonId: row.id, status: 'ACTIVE',
          OR: [{ weekKey: { gte: cur } }, { weekKey: RECURRING_WEEKKEY }],
        },
        data: {
          status: 'CANCELLED', cancelledByRole: by.role, cancelledById: by.id,
          cancelledAt: new Date(), cancelReason: 'sablon-silindi',
        },
      });
    });
  }
  return listSablonlar(teacherLegacyId);
}

// Faz 2b orkestratörü (bookEtut/cancelEtut, Task 4) kullanır — DB satırı (cuid dahil) döner.
export async function getSablonForBooking(teacherLegacyId: string, legacyId: string): Promise<EtutSablon | null> {
  return findRow(teacherLegacyId, legacyId);
}
