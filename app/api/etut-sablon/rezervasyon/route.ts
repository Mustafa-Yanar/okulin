import { NextResponse } from 'next/server';
import { withAuth, canManage } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { reserveEtut, cancelEtut, type EtutActor } from '@/lib/etut/rezervasyon';

// Serbest etüt şablonuna öğrenci REZERVASYONU. İş kuralları lib/etut/rezervasyon.ts
// servisinde (spec §9/6); bu route yalnız yetki + parse + servis çağrısı.
// program:<teacherId>.etutSablonlari = [ { id, dayIndex, start, end, aktif, studentId?, ... } ]
// Servis HttpError fırlatır → withAuth tek noktada { error }+status'a çevirir (kendi try/catch YOK; lib/auth.ts:167-172).
export const runtime = 'nodejs';

const PostSchema = z.object({
  teacherId: zId,
  etutId: zId, // makeId→UUID göçü sonrası 36 char (max20 yeni şablonu keserdi) → zId(max100)
  branch: z.string().max(60).optional(),
  studentId: zId.optional(),
  weekKey: z.string().max(40).optional(),
});
const DeleteSchema = z.object({ teacherId: zId, etutId: zId });

export const POST = withAuth('auth', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: session.role, id: String(session.id ?? ''), isManager: await canManage(session) };
  const etut = await reserveEtut(actor, parsed.data);
  return NextResponse.json({ ok: true, etut });
});

export const DELETE = withAuth('auth', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: session.role, id: String(session.id ?? ''), isManager: await canManage(session) };
  await cancelEtut(actor, parsed.data);
  return NextResponse.json({ ok: true });
});
