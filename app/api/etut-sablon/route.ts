import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { listSablonlarWithRez, saveSablon, toggleSablon, softDeleteSablon } from '@/lib/etut/sablon-service';
import { bookEtut, cancelEtutV2 } from '@/lib/etut/booking';
import { isValidWeekKey, currentWeekKeyTSI } from '@/lib/etut/weeks';

// Etüt şablonları — öğretmenin haftadan bağımsız, serbest saatli etüt blokları.
// Ders slotlarından (w1-w12) BAĞIMSIZ; gerçek saat bazlı (calendar için).
// GET/POST/PUT/DELETE: EtutSablon tablosu (lib/etut/sablon-service — Faz 2b Task 1).
// Faz 3: TÜM yanıtlar listSablonlarWithRez ile döner — şablon + o haftanın EFEKTİF
// rezervasyon alanları (studentId/studentName/studentCls/branch/bookedBy/rezScope) birlikte.
// PATCH (öğrenci atama): bookEtut/cancelEtutV2 orkestratörüne devredildi (Faz 2b Task 5),
// artık scope (WEEK/RECURRING) + weekKey istemciden gelebilir (default RECURRING — geriye
// uyum, eski istemci scope göndermez).

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
const DeleteSchema = z.object({ teacherId: zId, id: zId, weekKey: z.string().max(40).optional() });

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
  // Ders (branş) — çok-branşlı öğretmende ZORUNLU. Eskiden şemada hiç yoktu: müdür/rehber
  // modalinde ders seçici de olmadığı için bookEtut autoPickBranch tek-aday bulamıyor ve
  // atama 'Geçersiz veya seçilmemiş ders' ile 400 alıyordu (denetim B9, canlı doğrulandı).
  // Tek adaylı öğretmende hâlâ opsiyonel — autoPickBranch otomatik seçer.
  branch: z.string().max(60).optional(),
  scope: z.enum(['WEEK', 'RECURRING']).optional(),   // default RECURRING (geriye uyum — eski istemci scope göndermez)
  weekKey: z.string().max(40).optional().refine((wk) => wk === undefined || isValidWeekKey(wk), { message: 'Geçersiz hafta formatı' }),
});

// GET /api/etut-sablon?teacherId=...&week=YYYY-Www
export const GET = withAuth('auth', 'etut', async (req) => {
  const url = new URL(req.url);
  const teacherId = url.searchParams.get('teacherId');
  if (!teacherId) return NextResponse.json({ error: 'teacherId gerekli' }, { status: 400 });
  const week = url.searchParams.get('week') || undefined;
  // resolveEffective ISO-string sıralamasına dayanır; 'foo'/'2026-W99' gibi geçersiz
  // değerler recurring'i yanlış efektif gösterebilir — sessiz düşüş yerine 400 (teşhis edilebilir).
  if (week && !isValidWeekKey(week)) {
    return NextResponse.json({ error: 'Geçersiz hafta formatı' }, { status: 400 });
  }
  const wk = week || currentWeekKeyTSI();

  const sablonlar = await listSablonlarWithRez(teacherId, wk);
  return NextResponse.json({ sablonlar });
});

// POST /api/etut-sablon → şablon ekle (id yoksa) veya güncelle (id varsa)
export const POST = withAuth('manage', 'etut', async (req) => {
  const parsed = await parseBody(req, SaveSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, sablon, weekKey } = parsed.data;

  await saveSablon(teacherId, sablon, weekKey);
  const sablonlar = await listSablonlarWithRez(teacherId, weekKey || currentWeekKeyTSI());
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

  await toggleSablon(teacherId, id, scope, weekKey, aktif);
  const sablonlar = await listSablonlarWithRez(teacherId, weekKey || currentWeekKeyTSI());
  return NextResponse.json({ ok: true, sablonlar });
});

// PATCH /api/etut-sablon → şablona öğrenci ata / kaldır (spec §9). student.name/cls
// gövdeden gelse de KULLANILMAZ — bookEtut hedefi kendi çözer (DB'den taze ad/sınıf);
// AssignSchema yalnız geriye dönük istemci uyumluluğu için bu alanları kabul eder.
// scope: WEEK (o hafta) veya RECURRING (tekrarlayan, varsayılan — eski istemci scope göndermez).
export const PATCH = withAuth('manage', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, AssignSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, student, branch } = parsed.data;
  const scope = parsed.data.scope ?? 'RECURRING';
  const weekKey = parsed.data.weekKey;

  if (student) {
    await bookEtut(session, { teacherId, etutId: id, studentId: student.id, branch, scope, weekKey });
  } else {
    await cancelEtutV2(session, scope === 'WEEK'
      ? { teacherId, etutId: id, scope: 'week', weekKey }
      : { teacherId, etutId: id, scope: 'recurring' });
  }
  const sablonlar = await listSablonlarWithRez(teacherId, weekKey || currentWeekKeyTSI());
  return NextResponse.json({ ok: true, sablonlar });
});

// DELETE /api/etut-sablon → şablon sil (soft-delete: deletedAt=now; rezervasyon satırları
// silinmez ama cari+gelecek haftalar ve recurring serisi CANCELLED'a çekilir — sablon-service)
export const DELETE = withAuth('manage', 'etut', async (req, _ctx, session) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { teacherId, id, weekKey } = parsed.data;

  // String(session.id ?? '') — booking.ts:109 ile aynı idiom (Session.id opsiyonel).
  await softDeleteSablon(teacherId, id, { role: session.role, id: String(session.id ?? '') });
  const sablonlar = await listSablonlarWithRez(teacherId, weekKey || currentWeekKeyTSI());
  return NextResponse.json({ ok: true, sablonlar });
});
