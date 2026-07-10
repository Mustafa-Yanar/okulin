import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { DEFAULT_ETUT_SURESI, DEFAULT_MOLA_SURESI, MAX_SLOTS_PER_DAY } from '@/lib/constants';
import { normalizeSlotTimes } from '@/lib/slots';
import { parseBody, z } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';

// 7-GÜN slot saatleri. Depolama: TenantConfig.slotTimes = { days: {0..6:{count,times}}, etutSuresi, molaSuresi }.
// GET normalize edilmiş 7-gün objesi döndürür (eski {weekday,weekend} kayıtları da genişletilir).
// POST yeni formatı doğrular + kaydeder.
const zSlotArr = z.array(z.object({ start: z.string().max(10), end: z.string().max(10) }).passthrough());
const zDayConfig = z.object({
  count: z.number().int().min(0).max(MAX_SLOTS_PER_DAY),
  times: zSlotArr,
});
const SlotTimesSchema = z.object({
  // days: { "0": {count, times}, ..., "6": {...} } — 7 gün zorunlu.
  days: z.record(z.string(), zDayConfig),
  etutSuresi: z.number().int().min(5).max(300).optional(),
  molaSuresi: z.number().int().min(0).max(120).optional(),
});

function isValidTime(t: unknown): t is string {
  if (typeof t !== 'string') return false;
  const m = t.match(/^(\d{2}):(\d{2})$/);
  if (!m) return false;
  const hh = parseInt(m[1]);
  const mm = parseInt(m[2]);
  return hh >= 0 && hh < 24 && mm >= 0 && mm < 60;
}

function toMinutes(t: string): number {
  const [hh, mm] = t.split(':').map(n => parseInt(n));
  return hh * 60 + mm;
}

const GUN_ADI = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export const GET = withAuth(async () => {
  const cfg = await tdb().tenantConfig.findFirst();
  const stored = cfg?.slotTimes as { etutSuresi?: number; molaSuresi?: number } | null | undefined; // Json alanı
  const { days } = normalizeSlotTimes(stored); // eski {weekday,weekend} da 7 güne genişler
  return NextResponse.json({
    days,
    etutSuresi: stored?.etutSuresi ?? DEFAULT_ETUT_SURESI,
    molaSuresi: stored?.molaSuresi ?? DEFAULT_MOLA_SURESI,
  });
});

export const POST = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, SlotTimesSchema);
  if (!parsed.ok) return parsed.response;
  const { days, etutSuresi, molaSuresi } = parsed.data;

  // 7 günün hepsi gelmeli.
  for (let d = 0; d < 7; d++) {
    if (!days[String(d)]) {
      return NextResponse.json({ error: `${GUN_ADI[d]} günü eksik` }, { status: 400 });
    }
  }

  // Her gün: count = times.length, saatler geçerli, sıralı ve çakışmasız olmalı.
  const cleanDays: Record<number, { count: number; times: { start: string; end: string }[] }> = {};
  for (let d = 0; d < 7; d++) {
    const dc = days[String(d)];
    const times = dc.times.slice(0, dc.count); // count kadarını al (fazla saat gelirse buda)
    if (times.length !== dc.count) {
      return NextResponse.json({ error: `${GUN_ADI[d]}: ${dc.count} ders için ${dc.count} saat girilmeli` }, { status: 400 });
    }
    for (let i = 0; i < times.length; i++) {
      const s = times[i];
      if (!isValidTime(s.start) || !isValidTime(s.end)) {
        return NextResponse.json({ error: `${GUN_ADI[d]} ${i + 1}. ders: geçersiz saat` }, { status: 400 });
      }
      if (toMinutes(s.end) <= toMinutes(s.start)) {
        return NextResponse.json({ error: `${GUN_ADI[d]} ${i + 1}. ders: bitiş başlangıçtan sonra olmalı` }, { status: 400 });
      }
      if (i > 0 && toMinutes(s.start) < toMinutes(times[i - 1].end)) {
        return NextResponse.json({ error: `${GUN_ADI[d]} ${i + 1}. ders: önceki dersin bitişinden sonra başlamalı` }, { status: 400 });
      }
    }
    cleanDays[d] = { count: times.length, times: times.map(t => ({ start: t.start, end: t.end })) };
  }

  const cfg = await tdb().tenantConfig.findFirst();
  const prev = cfg?.slotTimes as { etutSuresi?: number; molaSuresi?: number } | null | undefined; // Json alanı
  const newSlotTimes = {
    days: cleanDays,
    etutSuresi: etutSuresi ?? prev?.etutSuresi ?? DEFAULT_ETUT_SURESI,
    molaSuresi: molaSuresi ?? prev?.molaSuresi ?? DEFAULT_MOLA_SURESI,
  };
  if (cfg) {
    await tdb().tenantConfig.update({
      where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } },
      data: { slotTimes: newSlotTimes },
    });
  } else {
    await tdb().tenantConfig.create({ data: withScope({ slotTimes: newSlotTimes }) });
  }
  return NextResponse.json({ ok: true });
});
