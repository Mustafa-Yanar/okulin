import { NextResponse } from 'next/server';
import { withAuth, canManage } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { getAllTeachers, getAllStudents, slotStartTime, getProgramTemplate, setProgramTemplate, type EtutSablonu } from '@/lib/slots';
import {
  ALL_DAYS,
  getWeekKey,
  allowedBranchesForClass,
  MATH_FAMILY,
} from '@/lib/constants';

// Serbest etüt şablonuna öğrenci REZERVASYONU (birebir).
// POST  → öğrenci kendini (veya müdür bir öğrenciyi) etüde yazar
// DELETE → rezervasyonu iptal eder
// Eski slot-etüt (/api/slots) ile aynı kuralları taşır ama veri = program:<tid>.etutSablonlari[].studentId
// program:<teacherId>.etutSablonlari = [ { id, dayIndex, start, end, aktif, pasifHaftalar?, studentId?, ... } ]

const PostSchema = z.object({
  teacherId: zId,
  etutId: z.string().max(20),
  branch: z.string().max(60).optional(),
  studentId: zId.optional(), // müdür/öğretmen başka öğrenci için yazarsa
  weekKey: z.string().max(40).optional(),
});

const DeleteSchema = z.object({
  teacherId: zId,
  etutId: z.string().max(20),
});

// Bir şablon verilen haftada efektif aktif mi?
function aktifThisWeek(sb: EtutSablonu, weekKey: string): boolean {
  if (sb.aktif === false) return false;
  if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
  return true;
}

// Bir öğrencinin bu hafta yazılı olduğu TÜM etüt şablonlarını (tüm öğretmenlerde) topla.
// [{ teacherId, sb }] döner. Çakışma kontrolleri için.
async function studentBookedEtuts(studentId: string, weekKey: string) {
  const teachers = await getAllTeachers();
  const out: { teacherId: string; sb: EtutSablonu }[] = [];
  for (const t of teachers) {
    const prog = await getProgramTemplate(t.id); // SQL-aware
    const list: EtutSablonu[] = Array.isArray(prog.etutSablonlari) ? (prog.etutSablonlari as EtutSablonu[]) : [];
    for (const sb of list) {
      if (sb.studentId === studentId && aktifThisWeek(sb, weekKey)) {
        out.push({ teacherId: t.id, sb });
      }
    }
  }
  return out;
}

// POST — rezerve et
export const POST = withAuth(async (req, ctx, session) => {
  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, etutId, branch, weekKey: wk, studentId } = parsed.data;
  const weekKey = wk || getWeekKey();
  // Salt-okunur rehber yönetici sayılmaz → başkası adına etüt yazamaz (student/teacher muaf).
  const manager = await canManage(session);

  // Hedef öğrenci: öğrenci kendini, müdür/öğretmen başkasını yazabilir
  let targetStudentId: string | undefined;
  if (session.role === 'student') {
    targetStudentId = session.id;
  } else if (session.role === 'teacher') {
    if (teacherId !== session.id) {
      return NextResponse.json({ error: 'Sadece kendi etütlerinize öğrenci yazabilirsiniz' }, { status: 403 });
    }
    targetStudentId = studentId;
  } else if (manager) {
    targetStudentId = studentId;
  } else {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (!targetStudentId) return NextResponse.json({ error: 'Öğrenci belirtilmedi' }, { status: 400 });

  const allStudents = await getAllStudents(); // SQL-aware
  const targetStudent = allStudents.find(s => s.id === targetStudentId);
  if (!targetStudent) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const allTeachers = await getAllTeachers(); // SQL-aware (branches zaten dizi olarak gelir)
  const teacher = allTeachers.find(t => t.id === teacherId);
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

  // Öğretmen grup etiketi + öğrencinin o gruba ait olması
  const allowedGroups = teacher.allowedGroups || [];
  if (allowedGroups.length === 0) {
    return NextResponse.json({ error: 'Bu öğretmenin grup etiketi tanımlanmamış' }, { status: 400 });
  }
  if (!allowedGroups.includes(targetStudent.group)) {
    return NextResponse.json({ error: 'Bu öğrenci bu öğretmenin etütlerine kayıt olamaz' }, { status: 400 });
  }

  // Şablonu bul
  const template = await getProgramTemplate(teacherId); // SQL-aware
  const list: EtutSablonu[] = Array.isArray(template.etutSablonlari) ? (template.etutSablonlari as EtutSablonu[]) : [];
  const idx = list.findIndex(s => s.id === etutId);
  if (idx === -1) return NextResponse.json({ error: 'Etüt bulunamadı' }, { status: 404 });
  const sb = { ...list[idx] };

  if (!aktifThisWeek(sb, weekKey)) {
    return NextResponse.json({ error: 'Bu etüt bu hafta aktif değil' }, { status: 400 });
  }
  // Birebir: zaten doluysa (başkası) reddet
  if (sb.studentId && sb.studentId !== targetStudentId) {
    return NextResponse.json({ error: 'Bu etüt zaten dolu' }, { status: 400 });
  }
  if (sb.studentId === targetStudentId) {
    return NextResponse.json({ error: 'Bu öğrenci zaten bu etüde kayıtlı' }, { status: 400 });
  }

  // Geçmiş kontrolü — geçmişe rezervasyon yok (müdür dahil; tarih/saat geçmiş)
  const startAt = slotStartTime(weekKey, sb.dayIndex, sb.start);
  if (startAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Geçmiş bir etüde rezervasyon yapılamaz' }, { status: 400 });
  }

  // Branş (ders) doğrulaması — öğretmen verebilmeli VE öğrenci sınıfı görebilmeli
  const studentAllowed = allowedBranchesForClass(targetStudent.cls);
  let bookingBranch: string | undefined = branch;
  if (!bookingBranch) {
    const candidates = (teacher.branches || []).filter(b => studentAllowed.includes(b));
    if (candidates.length === 1) bookingBranch = candidates[0];
  }
  if (!bookingBranch || !(teacher.branches || []).includes(bookingBranch) || !studentAllowed.includes(bookingBranch)) {
    return NextResponse.json({ error: 'Geçersiz veya seçilmemiş ders. Uygun bir ders seçin.' }, { status: 400 });
  }

  // Çakışma kontrolleri — öğrencinin bu hafta yazılı olduğu diğer etütler
  const booked = await studentBookedEtuts(targetStudentId, weekKey);

  // Kural 1: Aynı gün aynı saatte başka etüt (kimse bypass edemez)
  const timeConflict = booked.some(b => b.sb.dayIndex === sb.dayIndex && b.sb.start === sb.start);
  if (timeConflict) {
    return NextResponse.json({ error: 'Bu öğrenci aynı gün aynı saatte başka bir etüde kayıtlı' }, { status: 400 });
  }

  // Müdür/rehber branş ve matematik ailesi kurallarını bypass edebilir
  if (!manager) {
    // Kural 2: Aynı dersten ikinci etüt
    const branchConflict = booked.some(b => b.sb.branch === bookingBranch);
    if (branchConflict) {
      return NextResponse.json({ error: `Bu öğrenci bu hafta ${bookingBranch} dersinden zaten etüt almış` }, { status: 400 });
    }
    // Kural 3: Matematik ailesi (TYT/AYT/Geometri) — yalnız birinden
    if (MATH_FAMILY.includes(bookingBranch)) {
      const mathConflict = booked.some(b => MATH_FAMILY.includes(b.sb.branch as string));
      if (mathConflict) {
        return NextResponse.json({ error: 'Bu öğrenci bu hafta matematik (TYT/AYT/Geometri) etüdü zaten almış' }, { status: 400 });
      }
    }
  }

  // Yaz
  sb.studentId = targetStudentId;
  sb.studentName = targetStudent.name;
  sb.studentCls = targetStudent.cls || '';
  sb.branch = bookingBranch;
  sb.bookedBy = session.role;
  sb.bookedAt = new Date().toISOString();
  list[idx] = sb;
  template.etutSablonlari = list;
  await setProgramTemplate(teacherId, template); // SQL-aware

  return NextResponse.json({ ok: true, etut: sb });
});

// DELETE — rezervasyonu iptal et
export const DELETE = withAuth(async (req, ctx, session) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, etutId } = parsed.data;

  const template = await getProgramTemplate(teacherId); // SQL-aware
  const list: EtutSablonu[] = Array.isArray(template.etutSablonlari) ? (template.etutSablonlari as EtutSablonu[]) : [];
  const idx = list.findIndex(s => s.id === etutId);
  if (idx === -1) return NextResponse.json({ error: 'Etüt bulunamadı' }, { status: 404 });
  const sb = { ...list[idx] };

  if (!sb.studentId) {
    return NextResponse.json({ error: 'Bu etütte rezervasyon yok' }, { status: 404 });
  }
  // Yetki: öğrenci sadece kendi rezervasyonunu, öğretmen kendi etüdünü, müdür hepsini
  if (session.role === 'student' && sb.studentId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (session.role === 'teacher' && teacherId !== session.id) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  // Salt-okunur rehber iptal edemez (canManage false döner); müdür + öğrenci/öğretmen muaf.
  if (!(await canManage(session)) && session.role !== 'student' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Atamayı temizle (şablon kalır, sadece öğrenci boşalır)
  delete sb.studentId;
  delete sb.studentName;
  delete sb.studentCls;
  delete sb.branch;
  delete sb.bookedBy;
  delete sb.bookedAt;
  list[idx] = sb;
  template.etutSablonlari = list;
  await setProgramTemplate(teacherId, template); // SQL-aware

  return NextResponse.json({ ok: true });
});
