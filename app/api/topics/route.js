import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';

// topics:{studentId} -> { [subject]: { [topicIndex]: percent 0-100 } }
const key = (studentId) => `topics:${studentId}`;

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
  } else if (session.role !== 'director' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  const data = (await redis.get(key(studentId))) || {};
  return NextResponse.json({ topics: data });
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
  } else if (session.role === 'director') {
    if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  } else {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const p = Math.max(0, Math.min(100, parseInt(percent) || 0));
  const idx = String(parseInt(topicIndex));

  const data = (await redis.get(key(studentId))) || {};
  if (!data[subject]) data[subject] = {};
  data[subject][idx] = p;
  await redis.set(key(studentId), data);

  return NextResponse.json({ ok: true });
}
