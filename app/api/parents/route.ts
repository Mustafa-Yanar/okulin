import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { syncParents, parentsStatus, resetParent } from '@/lib/parents';
import { logAudit, actorFrom } from '@/lib/audit';
import { normalizeTurkishMobile } from '@/lib/phone';
import { parseBody, z } from '@/lib/validate';

// Veli (parent) yönetimi — yalnız müdür.
// GET: kayıtlı veli listesi (durum).
// POST {action:'sync'}: öğrencilerin parentPhone'larından veli hesaplarını kur/güncelle.
// POST {action:'reset', phone}: bir velinin şifresini sıfırla (telefon = geçici şifre).

export const GET = withAuth(['director'], async () => {
  const parents = await parentsStatus();
  return NextResponse.json({ parents });
});

const ParentSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('sync') }),
  z.object({ action: z.literal('reset'), phone: z.string().min(1).max(40) }),
]);

export const POST = withAuth(['director'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, ParentSchema);
  if (!parsed.ok) return parsed.response;

  if (parsed.data.action === 'sync') {
    const result = await syncParents();
    await logAudit({
      ...actorFrom(session),
      action: 'parent.sync',
      detail: `Veli erişimi senkronize edildi: ${result.created} yeni, ${result.updated} güncel, ${result.removed} kaldırıldı (${result.totalParents} veli / ${result.totalChildren} öğrenci)`,
    });
    return NextResponse.json({ ok: true, ...result });
  }

  if (parsed.data.action === 'reset') {
    const phone = normalizeTurkishMobile(parsed.data.phone);
    if (!phone) return NextResponse.json({ error: 'Geçersiz telefon' }, { status: 400 });
    const ok = await resetParent(phone);
    if (!ok) return NextResponse.json({ error: 'Veli bulunamadı' }, { status: 404 });
    await logAudit({
      ...actorFrom(session),
      action: 'parent.reset',
      target: { type: 'parent', id: phone, name: phone },
      detail: `Veli şifresi sıfırlandı: ${phone}`,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Geçersiz işlem' }, { status: 400 });
});
