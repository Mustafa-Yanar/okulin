import { getAllTeachers, getAllStudents } from '@/lib/slots';
import { allowedBranchesForClass, MATH_FAMILY } from '@/lib/constants';
import { HttpError } from '@/lib/errors';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { getWeekReservations, resolveEffective } from './reservations';
import { levelPoolForStudent } from './level-pool';

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
