import { NextResponse } from 'next/server';

// ── CSRF koruması (Madde 12) ──────────────────────────────────────────────
// Mutasyon yapan tüm /api isteklerinde (POST/PUT/DELETE/PATCH) isteğin
// uygulamanın kendi origin'inden geldiğini doğrular. sameSite:lax cookie'nin
// üstüne ikinci savunma katmanı (OWASP önerisi).
//
// İzin verilenler:
//  - Mutasyon olmayan metodlar (GET/HEAD/OPTIONS) — serbest
//  - Authorization: Bearer ... — sunucu-sunucu (cron, backup). Kendi
//    secret'larıyla zaten korunuyor; bu istekler tarayıcıdan gelmez.
//  - Origin (yoksa Referer) host'u, isteğin host'u ile eşleşiyorsa
//
// Reddedilenler: çapraz-site form/fetch saldırıları → 403.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

export function middleware(req) {
  if (!MUTATING_METHODS.has(req.method)) {
    return NextResponse.next();
  }

  // Sunucu-sunucu çağrılar (cron/backup) Bearer ile korunuyor, tarayıcı kaynaklı değil
  const authHeader = req.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return NextResponse.next();
  }

  const host = req.headers.get('host');
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');

  // Origin öncelikli — modern tarayıcılar mutasyon isteklerinde her zaman gönderir
  const source = origin || referer;
  if (!source) {
    return NextResponse.json(
      { error: 'İstek kaynağı doğrulanamadı (CSRF koruması)' },
      { status: 403 }
    );
  }

  let sourceHost;
  try {
    sourceHost = new URL(source).host;
  } catch {
    return NextResponse.json(
      { error: 'Geçersiz istek kaynağı (CSRF koruması)' },
      { status: 403 }
    );
  }

  if (sourceHost !== host) {
    return NextResponse.json(
      { error: 'Geçersiz istek kaynağı (CSRF koruması)' },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

// Sadece API rotalarına uygula. /solve (Python çözücü) /api altında olmadığı
// için zaten kapsam dışı.
export const config = {
  matcher: '/api/:path*',
};
