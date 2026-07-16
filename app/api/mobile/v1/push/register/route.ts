import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { registerDevice, unbindInstallation } from '@/lib/mobile/devices';
import { parseBody } from '@/lib/validate';
import { PushRegisterSchema, PushUnregisterSchema } from '@/lib/mobile/contracts';
import { mobileRegisterRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';

// Push cihaz kaydı (spec §8/§9-1): native FCM cihaz token'ı → DeviceInstallation.
// POST: kayıt/yeniden bağlama (izin sonrası + soğuk açılış + token rotasyonu).
// DELETE: bildirimi kapat / logout öncesi bağ koparma (MobileSession'a DOKUNMAZ).
// Bearer korumalı (withMobileAuth) → CSRF middleware Bearer istisnasından geçer.
export const runtime = 'nodejs';

// Rate limit iki katman (İnceleme Codex #6): IP kovası (NAT dışı flood) + oturum
// (sid) kovası — kimliği doğrulanmış istemci IP değiştirerek kovadan kaçamaz.
async function registerLimited(req: NextRequest, sid: string): Promise<NextResponse | null> {
  const ipHit = await safeLimit(mobileRegisterRatelimit, getClientIp(req));
  const sidHit = ipHit.success ? await safeLimit(mobileRegisterRatelimit, `sid:${sid}`) : ipHit;
  const hit = !ipHit.success ? ipHit : sidHit;
  if (hit.success) return null;
  return NextResponse.json(
    { error: `Çok fazla kayıt isteği. Lütfen ${formatResetWait(hit.reset)} tekrar deneyin.` },
    { status: 429 }
  );
}

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await registerLimited(req, session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, PushRegisterSchema);
  if (!parsed.ok) return parsed.response;
  const outcome = await registerDevice(session.role, String(session.id ?? ''), parsed.data);
  if (outcome === 'conflict') {
    // installationId başka hesaba bağlı ve token kanıtı yok — istemci yeni
    // installationId üretip tek sefer tekrar dener (mobile/src/push.ts).
    return NextResponse.json({ error: 'Kurulum kimliği başka bir hesaba bağlı.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await registerLimited(req, session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, PushUnregisterSchema);
  if (!parsed.ok) return parsed.response;
  await unbindInstallation(parsed.data.installationId, session.role, String(session.id ?? ''));
  return NextResponse.json({ ok: true });
});
