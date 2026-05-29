import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';

const LessonScheduleSchema = z.object({ teacherId: zId, schedule: z.record(z.unknown()) });

// lesson_schedule:{teacherId} → { [dayIndex]: { [lessonNo]: cls | null } }
// Hafta içi (0-4): 6 ders, hafta sonu (5-6): 8 ders

function scheduleKey(teacherId) {
  return `lesson_schedule:${teacherId}`;
}

export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const data = await redis.get(scheduleKey(teacherId));
  return NextResponse.json(data || {});
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, LessonScheduleSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, schedule } = parsed.data;

  await redis.set(scheduleKey(teacherId), schedule);
  return NextResponse.json({ ok: true });
}
