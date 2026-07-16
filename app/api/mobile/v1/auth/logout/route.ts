import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { revokeMobileSession, installationIdOf } from '@/lib/mobile/sessions';
import { unbindInstallation } from '@/lib/mobile/devices';

// Mobil çıkış: token'daki sid'in oturumunu iptal eder — refresh artık çalışmaz;
// access token da iptal kontrolü nedeniyle ANINDA geçersiz (withMobileAuth).
// Ayrıca installation-hesap bağı koparılır → bildirim durur (spec §8).
export const runtime = 'nodejs';

export const POST = withMobileAuth(async (_req, _ctx, session) => {
  const userId = String(session.id ?? '');
  const instId = await installationIdOf(session.sid);
  await unbindInstallation(instId, session.role, userId);
  await revokeMobileSession(session.sid, session.role, userId, 'çıkış');
  return NextResponse.json({ ok: true });
});
