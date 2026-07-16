import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { createHash } from 'crypto';
import { orgFromHost } from '@/lib/org';
import { parseBody } from '@/lib/validate';
import { MobileRefreshSchema } from '@/lib/mobile/contracts';
import { refreshMobileSession } from '@/lib/mobile/sessions';
import { mobileRefreshRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';

// Refresh token rotation (spec §7): her kullanım yeni çift üretir, eskisi geçersizleşir;
// grace (30sn) dışı eski token kullanımı oturumu KAPATIR (reuse detection —
// lib/mobile/policy.ts). Tenant kilidi: arama tdb() üzerinden → başka kurumun
// host'una sunulan token bulunamaz. Fail-closed: yalnız kurum host'unda.
// Bilinçli withAuth istisnası: access token süresi dolmuşken çağrılır — Bearer yok.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi.' }, { status: 400 });
  }
  const ip = getClientIp(req);
  const rl = await safeLimit(mobileRefreshRatelimit, ip);
  if (!rl.success) {
    return NextResponse.json(
      { error: `Çok fazla istek. Lütfen ${formatResetWait(rl.reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }
  const parsed = await parseBody(req, MobileRefreshSchema);
  if (!parsed.ok) return parsed.response;
  // Token-bazlı ikinci kova: meşru cihaz ~15 dk'da 1 refresh yapar; aynı token'ın
  // saniyelik denemesi (replay/tarama) IP'den bağımsız kesilir.
  const tokenKey = 'tok:' + createHash('sha256').update(parsed.data.refreshToken).digest('hex').slice(0, 32);
  const rlToken = await safeLimit(mobileRefreshRatelimit, tokenKey);
  if (!rlToken.success) {
    return NextResponse.json(
      { error: `Çok fazla istek. Lütfen ${formatResetWait(rlToken.reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }
  const r = await refreshMobileSession(parsed.data.refreshToken);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ...r.pair, session: r.payload });
}
