import { NextResponse } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { listMobileDevices, revokeMobileSession, revokeMobileSessionsFor, installationIdOf } from '@/lib/mobile/sessions';
import { unbindInstallation, unbindAllInstallations } from '@/lib/mobile/devices';
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
    await unbindAllInstallations(session.role, userId); // bildirim de durur (spec §8)
    return NextResponse.json({ ok: true, revoked });
  }
  // Bağı ÖNCE kopar (İnceleme Codex #4 — sıra): revoke sonrası unbind hata verse
  // oturum kapanmış ama push bağlı kalırdı ve retry İMKANSIZ olurdu (revoke artık
  // 404 döner). Bu sırada hata retry edilebilir; unbind çağıranın org+role+userId
  // koşuluyla sınırlı (yabancı oturum kimliğinde no-op).
  // Not: aynı installation'da ikinci bir aktif oturum varsa (logout'suz çifte login)
  // push kısa süre kesilir; istemci soğuk açılışta sessizce yeniden kaydolur (Task 9).
  const instId = await installationIdOf(parsed.data.sessionId!);
  await unbindInstallation(instId, session.role, userId);
  const ok = await revokeMobileSession(parsed.data.sessionId!, session.role, userId, 'cihaz iptali');
  if (!ok) return NextResponse.json({ error: 'Oturum bulunamadı' }, { status: 404 });
  return NextResponse.json({ ok: true, revoked: 1 });
});
