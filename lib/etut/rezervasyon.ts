import { getAllTeachers, getAllStudents, dateStrForWeekDay } from '@/lib/slots';
import { allowedBranchesForClass, MATH_FAMILY, ALL_DAYS } from '@/lib/constants';
import { HttpError } from '@/lib/errors';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { buildEtutYoklamaMap, type EtutYoklamaDurum } from './attendance-status';
import { getWeekReservations, resolveEffective } from './reservations';
import { levelPoolForStudent } from './level-pool';
import type { EtutSablon, EtutReservation } from '@prisma/client';

// Etüt rezervasyon iş kuralları — Faz 2b'den itibaren gerçek iş mantığı lib/etut/booking.ts
// (bookEtut/cancelEtutV2) + lib/etut/booking-rules.ts (decideBooking) içinde yaşıyor.
// BU DOSYADA KALANLAR:
//   1) Saf kural yardımcıları (birim testli — timeConflicts/branchConflicts/mathFamilyConflict/
//      pickAllowedBranches) — Task 6 ile app/api/slots/route.ts artık pickAllowedBranches'i
//      KULLANMIYOR (levelPoolForGroup'a geçti, §4a); fonksiyon yalnız birim testler için canlı
//      kalıyor (rezervasyon.test.ts). decideBooking KENDİ eşdeğerini taşıyor (kopya değil —
//      decideBooking SlotBooking tarafını da kapsıyor, buradakiler daha dar/eski JSON-döneminden
//      kalma imza).
//   2) listBookableEtuts — mobil "rezerve edilebilir etütler" listesi, artık EtutSablon
//      TABLOSUNDAN (JSON programTemplate DEĞİL) + EtutReservation efektif doluluğundan okur.
//      Branş adayları artık sınıf-listesi DEĞİL öğrencinin DÜZEY havuzu (levelPoolForGroup,
//      spec §4a — bookEtut'un autoPickBranch'iyle AYNI kaynak, tutarlılık için).
//
// NOT (Faz 2b Task 7): eski reserveEtut/cancelEtut EtutActor-adaptörleri (+precomputedFrom/
// actorSession/toLegacyEtutShape yardımcıları) SİLİNDİ — tek çağıranları mobil route'du
// (app/api/mobile/v1/etut/reserve), o artık MobileClaims'i (Session'ı genişletir) doğrudan
// bookEtut/cancelEtutV2'ye geçiriyor; ara katman gereksizleşti.

// ── Saf kural yardımcıları (birim testli) ──
export function timeConflicts(booked: { dayIndex: number; start: string }[], dayIndex: number, start: string): boolean {
  return booked.some((b) => b.dayIndex === dayIndex && b.start === start);
}
export function branchConflicts(booked: { branch?: string }[], bookingBranch: string): boolean {
  return booked.some((b) => b.branch === bookingBranch);
}
export function mathFamilyConflict(booked: { branch?: string }[], bookingBranch: string): boolean {
  if (!MATH_FAMILY.includes(bookingBranch)) return false;
  return booked.some((b) => MATH_FAMILY.includes((b.branch as string) ?? ''));
}

// Öğrencinin görebileceği/rezerve edebileceği dersler — ÖNCE kurum registry'si
// (Class.dersler; özel şube s_UUID + yapılandırılmış sınıflar için TEK doğru kaynak),
// registry'de kayıt/ders yoksa constants'a düş (legacy sayısal sınıf fallback).
// Client (StudentPanel: coursesForClass ?? allowedBranchesForClass) ve rehberlik
// subjectsForClass ile HİZALI. constants colKeyForClass 's_UUID'yi parseInt→NaN ile
// yanlış 'Lise Ortak_9'a düşürüyordu → geçerli branş "Geçersiz ders" ile reddediliyordu.
// Saf karar (birim testli): registry dersleri varsa onları, yoksa constants'ı kullan.
// NOT: hiçbir üretim çağıranı KALMADI (Task 6 ile app/api/slots/route.ts da levelPoolForGroup'a
// geçti — listBookableEtuts zaten önceden geçmişti, spec §4a); yalnız rezervasyon.test.ts
// tarafından kullanılıyor. Silinmedi — regresyon güvencesi için testler canlı tutuluyor.
export function pickAllowedBranches(registryDersler: string[] | null | undefined, cls: string | null | undefined): string[] {
  if (registryDersler && registryDersler.length) return registryDersler;
  return allowedBranchesForClass(cls);
}

// ── listBookableEtuts — tablo-tabanlı (Faz 2b Task 5) ─────────────────────────
// Öğrencinin bu hafta REZERVE EDEBİLECEĞİ etütler (mobil ekran listesi).
// Öğrencinin grubuna açık öğretmenlerin, bu hafta efektif-aktif şablonları (EtutSablon
// deletedAt:null + aktif/pasifHaftalar); her biri için doluluk/sahiplik EtutReservation
// efektif satırından (resolveEffective — WEEK önce, sonra RECURRING), branş adayları
// öğretmen branşları ∩ öğrencinin DÜZEY havuzu (levelPoolForStudent — spec §4a + Fix 2
// boş-havuz fallback'i, sınıf listesi DEĞİL; bookEtut'un autoPickBranch'iyle AYNI kaynak).
export interface BookableEtut {
  teacherId: string;
  teacherName: string;
  etutId: string;
  dayIndex: number;
  start: string;
  end: string;
  branches: string[]; // öğrencinin seçebileceği ders adayları (öğretmen branşları ∩ düzey havuzu)
  booked: boolean;    // başka öğrenci tarafından dolu
  mine: boolean;      // bu öğrencinin rezervasyonu
  branch: string | null; // mine ise rezerve edilen ders
}
export async function listBookableEtuts(studentId: string, weekKey: string): Promise<BookableEtut[]> {
  const [students, teachers] = await Promise.all([getAllStudents(), getAllTeachers()]);
  const student = students.find((s) => s.id === studentId);
  if (!student) throw new HttpError(404, 'Öğrenci bulunamadı');

  const orgSlug = currentOrg();
  const branch = currentBranch();
  const [levelPool, sablonRows, allReservations] = await Promise.all([
    // levelPoolForStudent (Fix 2): grup havuzu boşsa öğrencinin kendi şubesine düşer —
    // booking.ts'in autoPickBranch kaynağıyla AYNI (tutarlılık).
    levelPoolForStudent(student.cls || '', student.group),
    // Tenant-scoped $extends enjeksiyonu — sablon-service.ts'teki AYNI idiom (teacherId filtresi
    // YOK: bu, TÜM öğretmenlerin şablonlarını tarayan öğrenci-merkezli bir liste).
    tdb().etutSablon.findMany({ where: { deletedAt: null } }),
    // orgSlug/branch AÇIKÇA — getWeekReservations $extends'e dayanmaz (reservations.ts imzası).
    getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey),
  ]);
  const effectiveMap = resolveEffective(allReservations, weekKey);
  const teacherById = new Map(teachers.map((t) => [t.id, t]));

  const out: BookableEtut[] = [];
  for (const sb of sablonRows) {
    // Efektif-aktiflik — booking-rules.ts kural 5 ile AYNI ifade (tekrar, buradaki karar SAF
    // görüntüleme filtresi; yazma yolunda otorite decideBooking'de).
    if (sb.aktif === false || sb.pasifHaftalar.includes(weekKey)) continue;
    const teacher = teacherById.get(sb.teacherId);
    if (!teacher) continue;
    const allowedGroups = teacher.allowedGroups || [];
    const effective = effectiveMap.get(sb.id) ?? null;
    const mine = effective?.studentId === studentId;
    // Öğrencinin grubuna kapalı öğretmenin etütleri listede gösterilmez (rezerve edilemez);
    // kendi rezervasyonu farklı grup olsa bile görünsün (iptal için).
    const groupOk = allowedGroups.includes(student.group);
    if (!groupOk && !mine) continue;
    const branches = (teacher.branches || []).filter((b) => levelPool.includes(b));
    out.push({
      teacherId: teacher.id,
      teacherName: teacher.name,
      etutId: sb.legacyId,
      dayIndex: sb.dayIndex,
      start: sb.start,
      end: sb.end,
      branches,
      booked: Boolean(effective) && !mine,
      mine,
      branch: mine ? (effective?.dersBranch ?? null) : null,
    });
  }
  out.sort((a, b) => (a.dayIndex - b.dayIndex) || a.start.localeCompare(b.start));
  return out;
}

// ── listEtutlerForWeek — /api/etut-sablon/all + mobil today/week ortak kaynağı (Faz 3) ──
// listBookableEtuts'un rol-bağımsız kardeşi: TÜM öğretmenlerin o hafta efektif-aktif
// şablonları + efektif rezervasyon sahipliği. JSON (programTemplate.etutSablonlari)
// OKUNMAZ. deletedAt:null süzgeci ZORUNLU (Gemini ORTA-2 — silinen şablonun rezervasyonu
// hiçbir listede görünmez). Alan adları eski /all sözleşmesiyle BİREBİR + yeni `scope`.
export interface EtutAllRow {
  teacherId: string; teacherName: string; branches: string[]; allowedGroups: string[];
  id: string;               // EtutSablon.legacyId (dış sözleşme)
  dayIndex: number; dayLabel: string; start: string; end: string;
  studentId: string | null; studentName: string | null; studentCls: string | null;
  branch: string | null;    // efektif rezervasyonun dersBranch'i
  bookedBy: string | null;  // efektif rezervasyonun bookedByRole'ü
  booked: boolean;
  scope: 'WEEK' | 'RECURRING' | null; // YENİ — 'Kalıcı' rozeti için
}

export function buildEtutAllList(
  sablonRows: EtutSablon[],
  teachers: { id: string; name: string; branches?: string[]; allowedGroups?: string[] }[],
  effectiveMap: Map<string, EtutReservation>,
  weekKey: string,
): EtutAllRow[] {
  const dayLabel = new Map(ALL_DAYS.map((d) => [d.index, d.label]));
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const out: EtutAllRow[] = [];
  for (const sb of sablonRows) {
    if (sb.aktif === false || sb.pasifHaftalar.includes(weekKey)) continue; // efektif-aktiflik (listBookableEtuts ile aynı ifade)
    const teacher = teacherById.get(sb.teacherId);
    if (!teacher) continue;
    const eff = effectiveMap.get(sb.id) ?? null;
    out.push({
      teacherId: teacher.id, teacherName: teacher.name,
      branches: teacher.branches || [], allowedGroups: teacher.allowedGroups || [],
      id: sb.legacyId, dayIndex: sb.dayIndex, dayLabel: dayLabel.get(sb.dayIndex) || '',
      start: sb.start, end: sb.end,
      studentId: eff?.studentId ?? null, studentName: eff?.studentName ?? null,
      studentCls: eff?.studentCls ?? null, branch: eff?.dersBranch ?? null,
      bookedBy: eff?.bookedByRole ?? null, booked: Boolean(eff),
      scope: eff ? (eff.scope as 'WEEK' | 'RECURRING') : null,
    });
  }
  out.sort((a, b) => (a.dayIndex - b.dayIndex) || a.start.localeCompare(b.start));
  return out;
}

export async function listEtutlerForWeek(weekKey: string): Promise<EtutAllRow[]> {
  const orgSlug = currentOrg();
  const branch = currentBranch();
  const [teachers, sablonRows, allReservations] = await Promise.all([
    getAllTeachers(),
    tdb().etutSablon.findMany({ where: { deletedAt: null } }),
    getWeekReservations(tdb(orgSlug, branch), orgSlug, branch, weekKey),
  ]);
  return buildEtutAllList(sablonRows, teachers, resolveEffective(allReservations, weekKey), weekKey);
}

// Toplu görünüm yoklama rozeti (müdür/rehber): atanmış satırlara o haftanın etüt
// yoklama durumunu iliştirir. Kayıt anahtarı date+lessonNo ('e'+legacyId) — eşleme
// mantığı SAF modülde (attendance-status.ts). "Geçmiş slot mu" kararı İSTEMCİDE
// (isSlotPast); sunucu tüm atanmış satırlar için durum döner.
export async function attachEtutYoklama<T extends { id: string; dayIndex: number; studentId?: string | null }>(
  rows: T[],
  weekKey: string,
): Promise<(T & { yoklama?: EtutYoklamaDurum })[]> {
  const assigned = rows.filter((r) => r.studentId);
  if (assigned.length === 0) return rows;
  const dates = Array.from({ length: 7 }, (_, i) => dateStrForWeekDay(weekKey, i));
  const recs = await tdb().attendance.findMany({
    where: { date: { in: dates }, lessonNo: { in: assigned.map((r) => `e${r.id}`) } },
    select: { date: true, lessonNo: true, records: true },
  });
  const map = buildEtutYoklamaMap(assigned, recs, (i) => dates[i]);
  return rows.map((r) => (map[r.id] ? { ...r, yoklama: map[r.id] } : r));
}
