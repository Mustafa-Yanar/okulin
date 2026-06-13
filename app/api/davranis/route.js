import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession, isManager } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';

// Davranış puanlama — olumlu/olumsuz davranış kaydı (artı/eksi puan).
// Öğretmen + müdür/rehber öğrenciye puan verir (sebep + opsiyonel not). Öğrenci kendi
// toplamını + geçmişini görür; veli çocuğunkini. Toplam, motivasyon/sorumluluk için şeffaf.
//
// "Aktivite omurgası" — bu kayıt öğrenci-sahipli (her zaman öğrenci bazında sorgulanır):
//   davranis:<studentId> → {studentId, total, entries:[{id,points,reason,note,byName,byRole,at}]}
// total = otoritatif çalışan toplam (ekle/silde güncellenir); entries son CAP ile sınırlı log.

export const runtime = 'nodejs'; // push (web-push Node crypto)

function genId() { return Math.random().toString(36).slice(2, 10); }
const ENTRIES_CAP = 200;

const AddSchema = z.object({
  action: z.literal('add'),
  studentId: z.string().min(1).max(100),
  points: z.coerce.number().int().min(-50).max(50),
  reason: z.string().min(1).max(100),
  note: z.string().max(500).optional(),
});
const BodySchema = z.discriminatedUnion('action', [AddSchema]);

function canGive(session) {
  return isManager(session) || session?.role === 'teacher';
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const studentId = new URL(req.url).searchParams.get('studentId');

  // ── Tek öğrenci detayı (toplam + geçmiş) ──
  if (studentId) {
    // Yetki: yönetici/öğretmen herkesi; öğrenci yalnız kendini; veli yalnız çocuğunu.
    if (session.role === 'student' && session.id !== studentId) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    if (session.role === 'parent' && !(session.children || []).some(c => c.id === studentId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const rec = await redis.get(`davranis:${studentId}`) || { studentId, total: 0, entries: [] };
    const entries = [...(rec.entries || [])].reverse(); // en yeni üstte
    return NextResponse.json({ studentId, total: rec.total || 0, entries });
  }

  // ── Öğrenci: kendi kaydı ──
  if (session.role === 'student') {
    const rec = await redis.get(`davranis:${session.id}`) || { total: 0, entries: [] };
    return NextResponse.json({ studentId: session.id, total: rec.total || 0, entries: [...(rec.entries || [])].reverse() });
  }

  // ── Veli: studentId şart (panel childId geçer) ──
  if (session.role === 'parent') {
    return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });
  }

  // ── Yönetici/öğretmen: roster + toplamlar ──
  if (!canGive(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const sids = await redis.smembers('students');
  if (!sids || sids.length === 0) return NextResponse.json({ roster: [] });
  const pipe = redis.pipeline();
  sids.forEach(id => { pipe.get(`student:${id}`); pipe.get(`davranis:${id}`); });
  const res = await pipe.exec();
  const roster = [];
  sids.forEach((id, i) => {
    const stu = res[i * 2];
    const dav = res[i * 2 + 1];
    if (!stu) return;
    roster.push({ id: stu.id, name: stu.name, cls: stu.cls, total: dav?.total || 0, count: (dav?.entries || []).length });
  });
  roster.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  return NextResponse.json({ roster });
}

// ───────────────────────────────────────── POST (ekle) ─────────────────────────────────────────
export async function POST(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  if (!canGive(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, points, reason, note } = parsed.data;
  if (points === 0) return NextResponse.json({ error: 'Puan 0 olamaz' }, { status: 400 });

  const student = await redis.get(`student:${studentId}`);
  if (!student) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const rec = await redis.get(`davranis:${studentId}`) || { studentId, total: 0, entries: [] };
  const entry = {
    id: genId(), points, reason: reason.trim(), note: (note || '').trim(),
    byName: session.name || '', byRole: session.role, by: session.id,
    at: new Date().toISOString(),
  };
  rec.total = (rec.total || 0) + points;
  rec.entries = [...(rec.entries || []), entry].slice(-ENTRIES_CAP);
  await redis.set(`davranis:${studentId}`, rec);

  // Öğrenciye push (hata toleranslı). Veli push'u atlanır: abonelik veli id'siyle (telefon)
  // saklanır, studentId ile eşleşmez — veli panelde görür (odev modülüyle aynı yaklaşım).
  const sign = points > 0 ? '+' : '';
  const payload = {
    title: points > 0 ? '👍 Davranış puanı' : '⚠️ Davranış puanı',
    body: `${reason.trim()} (${sign}${points})`,
    url: '/?tab=davranis', tag: `davranis-${studentId}`,
  };
  await Promise.allSettled([sendPushToUser('student', studentId, payload)]);

  await logAudit({
    ...actorFrom(session),
    action: 'behavior.add',
    target: { type: 'student', id: studentId, name: student.name },
    detail: `Davranış puanı: ${sign}${points} — ${reason.trim()}`,
  });
  return NextResponse.json({ ok: true, total: rec.total });
}

// ───────────────────────────────────────── DELETE (kayıt sil) ─────────────────────────────────────────
export async function DELETE(req) {
  const session = await getSession();
  if (!canGive(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const url = new URL(req.url);
  const studentId = url.searchParams.get('studentId');
  const entryId = url.searchParams.get('entryId');
  if (!studentId || !entryId) return NextResponse.json({ error: 'studentId ve entryId gerekli' }, { status: 400 });

  const rec = await redis.get(`davranis:${studentId}`);
  if (!rec) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  const entry = (rec.entries || []).find(e => e.id === entryId);
  if (!entry) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  // Öğretmen yalnız kendi verdiğini siler; müdür/rehber hepsini.
  if (!isManager(session) && entry.by !== session.id) {
    return NextResponse.json({ error: 'Yalnız kendi verdiğiniz puanı silebilirsiniz' }, { status: 403 });
  }

  rec.total = (rec.total || 0) - (entry.points || 0);
  rec.entries = rec.entries.filter(e => e.id !== entryId);
  await redis.set(`davranis:${studentId}`, rec);

  await logAudit({
    ...actorFrom(session),
    action: 'behavior.delete',
    target: { type: 'student', id: studentId, name: '' },
    detail: `Davranış puanı silindi: ${entry.points > 0 ? '+' : ''}${entry.points} — ${entry.reason}`,
  });
  return NextResponse.json({ ok: true, total: rec.total });
}
