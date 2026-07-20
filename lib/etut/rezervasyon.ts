import { getAllTeachers, getAllStudents, type EtutSablonu } from '@/lib/slots';
import { allowedBranchesForClass, MATH_FAMILY } from '@/lib/constants';
import { HttpError } from '@/lib/errors';
import type { Session } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { getWeekReservations, resolveEffective } from './reservations';
import { levelPoolForGroup } from './level-pool';
import { bookEtut, cancelEtutV2 } from './booking';

// Etüt rezervasyon iş kuralları — Faz 2b'den itibaren gerçek iş mantığı lib/etut/booking.ts
// (bookEtut/cancelEtutV2) + lib/etut/booking-rules.ts (decideBooking) içinde yaşıyor.
// BU DOSYADA KALANLAR:
//   1) Saf kural yardımcıları (birim testli — timeConflicts/branchConflicts/mathFamilyConflict/
//      pickAllowedBranches) — Task 6 ile app/api/slots/route.ts artık pickAllowedBranches'i
//      KULLANMIYOR (levelPoolForGroup'a geçti, §4a); fonksiyon yalnız birim testler için canlı
//      kalıyor (rezervasyon.test.ts). decideBooking KENDİ eşdeğerini taşıyor (kopya değil —
//      decideBooking SlotBooking tarafını da kapsıyor, buradakiler daha dar/eski JSON-döneminden
//      kalma imza).
//   2) reserveEtut/cancelEtut — ESKİ imza (EtutActor), İNCE ADAPTÖR: yalnız mobil route
//      (app/api/mobile/v1/etut/reserve) hâlâ bunları çağırıyor (Task 7'de doğrudan
//      bookEtut/cancelEtutV2'ye geçecek). Gövdeleri artık JSON'a DOKUNMUYOR — pseudo-Session
//      kurup bookEtut/cancelEtutV2'ye delege ediyor, dönüş şeklini ESKİ EtutSablonu sözleşmesine
//      geri çeviriyor (mobil route hâlâ etut.start/end/branch alanlarını okuyor).
//   3) listBookableEtuts — mobil "rezerve edilebilir etütler" listesi, artık EtutSablon
//      TABLOSUNDAN (JSON programTemplate DEĞİL) + EtutReservation efektif doluluğundan okur.
//      Branş adayları artık sınıf-listesi DEĞİL öğrencinin DÜZEY havuzu (levelPoolForGroup,
//      spec §4a — bookEtut'un autoPickBranch'iyle AYNI kaynak, tutarlılık için).

export interface EtutActor {
  role: string;
  id: string;
  isManager: boolean; // müdür/rehber (readOnly değil) — Kural 2/3 muafiyeti
}

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

// ── reserveEtut/cancelEtut — İNCE ADAPTÖR (eski imza, mobil route için) ──────
//
// EtutActor'da session'ın kendisi yok — yalnız role/id/isManager. bookEtut/cancelEtutV2
// içindeki canManage(session)/isReadOnlyCounselor(session) çağrıları GERÇEK bir Session
// (JWT payload) bekler; burada onu YENİDEN HESAPLAMAK yerine (actor.isManager zaten
// canManage(session) ile üretilmişti — route'larda `isManager: await canManage(session)`)
// bookEtut/cancelEtutV2'nin opsiyonel `precomputed` parametresiyle bypass ediyoruz.
//
// Formül: precomputed.isManager = actor.isManager (birebir). precomputed.readOnlyCounselor:
// lib/auth.ts canManage, counselor için `!perms.counselor.readOnly` döner — yani counselor
// rolünde isManager===false ⇔ readOnly===true (canManage'in TEK counselor dalı budur;
// director için isManager DAİMA true, diğer roller için isManager DAİMA false — ikisinde de
// readOnlyCounselor anlamsız/false). Bu yüzden `role==='counselor' && !isManager` GÜVENİLİR
// bir türetmedir (bkz. lib/auth.ts:78-85 — tek okunan alan session.role).
function precomputedFrom(actor: EtutActor): { isManager: boolean; readOnlyCounselor: boolean } {
  return { isManager: actor.isManager, readOnlyCounselor: actor.role === 'counselor' && !actor.isManager };
}

// Pseudo-Session — bookEtut/cancelEtutV2 yalnız session.role/session.id okur (hedef öğrenci
// çözümü) + audit'te session.name (actorFrom) — EtutActor'da isim YOK, audit'te 'bilinmiyor'
// görünür (mobil route'un tek çağıranı olduğu bu ince adaptör için kabul edilebilir; Task 7
// mobil route'u gerçek session'la doğrudan bookEtut'a bağlayınca isim de doğru akacak).
function actorSession(actor: EtutActor): Session {
  return { role: actor.role, id: actor.id };
}

// EtutReservation (tablo satırı) → EtutSablonu (eski JSON şekli) — mobil route'un
// etut.id/dayIndex/start/end/branch/studentName okuduğu ESKİ sözleşmeyi korur. id = etutId
// (legacyId, çağıranın zaten elinde olan değer — DB cuid'i asla sızmaz, sablon-service.ts'teki
// AYNI kural).
function toLegacyEtutShape(etutId: string, row: Awaited<ReturnType<typeof bookEtut>>): EtutSablonu {
  return {
    id: etutId,
    dayIndex: row.dayIndex,
    start: row.startsAt,
    end: row.endsAt,
    branch: row.dersBranch,
    studentId: row.studentId,
    studentName: row.studentName,
    studentCls: row.studentCls,
    bookedBy: row.bookedByRole,
    bookedAt: row.bookedAt.toISOString(),
  };
}

// Rezerve et — mobil route (app/api/mobile/v1/etut/reserve POST) çağırıyor. scope YOK →
// bookEtut 'WEEK'e düşer (öğrenci zaten decideBooking kural 2 gereği RECURRING yapamaz —
// bu adaptörün WEEK varsayımı isabetli, geçici bir kısıtlama DEĞİL).
export async function reserveEtut(
  actor: EtutActor,
  input: { teacherId: string; etutId: string; branch?: string; studentId?: string; weekKey?: string },
): Promise<EtutSablonu> {
  const row = await bookEtut(actorSession(actor), input, precomputedFrom(actor));
  return toLegacyEtutShape(input.etutId, row);
}

// İptal — mobil route (app/api/mobile/v1/etut/reserve DELETE) çağırıyor. weekKey/scope/reason
// YOK → cancelEtutV2 mevcut haftaya + 'week' kapsamına düşer (reserveEtut'un yazdığı AYNI kapsam).
export async function cancelEtut(actor: EtutActor, input: { teacherId: string; etutId: string }): Promise<void> {
  await cancelEtutV2(actorSession(actor), input, precomputedFrom(actor));
}

// ── listBookableEtuts — tablo-tabanlı (Faz 2b Task 5) ─────────────────────────
// Öğrencinin bu hafta REZERVE EDEBİLECEĞİ etütler (mobil ekran listesi).
// Öğrencinin grubuna açık öğretmenlerin, bu hafta efektif-aktif şablonları (EtutSablon
// deletedAt:null + aktif/pasifHaftalar); her biri için doluluk/sahiplik EtutReservation
// efektif satırından (resolveEffective — WEEK önce, sonra RECURRING), branş adayları
// öğretmen branşları ∩ öğrencinin DÜZEY havuzu (levelPoolForGroup — spec §4a, sınıf
// listesi DEĞİL; bookEtut'un autoPickBranch'iyle AYNI kaynak).
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
    levelPoolForGroup(student.group),
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
