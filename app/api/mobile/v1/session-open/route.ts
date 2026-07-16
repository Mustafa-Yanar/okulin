import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { tenantRedis, currentOrg } from '@/lib/tenant';
import { orgFromHost } from '@/lib/org';
import { getClientIp } from '@/lib/ratelimit';
import { setSession, type Session } from '@/lib/auth';
import { loadActiveSession } from '@/lib/mobile/sessions';

// Adım 2: WebView bu URL'i yükler → kod tek kullanımlık doğrulanır → KISA ömürlü
// web cookie oturumu (12 saat, JWT exp de 12 saat) kurulur → next'e redirect. iOS cookie
// temizliğine dayanıklılık: WebView cookie kaybederse native taraf yeni exchange yapar (spec §7).
// Bilinçli withAuth istisnası: cookie oturumu BURADA kurulur; tek kullanımlık kod doğrular.
export const runtime = 'nodejs';

const COOKIE_TTL_SEC = 60 * 60 * 12;

interface ExchangeRec { payload: Session; ip: string; sid: string }

export async function GET(req: NextRequest) {
  // Fail-closed tenant (İnceleme Codex #5): auth kuran uç yalnız gerçek kurum host'unda.
  // Apex/bilinmeyen host DEFAULT_ORG'a düşer → varsayılan kurum kodu orada tüketilmesin.
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi' }, { status: 400 });
  }

  const code = req.nextUrl.searchParams.get('code') || '';
  const next = req.nextUrl.searchParams.get('next') || '/';
  // Open-redirect koruması: next'i origin'e karşı çöz, YALNIZ aynı-origin ise path'ini kullan.
  // Regex yetmez — backslash (/\evil) WHATWG URL parser'da // gibi çözülüp harici origin'e
  // yönlendirir. new URL + origin eşitliği tüm varyantları (//, /\, mutlak URL) kapatır.
  let safeNext = '/';
  try {
    const u = new URL(next, req.nextUrl.origin);
    if (u.origin === req.nextUrl.origin) safeNext = u.pathname + u.search + u.hash;
  } catch { /* safeNext '/' kalır */ }
  if (code.length < 20) return NextResponse.json({ error: 'Geçersiz kod' }, { status: 400 });

  // Atomik tek kullanımlık tüketim (İnceleme Gemini #3/Codex #13): getdel — eşzamanlı
  // iki istekten yalnız biri değeri alır (get+del yarışı yok, tek round-trip).
  const rec = await tenantRedis().getdel<ExchangeRec>(`mexch:${code}`);
  if (!rec) return NextResponse.json({ error: 'Kod geçersiz veya kullanılmış' }, { status: 403 });

  // Login-CSRF koruması (Gemini #4): kodu üreten cihazın IP'si eşleşmeli.
  // NOT: dual-stack/hücresel IP değişiminde meşru istek de reddolabilir → native taraf
  // yeni exchange üretir (Plan 3 istemci retry). Defense-in-depth, tek başına faktör değil.
  if (rec.ip !== getClientIp(req)) {
    return NextResponse.json({ error: 'Kod bu cihazda açılamaz' }, { status: 403 });
  }
  // Savunma katmanı: kod zaten tenant-prefix'li anahtarda ama payload org'u da doğrula.
  if (!rec.payload.org || rec.payload.org !== currentOrg()) {
    return NextResponse.json({ error: 'Kod geçersiz veya kullanılmış' }, { status: 403 });
  }
  // İptal yineleme (İnceleme Codex #3a): kod üretildikten sonra 60 sn içinde oturum
  // iptal edildiyse (logout/cihaz iptali/şifre değişimi) cookie KURULMAZ.
  const active = await loadActiveSession(rec.sid);
  if (!active || active.revokedAt || active.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: 'Oturum artık geçerli değil' }, { status: 403 });
  }

  const res = NextResponse.redirect(new URL(safeNext, req.nextUrl.origin), 302);
  await setSession(res, rec.payload, { maxAgeSec: COOKIE_TTL_SEC });
  res.headers.set('Referrer-Policy', 'no-referrer'); // kod query-string'i referer'da sızmasın
  res.headers.set('Cache-Control', 'no-store');
  return res;
}
