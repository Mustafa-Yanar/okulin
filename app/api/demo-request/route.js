import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { rawRedis } from '@/lib/tenant';
import { demoRatelimit, getClientIp, formatResetWait } from '@/lib/ratelimit';

// Landing demo/iletişim talebi: potansiyel kurum bilgilerini bırakır.
// Kurum-bağımsız (apex/landing'den çağrılır) → rawRedis (t: prefix YOK).
// Talepler global `demo:requests` listesinde (en yeni başta), süper-admin görür.
const LIST_KEY = 'demo:requests';
const MAX_KEEP = 200;

function clean(v, max) {
  return String(v ?? '').trim().slice(0, max);
}

export async function POST(req) {
  // Spam koruması (IP başına)
  const ip = getClientIp(req);
  const { success, reset } = await demoRatelimit.limit(ip);
  if (!success) {
    return NextResponse.json(
      { error: `Çok fazla talep gönderildi. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }

  // Honeypot: gizli alan dolmuşsa bot kabul et → sessizce başarı dön (bilgi sızdırma).
  if (clean(body.website, 200)) return NextResponse.json({ ok: true });

  const name = clean(body.name, 120);
  const org = clean(body.org, 120);
  const phone = clean(body.phone, 40);
  const email = clean(body.email, 160);
  const note = clean(body.note, 1000);

  if (name.length < 2) return NextResponse.json({ error: 'Lütfen adınızı girin.' }, { status: 400 });
  if (org.length < 2) return NextResponse.json({ error: 'Lütfen kurum adını girin.' }, { status: 400 });
  if (phone.length < 5) return NextResponse.json({ error: 'Lütfen geçerli bir telefon girin.' }, { status: 400 });

  const record = {
    id: randomUUID(),
    name, org, phone, email, note,
    ts: Date.now(),
    ip,
  };

  await rawRedis.lpush(LIST_KEY, JSON.stringify(record));
  await rawRedis.ltrim(LIST_KEY, 0, MAX_KEEP - 1);

  return NextResponse.json({ ok: true });
}
