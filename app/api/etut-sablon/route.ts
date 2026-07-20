import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { listSablonlar, saveSablon, toggleSablon, softDeleteSablon } from '@/lib/etut/sablon-service';
import { bookEtut, cancelEtutV2 } from '@/lib/etut/booking';

// Etüt şablonları — öğretmenin haftadan bağımsız, serbest saatli etüt blokları.
// Ders slotlarından (w1-w12) BAĞIMSIZ; gerçek saat bazlı (calendar için).
// GET/POST/PUT/DELETE: EtutSablon tablosu (lib/etut/sablon-service — Faz 2b Task 1).
// PATCH (öğrenci atama): bookEtut/cancelEtutV2 orkestratörüne devredildi (Faz 2b Task 5,
// scope='RECURRING'/'recurring' — müdür/rehberin tekrarlayan atama yetkisiyle BİREBİR:
// bu route zaten 'manage' guard'lı). Dönüş sözleşmesi DEĞİŞTİ: eski PATCH rezervasyon
// alanlarını (studentName vb.) da taşıyan sablon listesi dönerdi; artık listSablonlar'ın
// SAF EtutSablon DTO'su döner (rezervasyon alanları YOK) — ProgramEditor'ün bu alanları
// okuyan kısımları Faz 3'te ele alınacak (bilinçli, bu görevin kapsamı DIŞI).

const zTime = z.string().regex(/^\d{2}:\d{2}$/, 'Saat HH:MM olmalı');
const zDay = z.number().int().min(0).max(6);

const SaveSchema = z.object({
  teacherId: zId,
  weekKey: z.string().max(40).optional(),
  sablon: z.object({
    id: zId.optional(),
    dayIndex: zDay,
    start: zTime,
    end: zTime,
    aktif: z.boolean().optional(),
  }),
});
const DeleteSchema = z.object({ teacherId: zId, id: zId });

const ToggleSchema = z.object({
  teacherId: zId,
  id: zId,
  scope: z.enum(['all', 'week']),
  weekKey: z.string().max(40).optional(),
  aktif: z.boolean(),
});

const AssignSchema = z.object({
  teacherId: zId,
  id: zId,
  student: z.object({
    id: zId,
    name: z.string().max(120),
    // cls = sınıf legacyId'si — yeni sınıflar 's_'+UUID (38 kr), classes route max(60) ile uyumlu
    cls: z.string().max(60).optional(),
  }).nullable(),
});

// GET /api/etut-sablon?teacherId=...
export const GET = withAuth('auth', 'etut', async (req) => {
  const teacherId = new URL(req.url).searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });

  const sablonlar = await listSablonlar(teacherId);
  return NextResponse.json({ sablonlar });
});

// POST /api/etut-sablon → şablon ekle (id yoksa) veya güncelle (id varsa)
export const POST = withAuth('manage', 'etut', async (req) => {
  const parsed = await parseBody(req, SaveSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, sablon, weekKey } = parsed.data;

  const sablonlar = await saveSablon(teacherId, sablon, weekKey);
  return NextResponse.json({ ok: true, sablonlar });
});

// PUT /api/etut-sablon → aktif/pasif değiştir
export const PUT = withAuth('manage', 'etut', async (req) => {
  const parsed = await parseBody(req, ToggleSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, scope, weekKey, aktif } = parsed.data;
  if (scope === 'week' && !weekKey) {
    return NextResponse.json({ error: 'weekKey gerekli' }, { status: 400 });
  }

  const sablonlar = await toggleSablon(teacherId, id, scope, weekKey, aktif);
  return NextResponse.json({ ok: true, sablonlar });
});

// PATCH /api/etut-sablon → şablona öğrenci ata / kaldır (TEKRARLAYAN atama — spec §9;
// tek-hafta atama artık /api/etut-sablon/rezervasyon POST/DELETE'in işi). student.name/cls
// gövdeden gelse de KULLANILMAZ — bookEtut hedefi kendi çözer (DB'den taze ad/sınıf);
// AssignSchema yalnız geriye dönük istemci uyumluluğu için bu alanları kabul eder.
export const PATCH = withAuth('manage', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, AssignSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, student } = parsed.data;

  if (student) {
    await bookEtut(session, { teacherId, etutId: id, studentId: student.id, scope: 'RECURRING' });
  } else {
    await cancelEtutV2(session, { teacherId, etutId: id, scope: 'recurring' });
  }
  const sablonlar = await listSablonlar(teacherId);
  return NextResponse.json({ ok: true, sablonlar });
});

// DELETE /api/etut-sablon → şablon sil (soft-delete: deletedAt=now, rezervasyonlar SİLİNMEZ)
export const DELETE = withAuth('manage', 'etut', async (req) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id } = parsed.data;

  const sablonlar = await softDeleteSablon(teacherId, id);
  return NextResponse.json({ ok: true, sablonlar });
});
