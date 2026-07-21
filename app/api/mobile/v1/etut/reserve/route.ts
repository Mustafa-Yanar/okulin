import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { ReserveEtutSchema, CancelEtutSchema } from '@/lib/mobile/contracts';
import { bookEtut, cancelEtutV2 } from '@/lib/etut/booking';
import { getOrgConfig } from '@/lib/config';

// Öğrenci etüt rezervasyon/iptal (mobil). MobileClaims (session) `Session`'ı GENİŞLETİR
// (lib/mobile/token.ts) — bookEtut/cancelEtutV2'ye DOĞRUDAN geçirilir, ara EtutActor/
// pseudo-Session katmanı YOK (Faz 2b Task 7: eski reserveEtut/cancelEtut ince adaptörleri
// kaldırıldı — bu route tek çağıranlarıydı). studentId GÖNDERİLMEZ — bookEtut öğrenci
// dalında session.id'yi hedef alır; scope her zaman WEEK (mobilde RECURRING yok — öğrenci
// zaten decideBooking kural 2 gereği isteyemez). precomputed GEÇİLMEZ: gerçek session
// üzerinden canManage/isReadOnlyCounselor kendi hesaplasın (öğrenci için ikisi de daima
// false — ekstra DB round-trip'i ihmal edilebilir, doğruluk önceliği).
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
  const etut = await bookEtut(session, parsed.data);
  return NextResponse.json({ ok: true, etut: { id: parsed.data.etutId, dayIndex: etut.dayIndex, start: etut.startsAt, end: etut.endsAt, branch: etut.dersBranch, studentName: etut.studentName } });
});

export const DELETE = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const mods = await getOrgConfig('modules');
  if (mods.etut === false) return NextResponse.json({ error: 'Bu modül kurumunuzda kapalı' }, { status: 403 });
  const parsed = await parseBody(req, CancelEtutSchema);
  if (!parsed.ok) return parsed.response;
  await cancelEtutV2(session, parsed.data);
  return NextResponse.json({ ok: true });
});
