import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { listMobileDevices, revokeMobileSession, revokeMobileSessionsFor } from '@/lib/mobile/sessions';
import { parseBody } from '@/lib/validate';
import { MobileDeviceRevokeSchema } from '@/lib/mobile/contracts';

// Cihaz oturumu yönetimi (spec §7): listele, tek tek iptal, "tüm cihazlardan çıkış".
// role+userId koşulu sessions katmanında — kullanıcı YALNIZ kendi oturumlarını görür/kapatır.
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (_req, _ctx, session) => {
  const devices = await listMobileDevices(session.role, String(session.id ?? ''), session.sid);
  return NextResponse.json({ devices });
});

export const DELETE = withMobileAuth(async (req, _ctx, session) => {
  const parsed = await parseBody(req, MobileDeviceRevokeSchema);
  if (!parsed.ok) return parsed.response;
  const userId = String(session.id ?? '');
  if (parsed.data.all) {
    const revoked = await revokeMobileSessionsFor(session.role, userId, 'tüm cihazlardan çıkış');
    return NextResponse.json({ ok: true, revoked });
  }
  const ok = await revokeMobileSession(parsed.data.sessionId!, session.role, userId, 'cihaz iptali');
  if (!ok) return NextResponse.json({ error: 'Oturum bulunamadı' }, { status: 404 });
  return NextResponse.json({ ok: true, revoked: 1 });
});
