import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { parseBody } from '@/lib/validate';
import { ChangePasswordSchema } from '@/lib/mobile/contracts';
import { changePasswordFor } from '@/lib/password';
import { applyPasswordChange } from '@/lib/mobile/sessions';
import { passwordChangeRatelimit, safeLimit, formatResetWait, getClientIp } from '@/lib/ratelimit';

// Mobil şifre değiştirme (spec §7). changePasswordFor (web ile ortak) + applyPasswordChange
// (diğer oturumlar iptal, mevcut korunur, taze token). Gerçek director/org_admin
// mustChangePassword taşımaz → 403 (WebView'den web change_password kullanır).
export const runtime = 'nodejs';

function roleKeyFor(session: { role: string; asst?: unknown }): string | null {
  if (session.role === 'director' && session.asst) return 'assistantDirector';
  if (session.role === 'teacher') return 'teacher';
  if (session.role === 'student') return 'student';
  if (session.role === 'accountant') return 'accountant';
  if (session.role === 'counselor') return 'counselor';
  if (session.role === 'parent') return 'parent';
  return null;
}

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const roleKey = roleKeyFor(session);
  if (!roleKey) return NextResponse.json({ error: 'Bu rol mobilde şifre değiştiremez' }, { status: 403 });

  // Rate limit — kapılmış oturumda mevcut şifre tahminini yavaşlat (web paritesi).
  const rl = await safeLimit(passwordChangeRatelimit, `${getClientIp(req)}:${session.id}`);
  if (!rl.success) return NextResponse.json({ error: `Çok fazla deneme. Lütfen ${formatResetWait(rl.reset)} tekrar deneyin.` }, { status: 429 });

  const parsed = await parseBody(req, ChangePasswordSchema);
  if (!parsed.ok) return parsed.response;

  const r = await changePasswordFor(roleKey, String(session.id ?? ''), parsed.data.currentPassword, parsed.data.newPassword);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const applied = await applyPasswordChange(session.sid, session.role, String(session.id ?? ''));
  if (!applied) return NextResponse.json({ error: 'Oturum bulunamadı. Yeniden giriş yapın.' }, { status: 401 });

  // payload = saklanan Session (JWT meta claim'i yok — login `session: payload` deseniyle aynı).
  return NextResponse.json({
    accessToken: applied.pair.accessToken,
    refreshToken: applied.pair.refreshToken,
    expiresIn: applied.pair.expiresIn,
    session: applied.payload,
  });
});
