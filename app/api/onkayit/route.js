import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';

// Ön kayıt / CRM — aday öğrenci (lead) yönetimi.
// Veli arar/gelir → müdür/rehber aday kaydı açar → durum hunisinde ilerletir
// (yeni → arandı → görüşme → kayıt / kayıp) + takip notları (history timeline).
// Aday HENÜZ kullanıcı değil → push yok, login yok. Kayda dönüşünce öğrenci elle
// Öğrenciler sekmesinden eklenir (v1'de otomatik dönüştürme yok — bilinçli dar kapsam).
//
// "Aktivite omurgası" adlandırma deseni (set + tekil anahtar, hash yok):
//   leadler (set)   → aday id'leri
//   lead:<id>       → {id, studentName, parentName, phone, level, source, status, history[], createdBy, ...}

function genId() { return Math.random().toString(36).slice(2, 10); }

const SOURCES = ['tavsiye', 'sosyal', 'web', 'afis', 'telefon', 'ziyaret', 'diger'];
const STATUSES = ['yeni', 'arandi', 'gorusme', 'kayit', 'kayip'];
const STATUS_LABEL = {
  yeni: 'Yeni', arandi: 'Arandı', gorusme: 'Görüşme', kayit: 'Kayıt oldu', kayip: 'Kaybedildi',
};
const HISTORY_CAP = 100;

const CreateSchema = z.object({
  action: z.literal('create'),
  studentName: z.string().min(1).max(120),
  parentName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  level: z.string().max(60).optional(),          // ilgilenilen sınıf/düzey (serbest metin)
  source: z.enum(SOURCES).optional(),
  status: z.enum(STATUSES).optional(),
  note: z.string().max(1000).optional(),          // ilk açıklama → history'e tohumlanır
});
const UpdateSchema = z.object({
  action: z.literal('update'),
  id: zId,
  studentName: z.string().min(1).max(120).optional(),
  parentName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  level: z.string().max(60).optional(),
  source: z.enum(SOURCES).optional(),
  status: z.enum(STATUSES).optional(),
  followUp: z.string().max(1000).optional(),      // takip günlüğüne eklenecek satır
});
const BodySchema = z.discriminatedUnion('action', [CreateSchema, UpdateSchema]);

function emptyStats() {
  return STATUSES.reduce((acc, s) => { acc[s] = 0; return acc; }, {});
}
function pushHistory(rec, byName, text) {
  rec.history = [...(rec.history || []), { at: new Date().toISOString(), byName: byName || '', text }].slice(-HISTORY_CAP);
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
// Müdür/rehber: tüm adaylar (history dahil, düşük hacim) + huni sayıları.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const ids = await redis.smembers('leadler');
  if (!ids || ids.length === 0) return NextResponse.json({ leadler: [], stats: emptyStats() });

  const pipe = redis.pipeline();
  ids.forEach(id => pipe.get(`lead:${id}`));
  const leads = (await pipe.exec()).filter(Boolean);

  const stats = emptyStats();
  leads.forEach(l => { if (stats[l.status] !== undefined) stats[l.status]++; });
  leads.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));

  return NextResponse.json({ leadler: leads, stats });
}

// ───────────────────────────────────────── POST ─────────────────────────────────────────
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  const now = new Date().toISOString();

  // ── Oluştur ──
  if (data.action === 'create') {
    const id = genId();
    const rec = {
      id,
      studentName: data.studentName.trim(),
      parentName: (data.parentName || '').trim(),
      phone: (data.phone || '').trim(),
      level: (data.level || '').trim(),
      source: data.source || 'diger',
      status: data.status || 'yeni',
      history: [],
      createdBy: session.id, createdByName: session.name || '', createdAt: now, updatedAt: now,
    };
    pushHistory(rec, session.name, 'Ön kayıt oluşturuldu');
    if (data.note?.trim()) pushHistory(rec, session.name, data.note.trim());
    await redis.set(`lead:${id}`, rec);
    await redis.sadd('leadler', id);

    await logAudit({
      ...actorFrom(session),
      action: 'lead.create',
      target: { type: 'lead', id, name: rec.studentName },
      detail: `Aday öğrenci eklendi: "${rec.studentName}"${rec.phone ? ` (${rec.phone})` : ''}`,
    });
    return NextResponse.json({ ok: true, id });
  }

  // ── Güncelle (alan + durum + takip notu) ──
  const rec = await redis.get(`lead:${data.id}`);
  if (!rec) return NextResponse.json({ error: 'Aday bulunamadı' }, { status: 404 });

  for (const f of ['studentName', 'parentName', 'phone', 'level', 'source']) {
    if (data[f] !== undefined) rec[f] = typeof data[f] === 'string' ? data[f].trim() : data[f];
  }
  let statusChanged = false;
  if (data.status && data.status !== rec.status) {
    rec.status = data.status;
    statusChanged = true;
    pushHistory(rec, session.name, `Durum → ${STATUS_LABEL[data.status]}`);
  }
  if (data.followUp?.trim()) pushHistory(rec, session.name, data.followUp.trim());
  rec.updatedAt = now;
  await redis.set(`lead:${data.id}`, rec);

  if (statusChanged) {
    await logAudit({
      ...actorFrom(session),
      action: 'lead.status',
      target: { type: 'lead', id: rec.id, name: rec.studentName },
      detail: `Aday durumu: ${STATUS_LABEL[rec.status]}`,
    });
  }
  return NextResponse.json({ ok: true, lead: rec });
}

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
export async function DELETE(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });
  const rec = await redis.get(`lead:${id}`);
  if (!rec) return NextResponse.json({ error: 'Aday bulunamadı' }, { status: 404 });

  await redis.del(`lead:${id}`);
  await redis.srem('leadler', id);

  await logAudit({
    ...actorFrom(session),
    action: 'lead.delete',
    target: { type: 'lead', id, name: rec.studentName },
    detail: `Aday öğrenci silindi: "${rec.studentName}"`,
  });
  return NextResponse.json({ ok: true });
}
