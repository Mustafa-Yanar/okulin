import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';

// Etüt şablonları — öğretmenin haftadan bağımsız, serbest saatli etüt blokları.
// program:<teacherId>.etutSablonlari = [ { id, dayIndex, start, end, aktif } ]
// Ders slotlarından (w1-w12) BAĞIMSIZ; gerçek saat bazlı (calendar için).
// Mevcut /api/program slot diff mantığına dokunmaz — ayrı kod yolu.

function programKey(teacherId) {
  return `program:${teacherId}`;
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'Saat HH:MM olmalı');
const zDay = z.number().int().min(0).max(6);

// Tek şablon ekle/güncelle
const SaveSchema = z.object({
  teacherId: zId,
  sablon: z.object({
    id: z.string().max(20).optional(),
    dayIndex: zDay,
    start: zTime,
    end: zTime,
    aktif: z.boolean().optional(),
  }),
});
const DeleteSchema = z.object({ teacherId: zId, id: z.string().max(20) });

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// GET /api/etut-sablon?teacherId=...  → şablon listesi
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const teacherId = new URL(req.url).searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const template = (await redis.get(programKey(teacherId))) || {};
  return NextResponse.json({ sablonlar: template.etutSablonlari || [] });
}

// POST /api/etut-sablon  → şablon ekle (id yoksa) veya güncelle (id varsa)
export async function POST(req) {
  const session = await getSession();
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, SaveSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, sablon } = parsed.data;

  if (toMin(sablon.end) <= toMin(sablon.start)) {
    return NextResponse.json({ error: 'Bitiş saati başlangıçtan sonra olmalı' }, { status: 400 });
  }

  const template = (await redis.get(programKey(teacherId))) || {};
  const list = Array.isArray(template.etutSablonlari) ? template.etutSablonlari : [];

  if (sablon.id) {
    // Güncelle
    const idx = list.findIndex(s => s.id === sablon.id);
    if (idx === -1) return NextResponse.json({ error: 'Şablon bulunamadı' }, { status: 404 });
    list[idx] = { ...list[idx], ...sablon };
  } else {
    // Yeni ekle
    list.push({
      id: makeId(),
      dayIndex: sablon.dayIndex,
      start: sablon.start,
      end: sablon.end,
      aktif: sablon.aktif ?? true,
    });
  }

  template.etutSablonlari = list;
  await redis.set(programKey(teacherId), template);
  return NextResponse.json({ ok: true, sablonlar: list });
}

// DELETE /api/etut-sablon  → şablon sil
export async function DELETE(req) {
  const session = await getSession();
  if (!session || !isManager(session)) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id } = parsed.data;

  const template = (await redis.get(programKey(teacherId))) || {};
  const list = Array.isArray(template.etutSablonlari) ? template.etutSablonlari : [];
  template.etutSablonlari = list.filter(s => s.id !== id);
  await redis.set(programKey(teacherId), template);
  return NextResponse.json({ ok: true, sablonlar: template.etutSablonlari });
}
