import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { ReserveEtutSchema, CancelEtutSchema } from '@/lib/mobile/contracts';
import { reserveEtut, cancelEtut, type EtutActor } from '@/lib/etut/rezervasyon';
import { getOrgConfig } from '@/lib/config';

// Öğrenci etüt rezervasyon/iptal (mobil). actor daima öğrenci (isManager:false);
// studentId GÖNDERİLMEZ — reserveEtut öğrenci dalında session.id'yi hedef alır.
// Servis HttpError fırlatır → withMobileAuth tek noktada çevirir (kendi try/catch YOK).
export const runtime = 'nodejs';

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const mods = await getOrgConfig('modules');
  if (mods.etut === false) return NextResponse.json({ error: 'Bu modül kurumunuzda kapalı' }, { status: 403 });
  const parsed = await parseBody(req, ReserveEtutSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: 'student', id: String(session.id ?? ''), isManager: false };
  const etut = await reserveEtut(actor, parsed.data);
  return NextResponse.json({ ok: true, etut: { id: etut.id, dayIndex: etut.dayIndex, start: etut.start, end: etut.end, branch: etut.branch, studentName: etut.studentName } });
});

export const DELETE = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const mods = await getOrgConfig('modules');
  if (mods.etut === false) return NextResponse.json({ error: 'Bu modül kurumunuzda kapalı' }, { status: 403 });
  const parsed = await parseBody(req, CancelEtutSchema);
  if (!parsed.ok) return parsed.response;
  const actor: EtutActor = { role: 'student', id: String(session.id ?? ''), isManager: false };
  await cancelEtut(actor, parsed.data);
  return NextResponse.json({ ok: true });
});
