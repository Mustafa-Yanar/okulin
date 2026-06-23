import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import { notifyAbsentParents } from '@/lib/notify';
import { tdb } from '@/lib/sqldb';
import { useSql } from '@/lib/usesql';

export const runtime = 'nodejs'; // push web-push (Node crypto) gerektirir

const AttendancePostSchema = z.object({
  date: z.string().min(1).max(40),
  cls: z.string().min(1).max(40),
  lessonNo: z.union([z.string().max(20), z.number()]),
  attendance: z.record(z.enum(['var', 'gec', 'yok'])),
});

// attendance:{YYYY-MM-DD}:{teacherId}:{cls}:{lessonNo}
// → { [studentId]: 'var' | 'gec' | 'yok' }

function attendanceKey(date, teacherId, cls, lessonNo) {
  return `attendance:${date}:${teacherId}:${cls}:${lessonNo}`;
}

export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const teacherId = searchParams.get('teacherId');
  const cls = searchParams.get('cls');
  const lessonNo = searchParams.get('lessonNo');

  if (!date || !teacherId || !cls || !lessonNo) {
    return NextResponse.json({ error: 'date, teacherId, cls ve lessonNo gerekli' }, { status: 400 });
  }

  if (useSql()) {
    const teacher = await tdb().teacher.findFirst({ where: { legacyId: teacherId } });
    if (!teacher) return NextResponse.json({});
    const att = await tdb().attendance.findFirst({
      where: { date, teacherId: teacher.id, cls, lessonNo: String(lessonNo) },
    });
    return NextResponse.json(att?.records || {});
  }

  const data = await redis.get(attendanceKey(date, teacherId, cls, lessonNo));
  return NextResponse.json(data || {});
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, AttendancePostSchema);
  if (!parsed.ok) return parsed.response;
  const { date, cls, lessonNo, attendance } = parsed.data;

  if (useSql()) {
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
        data: { date, teacherId: teacher.id, cls, lessonNo: lessonNoStr, records: attendance },
      });
    }
    await notifyAbsentParents(date, attendance);
    return NextResponse.json({ ok: true });
  }

  const key = attendanceKey(date, session.id, cls, lessonNo);
  await redis.set(key, attendance, { ex: 60 * 60 * 24 * 90 });

  // "Gelmedi" tetikleyicisi — yok işaretli öğrencilerin velilerine push (best-effort, bir kez/gün)
  await notifyAbsentParents(date, attendance);

  return NextResponse.json({ ok: true });
}
