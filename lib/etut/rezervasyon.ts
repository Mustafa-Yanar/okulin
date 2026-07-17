import {
  getAllTeachers,
  getAllStudents,
  getAllProgramTemplates,
  getProgramTemplate,
  setProgramTemplate,
  slotStartTime,
  etutAktifThisWeek,
  type EtutSablonu,
} from '@/lib/slots';
import { allowedBranchesForClass, MATH_FAMILY, getWeekKey } from '@/lib/constants';
import { HttpError } from '@/lib/errors';

// Etüt rezervasyon iş kuralları servisi (spec §9/6 — route'tan çıkarıldı, davranış birebir).
// Web route (etut-sablon/rezervasyon) + mobil route (mobile/v1/etut/reserve) bu servisi çağırır.

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

// Bir öğrencinin bu hafta yazılı TÜM etüt şablonları (tüm öğretmenlerde) — TEK sorgu
// (getAllProgramTemplates, Plan 4). Eski route öğretmen başına getProgramTemplate atıyordu;
// aynı sonuç kümesi, daha az sorgu (davranış-koruyan optimizasyon).
async function studentBookedEtuts(studentId: string, weekKey: string): Promise<{ teacherId: string; sb: EtutSablonu }[]> {
  const templates = await getAllProgramTemplates();
  const out: { teacherId: string; sb: EtutSablonu }[] = [];
  for (const t of templates) {
    const list: EtutSablonu[] = Array.isArray(t.template.etutSablonlari) ? (t.template.etutSablonlari as EtutSablonu[]) : [];
    for (const sb of list) {
      if (sb.studentId === studentId && etutAktifThisWeek(sb, weekKey)) out.push({ teacherId: t.legacyId, sb });
    }
  }
  return out;
}

// Rezerve et — route POST gövdesiyle BİREBİR kontrol sırası/metin/status.
export async function reserveEtut(
  actor: EtutActor,
  input: { teacherId: string; etutId: string; branch?: string; studentId?: string; weekKey?: string },
): Promise<EtutSablonu> {
  const { teacherId, etutId, branch } = input;
  const weekKey = input.weekKey || getWeekKey();

  // Hedef öğrenci: öğrenci kendini, öğretmen kendi etüdüne, yönetici başkasını
  let targetStudentId: string | undefined;
  if (actor.role === 'student') {
    targetStudentId = actor.id;
  } else if (actor.role === 'teacher') {
    if (teacherId !== actor.id) throw new HttpError(403, 'Sadece kendi etütlerinize öğrenci yazabilirsiniz');
    targetStudentId = input.studentId;
  } else if (actor.isManager) {
    targetStudentId = input.studentId;
  } else {
    throw new HttpError(403, 'Yetkisiz');
  }
  if (!targetStudentId) throw new HttpError(400, 'Öğrenci belirtilmedi');

  const allStudents = await getAllStudents();
  const targetStudent = allStudents.find((s) => s.id === targetStudentId);
  if (!targetStudent) throw new HttpError(404, 'Öğrenci bulunamadı');

  const allTeachers = await getAllTeachers();
  const teacher = allTeachers.find((t) => t.id === teacherId);
  if (!teacher) throw new HttpError(404, 'Öğretmen bulunamadı');

  const allowedGroups = teacher.allowedGroups || [];
  if (allowedGroups.length === 0) throw new HttpError(400, 'Bu öğretmenin grup etiketi tanımlanmamış');
  if (!allowedGroups.includes(targetStudent.group)) throw new HttpError(400, 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz');

  const template = await getProgramTemplate(teacherId);
  const list: EtutSablonu[] = Array.isArray(template.etutSablonlari) ? (template.etutSablonlari as EtutSablonu[]) : [];
  const idx = list.findIndex((s) => s.id === etutId);
  if (idx === -1) throw new HttpError(404, 'Etüt bulunamadı');
  const sb = { ...list[idx] };

  if (!etutAktifThisWeek(sb, weekKey)) throw new HttpError(400, 'Bu etüt bu hafta aktif değil');
  if (sb.studentId && sb.studentId !== targetStudentId) throw new HttpError(400, 'Bu etüt zaten dolu');
  if (sb.studentId === targetStudentId) throw new HttpError(400, 'Bu öğrenci zaten bu etüde kayıtlı');

  const startAt = slotStartTime(weekKey, sb.dayIndex, sb.start);
  if (startAt.getTime() <= Date.now()) throw new HttpError(400, 'Geçmiş bir etüde rezervasyon yapılamaz');

  const studentAllowed = allowedBranchesForClass(targetStudent.cls);
  let bookingBranch: string | undefined = branch;
  if (!bookingBranch) {
    const candidates = (teacher.branches || []).filter((b) => studentAllowed.includes(b));
    if (candidates.length === 1) bookingBranch = candidates[0];
  }
  if (!bookingBranch || !(teacher.branches || []).includes(bookingBranch) || !studentAllowed.includes(bookingBranch)) {
    throw new HttpError(400, 'Geçersiz veya seçilmemiş ders. Uygun bir ders seçin.');
  }

  const booked = await studentBookedEtuts(targetStudentId, weekKey);
  if (timeConflicts(booked.map((b) => b.sb), sb.dayIndex, sb.start)) {
    throw new HttpError(400, 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı');
  }
  if (!actor.isManager) {
    if (branchConflicts(booked.map((b) => b.sb), bookingBranch)) {
      throw new HttpError(400, `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış`);
    }
    if (mathFamilyConflict(booked.map((b) => b.sb), bookingBranch)) {
      throw new HttpError(400, 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış');
    }
  }

  sb.studentId = targetStudentId;
  sb.studentName = targetStudent.name;
  sb.studentCls = targetStudent.cls || '';
  sb.branch = bookingBranch;
  sb.bookedBy = actor.role;
  sb.bookedAt = new Date().toISOString();
  list[idx] = sb;
  template.etutSablonlari = list;
  await setProgramTemplate(teacherId, template);
  return sb;
}

// İptal — route DELETE gövdesiyle BİREBİR.
export async function cancelEtut(actor: EtutActor, input: { teacherId: string; etutId: string }): Promise<void> {
  const { teacherId, etutId } = input;
  const template = await getProgramTemplate(teacherId);
  const list: EtutSablonu[] = Array.isArray(template.etutSablonlari) ? (template.etutSablonlari as EtutSablonu[]) : [];
  const idx = list.findIndex((s) => s.id === etutId);
  if (idx === -1) throw new HttpError(404, 'Etüt bulunamadı');
  const sb = { ...list[idx] };
  if (!sb.studentId) throw new HttpError(404, 'Bu etütte rezervasyon yok');
  if (actor.role === 'student' && sb.studentId !== actor.id) throw new HttpError(403, 'Yetkisiz');
  if (actor.role === 'teacher' && teacherId !== actor.id) throw new HttpError(403, 'Yetkisiz');
  if (!actor.isManager && actor.role !== 'student' && actor.role !== 'teacher') throw new HttpError(403, 'Yetkisiz');

  delete sb.studentId; delete sb.studentName; delete sb.studentCls;
  delete sb.branch; delete sb.bookedBy; delete sb.bookedAt;
  list[idx] = sb;
  template.etutSablonlari = list;
  await setProgramTemplate(teacherId, template);
}

// Öğrencinin bu hafta REZERVE EDEBİLECEĞİ etütler (mobil ekran listesi).
// Öğrencinin grubuna açık öğretmenlerin, bu hafta efektif-aktif şablonları;
// her biri için o öğrencinin görebileceği branş adayları + doluluk/sahiplik.
export interface BookableEtut {
  teacherId: string;
  teacherName: string;
  etutId: string;
  dayIndex: number;
  start: string;
  end: string;
  branches: string[]; // öğrencinin seçebileceği ders adayları (öğretmen branşları ∩ sınıf dersleri)
  booked: boolean;    // başka öğrenci tarafından dolu
  mine: boolean;      // bu öğrencinin rezervasyonu
  branch: string | null; // mine ise rezerve edilen ders
}
export async function listBookableEtuts(studentId: string, weekKey: string): Promise<BookableEtut[]> {
  const [students, teachers, templates] = await Promise.all([getAllStudents(), getAllTeachers(), getAllProgramTemplates()]);
  const student = students.find((s) => s.id === studentId);
  if (!student) throw new HttpError(404, 'Öğrenci bulunamadı');
  const studentAllowed = allowedBranchesForClass(student.cls);
  const teacherById = new Map(teachers.map((t) => [t.id, t]));
  const out: BookableEtut[] = [];
  for (const tpl of templates) {
    const teacher = teacherById.get(tpl.legacyId);
    if (!teacher) continue;
    const allowedGroups = teacher.allowedGroups || [];
    // Öğrencinin grubuna kapalı öğretmenin etütleri listede gösterilmez (rezerve edilemez).
    const groupOk = allowedGroups.includes(student.group);
    const list: EtutSablonu[] = Array.isArray(tpl.template.etutSablonlari) ? (tpl.template.etutSablonlari as EtutSablonu[]) : [];
    for (const sb of list) {
      if (!etutAktifThisWeek(sb, weekKey)) continue;
      const mine = sb.studentId === studentId;
      if (!groupOk && !mine) continue; // kendi rezervasyonu farklı grup olsa bile görünsün (iptal için)
      const branches = (teacher.branches || []).filter((b) => studentAllowed.includes(b));
      out.push({
        teacherId: tpl.legacyId,
        teacherName: teacher.name,
        etutId: sb.id,
        dayIndex: sb.dayIndex,
        start: sb.start,
        end: sb.end,
        branches,
        booked: Boolean(sb.studentId) && !mine,
        mine,
        branch: mine ? (sb.branch ?? null) : null,
      });
    }
  }
  out.sort((a, b) => (a.dayIndex - b.dayIndex) || a.start.localeCompare(b.start));
  return out;
}
