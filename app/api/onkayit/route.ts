import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';

// Ön kayıt / CRM — aday öğrenci (lead) yönetimi.
// Veli arar/gelir → müdür/rehber aday kaydı açar → durum hunisinde ilerletir
// (yeni → arandı → görüşme → kayıt / kayıp) + takip notları (history timeline).
// Aday HENÜZ kullanıcı değil → push yok, login yok. Kayda dönüşünce öğrenci elle
// Öğrenciler sekmesinden eklenir (v1'de otomatik dönüştürme yok — bilinçli dar kapsam).

import { newId as genId } from '@/lib/id';

const SOURCES = ['tavsiye', 'sosyal', 'web', 'afis', 'telefon', 'ziyaret', 'diger'] as const;
const STATUSES = ['yeni', 'arandi', 'gorusme', 'kayit', 'kayip'] as const;
const STATUS_LABEL: Record<string, string> = {
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

// Lead.data Json şekli.
interface LeadData {
  id: string;
  studentName: string;
  parentName?: string;
  phone?: string;
  level?: string;
  source?: string;
  status: string;
  history?: { at: string; byName: string; text: string }[];
  createdBy?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

function emptyStats(): Record<string, number> {
  return STATUSES.reduce((acc, s) => { acc[s] = 0; return acc; }, {} as Record<string, number>);
}
function pushHistory(rec: LeadData, byName: string | undefined, text: string): void {
  rec.history = [...(rec.history || []), { at: new Date().toISOString(), byName: byName || '', text }].slice(-HISTORY_CAP);
}

// ───────────────────────────────────────── GET ─────────────────────────────────────────
// Müdür/rehber/muhasebeci: tüm adaylar (history dahil, düşük hacim) + huni sayıları.
// GET okuma: rol listesi, config'e bakmaz — okuma her zaman serbest. Muhasebeci
// dahil: kayıt masası ön kaydı görür (yazması 'intake' iznine tabi).
export const GET = withAuth(['director', 'counselor', 'accountant'], 'crm', async () => {
  const rows = await tdb().lead.findMany();
  const leads = rows.map(r => r.data as unknown as LeadData);
  const stats = emptyStats();
  leads.forEach(l => { if (stats[l.status] !== undefined) stats[l.status]++; });
  leads.sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''));
  return NextResponse.json({ leadler: leads, stats });
});

// ───────────────────────────────────────── POST ─────────────────────────────────────────
export const POST = withAuth('intake', 'crm', async (req, ctx, session) => {
  const parsed = await parseBody(req, BodySchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  const now = new Date().toISOString();

  // ── Oluştur ──
  if (data.action === 'create') {
    const id = genId();
    const rec: LeadData = {
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
    await tdb().lead.create({ data: withScope({ legacyId: id, name: rec.studentName, stage: rec.status, data: rec as unknown as object }) });

    await logAudit({
      ...actorFrom(session),
      action: 'lead.create',
      target: { type: 'lead', id, name: rec.studentName },
      detail: `Aday öğrenci eklendi: "${rec.studentName}"${rec.phone ? ` (${rec.phone})` : ''}`,
    });
    return NextResponse.json({ ok: true, id });
  }

  // ── Güncelle (alan + durum + takip notu) ──
  const sqlRow = await tdb().lead.findFirst({ where: { legacyId: data.id } });
  const rec = sqlRow?.data as unknown as LeadData | undefined;
  if (!rec || !sqlRow) return NextResponse.json({ error: 'Aday bulunamadı' }, { status: 404 });

  for (const f of ['studentName', 'parentName', 'phone', 'level', 'source'] as const) {
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
  await tdb().lead.update({ where: { id: sqlRow.id }, data: { name: rec.studentName, stage: rec.status, data: rec as unknown as object } });

  if (statusChanged) {
    await logAudit({
      ...actorFrom(session),
      action: 'lead.status',
      target: { type: 'lead', id: rec.id, name: rec.studentName },
      detail: `Aday durumu: ${STATUS_LABEL[rec.status]}`,
    });
  }
  return NextResponse.json({ ok: true, lead: rec });
});

// ───────────────────────────────────────── DELETE ─────────────────────────────────────────
// Aday silme de 'intake': lead silmek CRM akışının parçası (öğrenci silmenin
// aksine finans/akademik geçmişi yok — muhasebeciye açılması güvenli).
export const DELETE = withAuth('intake', 'crm', async (req, ctx, session) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const sqlRow = await tdb().lead.findFirst({ where: { legacyId: id } });
  if (!sqlRow) return NextResponse.json({ error: 'Aday bulunamadı' }, { status: 404 });
  const d = sqlRow.data as unknown as LeadData | null;
  await tdb().lead.delete({ where: { id: sqlRow.id } });
  await logAudit({
    ...actorFrom(session),
    action: 'lead.delete',
    target: { type: 'lead', id, name: d?.studentName || '' },
    detail: `Aday öğrenci silindi: "${d?.studentName || ''}"`,
  });
  return NextResponse.json({ ok: true });
});
