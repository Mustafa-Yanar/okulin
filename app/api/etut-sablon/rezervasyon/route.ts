import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { parseBody, z, zId } from '@/lib/validate';
import { bookEtut, cancelEtutV2 } from '@/lib/etut/booking';

// Serbest etüt şablonuna öğrenci REZERVASYONU. İş kuralları lib/etut/booking.ts (bookEtut/
// cancelEtutV2, spec §9/6) + lib/etut/booking-rules.ts (decideBooking, saf karar çekirdeği)
// içinde; bu route yalnız yetki (withAuth) + parse + servis çağrısı — EtutActor kurulumu YOK,
// session doğrudan geçirilir (bookEtut kendi canManage/isReadOnlyCounselor'ını çözer).
// Servis HttpError fırlatır → withAuth tek noktada { error }+status'a çevirir (kendi try/catch
// YOK; lib/auth.ts:167-172).
export const runtime = 'nodejs';

const PostSchema = z.object({
  teacherId: zId,
  etutId: zId, // EtutSablon.legacyId
  branch: z.string().max(60).optional(),
  studentId: zId.optional(),
  weekKey: z.string().max(40).optional(),
  scope: z.enum(['WEEK', 'RECURRING']).optional(),
  force: z.boolean().optional(),
  reason: z.string().max(200).optional(),
});
const DeleteSchema = z.object({
  teacherId: zId,
  etutId: zId,
  weekKey: z.string().max(40).optional(),
  scope: z.enum(['week', 'recurring']).optional(),
  reason: z.string().max(200).optional(),
});

export const POST = withAuth('auth', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, PostSchema);
  if (!parsed.ok) return parsed.response;
  const etut = await bookEtut(session, parsed.data);
  return NextResponse.json({ ok: true, etut });
});

export const DELETE = withAuth('auth', 'etut', async (req, ctx, session) => {
  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  await cancelEtutV2(session, parsed.data);
  return NextResponse.json({ ok: true });
});
