import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Landing'den gelen demo/iletişim taleplerini yönetir. Yalnız superadmin.

function requireSuperadmin(session) {
  return !!session && session.role === 'superadmin';
}

// GET — son talepleri listele (en yeni başta)
export async function GET() {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const rows = await prisma.demoRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const items = rows.map(({ ip, createdAt, ...rest }) => ({ ...rest, ts: createdAt instanceof Date ? createdAt.getTime() : createdAt }));
  return NextResponse.json({ requests: items });
}

// DELETE — bir talebi id ile sil
export async function DELETE(req) {
  const session = await getSession();
  if (!requireSuperadmin(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  await prisma.demoRequest.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
