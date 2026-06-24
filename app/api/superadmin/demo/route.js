import { NextResponse } from 'next/server';
import { rawRedis } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { useSql } from '@/lib/usesql';
import { prisma } from '@/lib/prisma';

// Landing'den gelen demo/iletişim taleplerini yönetir. Yalnız superadmin.
// Global `demo:requests` listesi (rawRedis, t: prefix YOK).
const LIST_KEY = 'demo:requests';

function requireSuperadmin(session) {
  return !!session && session.role === 'superadmin';
}

function parse(s) {
  if (s && typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

// GET — son talepleri listele (en yeni başta)
export async function GET() {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  if (useSql()) {
    const rows = await prisma.demoRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    const items = rows.map(({ ip, createdAt, ...rest }) => ({ ...rest, ts: createdAt instanceof Date ? createdAt.getTime() : createdAt }));
    return NextResponse.json({ requests: items });
  }

  const raw = await rawRedis.lrange(LIST_KEY, 0, 99);
  const items = (raw || [])
    .map(parse)
    .filter(Boolean)
    .map(({ ip, ...rest }) => rest); // IP'yi istemciye gönderme

  return NextResponse.json({ requests: items });
}

// DELETE — bir talebi id ile sil (oku-filtrele-yaz; liste küçük)
export async function DELETE(req) {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  if (useSql()) {
    await prisma.demoRequest.delete({ where: { id } }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  const raw = await rawRedis.lrange(LIST_KEY, 0, -1);
  const remaining = (raw || []).filter((s) => {
    const rec = parse(s);
    return !rec || rec.id !== id;
  });

  await rawRedis.del(LIST_KEY);
  if (remaining.length > 0) await rawRedis.rpush(LIST_KEY, ...remaining);

  return NextResponse.json({ ok: true });
}
