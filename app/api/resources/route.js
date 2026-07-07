import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { getSession, canManage } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

// LMS Lite — ders kaynakları kütüphanesi (PDF föy / video / web linki).
// Ekleyebilen: director + teacher. Görebilen: director/teacher (tümü), student (kendi sınıfı).

import { newId as genId } from '@/lib/id';

const CreateSchema = z.object({
  title: z.string().min(1).max(160),
  type: z.enum(['pdf', 'video', 'link']),
  url: z.string().url().max(2000),
  branch: z.string().min(1).max(60),
  topic: z.string().max(120).optional(),
  classes: z.array(z.string().min(1).max(60)).min(1).max(40), // özel şube id (s_xxxxxxxx) 8'den uzun olabilir
});

// GET /api/resources — role'e göre filtreli kaynak listesi
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });

  const rows = await tdb().resource.findMany();
  let resources = rows.map(r => r.data);
  if (session.role === 'student') {
    resources = resources.filter(r => Array.isArray(r.classes) && r.classes.includes(session.cls));
  } else if ((session.role !== 'director' && session.role !== 'counselor') && session.role !== 'teacher') {
    resources = [];
  }
  resources.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return NextResponse.json({ resources });
}

// POST /api/resources — kaynak ekle (director/teacher; rehber yalnız salt-okunur DEĞİLse)
export async function POST(req) {
  const session = await getSession();
  // teacher her zaman ekler; director/rehber canManage'e tabi (salt-okunur rehber giremez).
  if (!session || !(session.role === 'teacher' || await canManage(session))) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;
  const { title, type, url, branch, topic, classes } = parsed.data;

  const id = genId();
  const rec = {
    id,
    title,
    type,
    url,
    branch,
    topic: topic || '',
    classes,
    uploadedBy: session.id,
    uploadedByName: session.name || '',
    uploadedByRole: session.role,
    createdAt: new Date().toISOString(),
  };
  await tdb().resource.create({ data: { legacyId: id, title, url, data: rec } });
  return NextResponse.json({ ok: true, resource: rec });
}

// DELETE /api/resources?id=xxx — kaynak sil (director hepsini, teacher kendininkini)
export async function DELETE(req) {
  const session = await getSession();
  // teacher her zaman (kendininkini) siler; director/rehber canManage'e tabi.
  if (!session || !(session.role === 'teacher' || await canManage(session))) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const existing = await tdb().resource.findFirst({ where: { legacyId: id } });
  if (!existing) return NextResponse.json({ error: 'Kaynak bulunamadı' }, { status: 404 });
  const rec = existing.data;
  if (session.role === 'teacher' && rec.uploadedBy !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi eklediğiniz kaynağı silebilirsiniz' }, { status: 403 });
  }
  if (rec.type === 'pdf' && rec.url) { try { await del(rec.url); } catch { /* yoksay */ } }
  await tdb().resource.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
}
