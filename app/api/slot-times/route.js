import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES } from '@/lib/constants';
import { parseBody, z } from '@/lib/validate';

// Şekil doğrulaması — saat/sıra mantığı aşağıda ayrıca kontrol edilir.
const zSlotArr = z.array(z.object({ start: z.string().max(10), end: z.string().max(10) }).passthrough());
const SlotTimesSchema = z.object({ weekday: zSlotArr, weekend: zSlotArr });

// slot_times → { weekday: [{start, end}, ...], weekend: [{start, end}, ...] }

function isValidTime(t) {
  if (typeof t !== 'string') return false;
  const m = t.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const hh = parseInt(m[1]);
  const mm = parseInt(m[2]);
  return hh >= 0 && hh < 24 && mm >= 0 && mm < 60;
}

function toMinutes(t) {
  const [hh, mm] = t.split(':').map(n => parseInt(n));
  return hh * 60 + mm;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const stored = await redis.get('slot_times');
  return NextResponse.json({
    weekday: stored?.weekday || DEFAULT_WEEKDAY_TIMES,
    weekend: stored?.weekend || DEFAULT_WEEKEND_TIMES,
  });
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, SlotTimesSchema);
  if (!parsed.ok) return parsed.response;
  const { weekday, weekend } = parsed.data;
  if (weekday.length !== 12 || weekend.length !== 12) {
    return NextResponse.json({ error: 'Her gün tipi için 12 slot olmalı' }, { status: 400 });
  }

  // Doğrulama: her slotun start < end olmalı, ardışık slot start'ı önceki end'den >= olmalı
  for (const arr of [weekday, weekend]) {
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      if (!isValidTime(s.start) || !isValidTime(s.end)) {
        return NextResponse.json({ error: `Geçersiz saat: ${i + 1}. slot` }, { status: 400 });
      }
      if (toMinutes(s.end) <= toMinutes(s.start)) {
        return NextResponse.json({ error: `${i + 1}. slot bitişi başlangıçtan sonra olmalı` }, { status: 400 });
      }
      if (i > 0 && toMinutes(s.start) < toMinutes(arr[i - 1].end)) {
        return NextResponse.json({ error: `${i + 1}. slot başlangıcı önceki slotun bitişinden sonra olmalı` }, { status: 400 });
      }
    }
  }

  await redis.set('slot_times', { weekday, weekend });
  return NextResponse.json({ ok: true });
}
