import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { revokeMobileSession } from '@/lib/mobile/sessions';

// Mobil çıkış: token'daki sid'in oturumunu iptal eder — refresh artık çalışmaz;
// access token da iptal kontrolü nedeniyle ANINDA geçersiz (withMobileAuth).
export const runtime = 'nodejs';

export const POST = withMobileAuth(async (_req, _ctx, session) => {
  await revokeMobileSession(session.sid, session.role, String(session.id ?? ''), 'çıkış');
  return NextResponse.json({ ok: true });
});
