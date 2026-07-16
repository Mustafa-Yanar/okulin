import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withMobileAuth } from '@/lib/mobile/auth';
import { tenantRedis } from '@/lib/tenant';
import { getClientIp } from '@/lib/ratelimit';

// Native → WebView oturum aktarımı, adım 1 (spec §5.3/§7): Bearer ile tek
// kullanımlık kod üret. Kod 60 sn yaşar, tenant-scoped Redis'te durur — yalnız
// aynı kurum host'unda açılabilir. WebView refresh token'ı HİÇ görmez; kod yalnız
// oturum payload'ını taşır.
// İnceleme (Gemini #4): login-CSRF / session-donation koruması — kodu ÜRETEN cihazın
// IP'si payload'a gömülür; session-open aynı IP'yi ister (saldırganın kodu kurbanın
// tarayıcısında açılamaz).
export const runtime = 'nodejs';

const EXCHANGE_TTL_SEC = 60;

export const POST = withMobileAuth(async (req, _ctx, session) => {
  const code = randomBytes(32).toString('base64url');
  // JWT meta dışarıda — cookie payload'ı web Session şekliyle birebir. sid AYRICA
  // saklanır: session-open kodu cookie'ye çevirirken oturum HÂLÂ aktif mi diye
  // yineler (kod üretildikten sonra 60 sn içinde logout olursa cookie kurulmaz —
  // İnceleme Codex #3a).
  const { iat, exp, aud, iss, sid, ...payload } = session;
  await tenantRedis().set(
    `mexch:${code}`,
    { payload, ip: getClientIp(req), sid },
    { ex: EXCHANGE_TTL_SEC },
  );
  const res = NextResponse.json({ code, expiresIn: EXCHANGE_TTL_SEC });
  res.headers.set('Cache-Control', 'no-store'); // kod proxy/CDN'de cache'lenmesin
  return res;
});
