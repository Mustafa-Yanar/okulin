import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { withAuth, canManage, type Session } from '@/lib/auth';

// Kaynak yazma yetkisi: öğretmen her zaman (kendi kaynağı), müdür/rehber canManage'e tabi.
const canWriteResource = async (s: Session) => s.role === 'teacher' || (await canManage(s));
import { parseBody, z } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';

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

// Resource.data Json şekli.
interface ResourceData {
  id: string;
  title: string;
  type: string;
  url: string;
  branch: string;
  topic?: string;
  classes: string[];
  uploadedBy?: string;
  uploadedByName?: string;
  uploadedByRole?: string;
  createdAt?: string;
}

// GET /api/resources — role'e göre filtreli kaynak listesi
// Bilinçli inline rol dallanması: öğrenci kendi sınıfının kaynaklarını görür.
export const GET = withAuth(async (req, ctx, session) => {
  const rows = await tdb().resource.findMany();
  let resources = rows.map(r => r.data as unknown as ResourceData);
  if (session.role === 'student') {
    resources = resources.filter(r => Array.isArray(r.classes) && r.classes.includes(session.cls as string));
  } else if ((session.role !== 'director' && session.role !== 'counselor') && session.role !== 'teacher') {
    resources = [];
  }
  resources.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return NextResponse.json({ resources });
});

// POST /api/resources — kaynak ekle (director/teacher; rehber yalnız salt-okunur DEĞİLse)
export const POST = withAuth(canWriteResource, async (req, ctx, session) => {
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
  await tdb().resource.create({ data: withScope({ legacyId: id, title, url, data: rec }) });
  return NextResponse.json({ ok: true, resource: rec });
});

// DELETE /api/resources?id=xxx — kaynak sil (director hepsini, teacher kendininkini)
export const DELETE = withAuth(canWriteResource, async (req, ctx, session) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const existing = await tdb().resource.findFirst({ where: { legacyId: id } });
  if (!existing) return NextResponse.json({ error: 'Kaynak bulunamadı' }, { status: 404 });
  const rec = existing.data as unknown as ResourceData;
  if (session.role === 'teacher' && rec.uploadedBy !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi eklediğiniz kaynağı silebilirsiniz' }, { status: 403 });
  }
  if (rec.type === 'pdf' && rec.url) { try { await del(rec.url); } catch { /* yoksay */ } }
  await tdb().resource.delete({ where: { id: existing.id } });
  return NextResponse.json({ ok: true });
});
