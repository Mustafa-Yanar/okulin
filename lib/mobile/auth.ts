import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { currentOrg, currentBranch } from '@/lib/tenant';
import { orgFromHost } from '@/lib/org';
import { errorResponse } from '@/lib/errors';
import type { RouteContext } from '@/lib/auth';
import { verifyMobileAccessToken, type MobileClaims } from './token';
import { loadActiveSession } from './sessions';

// withAuth'un MOBİL karşılığı — cookie yerine Authorization: Bearer <access token>.
// Guard geçerse token claim'leri (Session + sid) 3. argüman olarak enjekte edilir.
//
// Üç katman:
//   1) İmza + aud/iss/alg (verifyMobileAccessToken) — geçersiz token 401.
//   2) Fail-closed tenant (İnceleme Codex #7): host kurum host'u OLMALI (orgFromHost
//      null → apex/bilinmeyen host → DEFAULT_ORG'a düşme → RET). Token org/branch,
//      isteğin tenant'ıyla eşleşmeli — org_admin '__hq__' branch'i muaf (web paritesi).
//   3) İptal (İnceleme Codex #2): sid'in MobileSession'ı hâlâ aktif mi (revokedAt null,
//      expiresAt gelecekte). Logout/şifre değişimi/cihaz iptali access token'ı ANINDA
//      geçersizler — imza geçerli olsa bile.
const unauth = () => NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

export type MobileHandler = (req: NextRequest, ctx: RouteContext, session: MobileClaims) => Promise<Response> | Response;

export function withMobileAuth(handler: MobileHandler): (req: NextRequest, ctx: RouteContext) => Promise<Response> {
  return async (req: NextRequest, ctx: RouteContext) => {
    const auth = req.headers.get('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return unauth();
    const claims = await verifyMobileAccessToken(token);
    if (!claims) return unauth();

    // Fail-closed tenant: yalnız gerçek kurum host'unda (apex/bilinmeyen host RET).
    if (!orgFromHost(headers().get('host'))) return unauth();
    if (claims.org !== currentOrg()) return unauth();
    // org_admin şube-bağımsız (__hq__) — branch kontrolü muaf; diğerleri eşleşmeli.
    if (claims.role !== 'org_admin' && (claims.branch || 'main') !== currentBranch()) return unauth();

    // İptal kontrolü — imza geçerli olsa bile oturum kapatılmışsa reddet.
    const active = await loadActiveSession(claims.sid);
    if (!active || active.revokedAt || active.expiresAt.getTime() <= Date.now()) return unauth();

    // Servis katmanı HttpError'ları tek noktada { error }+status'a çevrilir (withAuth kalıbı).
    try {
      return await handler(req, ctx, claims);
    } catch (e) {
      return errorResponse(e);
    }
  };
}
