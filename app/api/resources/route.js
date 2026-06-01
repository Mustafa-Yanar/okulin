import { NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { tenantRedis } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { parseBody, z } from '@/lib/validate';

// LMS Lite — ders kaynakları kütüphanesi (PDF föy / video / web linki).
// Kapsam: kuruma scope'lu (tenantRedis). Sınıf bazlı hedefleme.
// Ekleyebilen: director + teacher. Görebilen: director/teacher (tümü), student (kendi sınıfı).

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

const CreateSchema = z.object({
  title: z.string().min(1).max(160),
  type: z.enum(['pdf', 'video', 'link']),
  url: z.string().url().max(2000),
  branch: z.string().min(1).max(60),
  topic: z.string().max(120).optional(),
  classes: z.array(z.string().min(2).max(8)).min(1).max(40),
});

// GET /api/resources — role'e göre filtreli kaynak listesi
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Yetkisiz' }, { status: 401 });

  const redis = tenantRedis();
  const ids = await redis.smembers('resources');
  if (!ids || ids.length === 0) return NextResponse.json({ resources: [] });

  const pipe = redis.pipeline();
  ids.forEach(id => pipe.get(`resource:${id}`));
  const recs = (await pipe.exec()).filter(Boolean);

  let resources = recs;
  if (session.role === 'student') {
    resources = recs.filter(r => Array.isArray(r.classes) && r.classes.includes(session.cls));
  } else if (session.role !== 'director' && session.role !== 'teacher') {
    resources = []; // diğer roller (parent vb.) şimdilik kütüphane görmez
  }

  resources.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return NextResponse.json({ resources });
}

// POST /api/resources — kaynak ekle (director veya teacher)
export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'teacher')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;
  const { title, type, url, branch, topic, classes } = parsed.data;

  const redis = tenantRedis();
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
  await redis.set(`resource:${id}`, rec);
  await redis.sadd('resources', id);
  return NextResponse.json({ ok: true, resource: rec });
}

// DELETE /api/resources?id=xxx — kaynak sil (director hepsini, teacher kendininkini)
export async function DELETE(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'teacher')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const redis = tenantRedis();
  const rec = await redis.get(`resource:${id}`);
  if (!rec) return NextResponse.json({ error: 'Kaynak bulunamadı' }, { status: 404 });

  if (session.role === 'teacher' && rec.uploadedBy !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi eklediğiniz kaynağı silebilirsiniz' }, { status: 403 });
  }

  // PDF ise Blob'tan da temizle (sessizce — başarısız olsa da metadata silinsin)
  if (rec.type === 'pdf' && rec.url) {
    try { await del(rec.url); } catch { /* yoksay */ }
  }

  await redis.srem('resources', id);
  await redis.del(`resource:${id}`);
  return NextResponse.json({ ok: true });
}
