import { NextResponse } from 'next/server';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { slotsForDay, ALL_DAYS } from '@/lib/constants';

// program:{teacherId}
// → { [dayIndex]: { [slotId]: { type: 'ders'|'etut'|null, cls?, studentId?, studentName?, studentCls?, fixed? } } }

function programKey(teacherId) {
  return `program:${teacherId}`;
}

export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const teacherId = searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const data = await redis.get(programKey(teacherId));
  return NextResponse.json(data || {});
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { teacherId, program } = await req.json();
  if (!teacherId || !program) {
    return NextResponse.json({ error: 'teacherId ve program gerekli' }, { status: 400 });
  }

  await redis.set(programKey(teacherId), program);

  // Etüt slotlarını bu haftanın grid'ine uygula
  // program'daki fixed:true etüt slotlarını haftalık slot grid'ine yaz
  const { getWeekKey, slotKey } = await import('@/lib/slots');
  const weekKey = getWeekKey();
  const pipeline = redis.pipeline();

  for (const day of ALL_DAYS) {
    const slots = slotsForDay(day.index);
    for (const slot of slots) {
      const slotEntry = program[String(day.index)]?.[slot.id];
      const k = slotKey(weekKey, teacherId, day.index, slot.id);

      if (!slotEntry || slotEntry.type === null) {
        // Boş slot — kapalı
        pipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
      } else if (slotEntry.type === 'etut') {
        if (slotEntry.studentId) {
          // Dolu etüt slotu
          pipeline.set(k, {
            booked: true,
            disabled: false,
            studentId: slotEntry.studentId,
            studentName: slotEntry.studentName || '',
            studentCls: slotEntry.studentCls || '',
            bookedBy: 'director',
            fixed: !!slotEntry.fixed,
          }, { ex: 60 * 60 * 24 * 16 });
        } else {
          // Açık etüt slotu (öğrenci rezervasyon yapabilir)
          pipeline.set(k, { booked: false, disabled: false }, { ex: 60 * 60 * 24 * 16 });
        }
      } else if (slotEntry.type === 'ders') {
        // Ders slotu — etüt rezervasyonuna kapalı
        pipeline.set(k, { booked: false, disabled: true }, { ex: 60 * 60 * 24 * 16 });
      }
    }
  }

  await pipeline.exec();
  return NextResponse.json({ ok: true });
}
