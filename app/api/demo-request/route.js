import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { rawRedis } from '@/lib/tenant';
import { demoRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
import { sendEmail } from '@/lib/email';
import { isSqlEnabled } from '@/lib/usesql';
import { prisma } from '@/lib/prisma';

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
  ));
}

// Yeni demo talebini platform sahibine e-posta ile bildirir (lead kaçmasın).
// Hata fırlatmaz — talep zaten Redis'e yazıldı; mail sadece "haber ver" katmanı.
async function notifyOwner(rec) {
  const to = process.env.DEMO_NOTIFY_TO || 'mustafayanar54@gmail.com';
  const when = new Date(rec.ts).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const rows = [
    ['Ad', rec.name],
    ['Kurum', rec.org],
    ['Telefon', rec.phone],
    ['E-posta', rec.email || '—'],
    ['Not', rec.note || '—'],
    ['Tarih', when],
  ].map(([k, v]) => `<tr><td style="padding:6px 12px;color:#64748b;white-space:nowrap">${k}</td><td style="padding:6px 12px;color:#0f172a;font-weight:600">${esc(v)}</td></tr>`).join('');

  await sendEmail({
    to,
    replyTo: rec.email || undefined,
    subject: `Yeni demo talebi: ${rec.org} (${rec.name})`,
    text: `Yeni demo talebi\n\nAd: ${rec.name}\nKurum: ${rec.org}\nTelefon: ${rec.phone}\nE-posta: ${rec.email || '—'}\nNot: ${rec.note || '—'}\nTarih: ${when}\n\nSüper-admin panelinden de görebilirsin.`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
      <h2 style="margin:0 0 4px;color:#4338ca">okulin — Yeni Demo Talebi</h2>
      <p style="margin:0 0 16px;color:#64748b;font-size:13px">Landing sayfasından yeni bir kurum bilgilerini bıraktı.</p>
      <table style="border-collapse:collapse;font-size:14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">${rows}</table>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Süper-admin panelinde "Demo Talepleri" bölümünden de görebilir/silebilirsin.</p>
    </div>`,
  });
}

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
  const { success, reset } = await safeLimit(demoRatelimit, ip);
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

  if (isSqlEnabled()) {
    await prisma.demoRequest.create({ data: { name, org, phone, email: email || null, note: note || null, ip } });
  } else {
    await rawRedis.lpush(LIST_KEY, JSON.stringify(record));
    await rawRedis.ltrim(LIST_KEY, 0, MAX_KEEP - 1);
  }

  // Bildirim e-postası — talep zaten kaydedildi; mail hatası isteği bozmamalı.
  try { await notifyOwner(record); } catch (e) { console.error('[demo-request] bildirim hatası:', e); }

  return NextResponse.json({ ok: true });
}
