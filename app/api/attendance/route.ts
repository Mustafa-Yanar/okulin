import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import { notifyAbsentParents } from '@/lib/notify';
import { tdb, withScope } from '@/lib/sqldb';

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

const AttendancePostSchema = z.object({
  date: z.string().min(1).max(40),
  cls: z.string().min(1).max(40),
  // Etüt yoklamasında lessonNo = 'e' + şablon id'si; id'ler UUID göçünden beri
  // 36 karakter ('e'+36=37) — eski max(20) etüt yoklamasını 400 ile kesiyordu.
  lessonNo: z.union([z.string().max(60), z.number()]),
  attendance: z.record(z.enum(['var', 'gec', 'yok'])),
});

// Attendance.records: { [studentId]: 'var' | 'gec' | 'yok' }

export const GET = withAuth(async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const teacherId = searchParams.get('teacherId');
  const cls = searchParams.get('cls');
  const lessonNo = searchParams.get('lessonNo');

  if (!date || !teacherId || !cls || !lessonNo) {
    return NextResponse.json({ error: 'date, teacherId, cls ve lessonNo gerekli' }, { status: 400 });
  }

  // Ham yoklama sözlüğü öğrenci kimliklerini ve durumlarını taşır. Tek üretim tüketicisi
  // TeacherPanel'dir; öğretmen yalnız kendi kaydını, müdür/rehber denetim amacıyla tümünü
  // okuyabilir. Öğrenci/veli/muhasebe için özetlenmiş ayrı yüzeyler kullanılır.
  if (session.role === 'teacher') {
    if (teacherId !== session.id) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  } else if (session.role !== 'director' && session.role !== 'counselor') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const teacher = await tdb().teacher.findFirst({ where: { legacyId: teacherId } });
  if (!teacher) return NextResponse.json({});
  const att = await tdb().attendance.findFirst({
    where: { date, teacherId: teacher.id, cls, lessonNo: String(lessonNo) },
  });
  return NextResponse.json(att?.records || {});
});

export const POST = withAuth(['teacher'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, AttendancePostSchema);
  if (!parsed.ok) return parsed.response;
  const { date, cls, lessonNo, attendance } = parsed.data;

  const teacher = await tdb().teacher.findFirst({ where: { legacyId: session.id } });
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
  const lessonNoStr = String(lessonNo);
  const existing = await tdb().attendance.findFirst({
    where: { date, teacherId: teacher.id, cls, lessonNo: lessonNoStr },
  });
  if (existing) {
    await tdb().attendance.update({ where: { id: existing.id }, data: { records: attendance } });
  } else {
    await tdb().attendance.create({
      data: withScope({ date, teacherId: teacher.id, cls, lessonNo: lessonNoStr, records: attendance }),
    });
  }

  // "Gelmedi" tetikleyicisi — yok işaretli öğrencilerin velilerine push (best-effort, bir kez/gün)
  await notifyAbsentParents(date, attendance);

  return NextResponse.json({ ok: true });
});
