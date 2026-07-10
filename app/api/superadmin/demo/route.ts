import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Landing'den gelen demo/iletişim taleplerini yönetir. Yalnız superadmin.

// GET — son talepleri listele (en yeni başta)
export const GET = withAuth(['superadmin'], async () => {

  const rows = await prisma.demoRequest.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  const items = rows.map(({ ip, createdAt, ...rest }) => ({ ...rest, ts: createdAt instanceof Date ? createdAt.getTime() : createdAt }));
  return NextResponse.json({ requests: items });
});

// DELETE — bir talebi id ile sil
export const DELETE = withAuth(['superadmin'], async (req) => {
  let body: { id?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const id = String(body.id || '').trim();
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  await prisma.demoRequest.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
});
