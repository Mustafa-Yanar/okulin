import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';

// Mobil "whoami" — istemci açılışta token geçerliliğini ve rol payload'ını doğrular.
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (_req, _ctx, session) => {
  // JWT meta claim'leri (iat/exp/aud/iss) yanıt gövdesine sızdırılmaz.
  const { iat, exp, aud, iss, ...rest } = session;
  return NextResponse.json({ session: rest });
});
