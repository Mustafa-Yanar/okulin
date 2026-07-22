import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { loginRatelimit, getClientIp, formatResetWait, safeLimit, resetLoginBudget } from '@/lib/ratelimit';
import { orgFromHost } from '@/lib/org';
import { verifyLogin } from '@/lib/login';
import { issueMobileSession } from '@/lib/mobile/sessions';
import { MobileLoginSchema } from '@/lib/mobile/contracts';
import { parseBody } from '@/lib/validate';
import { currentOrg, currentBranch } from '@/lib/tenant';

// Mobil login (spec §7): şifre doğru → access+refresh çifti (cihaz doğrulama şimdilik
// ASKIDA — Mustafa 2026-07-16). Web /api/auth login'iyle AYNI çekirdek (verifyLogin);
// fark: cookie yerine token + MobileSession cihaz oturumu.
// superadmin çekirdekte HİÇ yok. org_admin İZİNLİ (WebView yönetim için session-exchange).
// Fail-closed tenant: yalnız kurum host'unda (apex/bilinmeyen host RET).
// Bilinçli withAuth istisnası: login ucu — oturum burada kurulur.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Fail-closed tenant (İnceleme Codex #7): login yalnız gerçek kurum subdomain'inde.
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi.' }, { status: 400 });
  }

  const parsed = await parseBody(req, MobileLoginSchema);
  if (!parsed.ok) return parsed.response;
  const { username, password, role: selectedRole, installationId, deviceName, platform } = parsed.data;

  // Rate limit — web login ile AYNI kova (ip:username): mobil uç web kovasını bypass edemez.
  const ip = getClientIp(req);
  const rlKey = `${ip}:${username.toLowerCase()}`;
  const { success, reset } = await safeLimit(loginRatelimit, rlKey);
  if (!success) {
    return NextResponse.json(
      { error: `Çok fazla başarısız deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }

  const result = await verifyLogin(username, password, selectedRole);
  if (!result.ok) {
    return NextResponse.json(
      result.correctRole ? { error: result.error, correctRole: result.correctRole } : { error: result.error },
      { status: result.status }
    );
  }

  // Token payload'ına tenant kimliği yazılır (withMobileAuth kilidi + web setSession paritesi).
  // org_admin şube-bağımsız → branch '__hq__' (withMobileAuth branch kontrolünü muaf tutar).
  const branch = result.role === 'org_admin' ? '__hq__' : currentBranch();
  const payload = { ...result.payload, org: currentOrg(), branch };
  const pair = await issueMobileSession(payload, { installationId, deviceName, platform, ip });
  await resetLoginBudget(rlKey);
  return NextResponse.json({ ...pair, session: payload });
}
