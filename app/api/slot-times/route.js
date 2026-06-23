import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES, DEFAULT_ETUT_SURESI, DEFAULT_MOLA_SURESI } from '@/lib/constants';
import { parseBody, z } from '@/lib/validate';
import { useSql } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Şekil doğrulaması — saat/sıra mantığı aşağıda ayrıca kontrol edilir.
const zSlotArr = z.array(z.object({ start: z.string().max(10), end: z.string().max(10) }).passthrough());
const SlotTimesSchema = z.object({
  weekday: zSlotArr,
  weekend: zSlotArr,
  // Etüt takvimi ayarları (opsiyonel — eski client'lar göndermeyebilir)
  etutSuresi: z.number().int().min(5).max(300).optional(),
  molaSuresi: z.number().int().min(0).max(120).optional(),
});

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

  if (useSql()) {
    const cfg = await tdb().tenantConfig.findFirst();
    const stored = cfg?.slotTimes;
    return NextResponse.json({
      weekday: stored?.weekday || DEFAULT_WEEKDAY_TIMES,
      weekend: stored?.weekend || DEFAULT_WEEKEND_TIMES,
      etutSuresi: stored?.etutSuresi ?? DEFAULT_ETUT_SURESI,
      molaSuresi: stored?.molaSuresi ?? DEFAULT_MOLA_SURESI,
    });
  }

  const stored = await redis.get('slot_times');
  return NextResponse.json({
    weekday: stored?.weekday || DEFAULT_WEEKDAY_TIMES,
    weekend: stored?.weekend || DEFAULT_WEEKEND_TIMES,
    etutSuresi: stored?.etutSuresi ?? DEFAULT_ETUT_SURESI,
    molaSuresi: stored?.molaSuresi ?? DEFAULT_MOLA_SURESI,
  });
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, SlotTimesSchema);
  if (!parsed.ok) return parsed.response;
  const { weekday, weekend, etutSuresi, molaSuresi } = parsed.data;
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

  if (useSql()) {
    const cfg = await tdb().tenantConfig.findFirst();
    const prev = cfg?.slotTimes;
    const newSlotTimes = {
      weekday, weekend,
      etutSuresi: etutSuresi ?? prev?.etutSuresi ?? DEFAULT_ETUT_SURESI,
      molaSuresi: molaSuresi ?? prev?.molaSuresi ?? DEFAULT_MOLA_SURESI,
    };
    if (cfg) {
      await tdb().tenantConfig.update({
        where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } },
        data: { slotTimes: newSlotTimes },
      });
    } else {
      await tdb().tenantConfig.create({ data: { slotTimes: newSlotTimes } });
    }
    return NextResponse.json({ ok: true });
  }

  // Mevcut etüt/mola ayarlarını koru (gönderilmezse), gönderilmişse güncelle
  const prev = await redis.get('slot_times');
  await redis.set('slot_times', {
    weekday,
    weekend,
    etutSuresi: etutSuresi ?? prev?.etutSuresi ?? DEFAULT_ETUT_SURESI,
    molaSuresi: molaSuresi ?? prev?.molaSuresi ?? DEFAULT_MOLA_SURESI,
  });
  return NextResponse.json({ ok: true });
}
