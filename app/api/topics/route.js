import { NextResponse } from 'next/server';
import { getSession, canReadStudent } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

// topics:{studentId} -> { [subject]: { [topicIndex]: percent 0-100 } } (SQL: Topic.data)

const TopicsPostSchema = z.object({
  studentId: zId.optional(),
  subject: z.string().min(1).max(200),
  topicIndex: z.union([z.string().max(20), z.number()]),
  percent: z.union([z.string().max(20), z.number()]).optional(),
});

// GET /api/topics?studentId=...
// Öğrenci kendi kaydını, müdür/öğretmen herhangi bir öğrencininkini görür.
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  let studentId = searchParams.get('studentId');

  if (session.role === 'student') {
    studentId = session.id;
  } else if (session.role === 'parent') {
    if (!canReadStudent(session, studentId)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  } else if ((session.role !== 'director' && session.role !== 'counselor') && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  const row = await tdb().topic.findFirst({ where: { studentId } });
  return NextResponse.json({ topics: row?.data || {} });
}

// POST /api/topics
// Body: { studentId?, subject, topicIndex, percent }
// Öğrenci sadece kendi kaydını, müdür herhangi bir öğrencininkini günceller.
// Öğretmen yazamaz (salt okunur).
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const parsed = await parseBody(req, TopicsPostSchema);
  if (!parsed.ok) return parsed.response;
  let { studentId, subject, topicIndex, percent } = parsed.data;

  if (session.role === 'student') {
    studentId = session.id;
  } else if ((session.role === 'director' || session.role === 'counselor')) {
    if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const p = Math.max(0, Math.min(100, parseInt(percent) || 0));
  const idx = String(parseInt(topicIndex));

  const existing = await tdb().topic.findFirst({ where: { studentId } });
  const data = existing?.data || {};
  if (!data[subject]) data[subject] = {};
  data[subject][idx] = p;
  if (existing) await tdb().topic.update({ where: { id: existing.id }, data: { data } });
  else await tdb().topic.create({ data: { studentId, data } });
  return NextResponse.json({ ok: true });
}
