import { NextResponse } from 'next/server';
import { resolveOrg, resolveBranch } from './lib/org';

// ── Multi-tenant kurum çözümleme + CSRF koruması ──────────────────────────
// 1) host'tan kurumu (org) bul, request'e `x-org` header'ı olarak SUNUCU otoritesiyle
//    yaz. Client'ın gönderdiği x-org YOK SAYILIR (güvenlik) — downstream route'lar ve
//    tenantRedis() bu header'dan kurumu okur.
// 2) Mutasyon isteklerinde (POST/PUT/DELETE/PATCH) origin/referer host'u doğrula (CSRF).
//    Bearer (cron/backup, sunucu-sunucu) muaf.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function csrfFail() {
  return NextResponse.json(
    { error: 'Geçersiz istek kaynağı (CSRF koruması)' },
    { status: 403 }
  );
}

export function middleware(req) {
  const host = req.headers.get('host');
  const org = resolveOrg(host);
  const branch = resolveBranch(host);

  // İsteğe x-org + x-branch'i otoriter olarak yaz (client değeri ezilir).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-org', org);
  requestHeaders.set('x-branch', branch);

  // CSRF — yalnız mutasyon metodlarında
  if (MUTATING_METHODS.has(req.method)) {
    const authHeader = req.headers.get('authorization');
    const isBearer = authHeader && authHeader.startsWith('Bearer ');
    if (!isBearer) {
      const source = req.headers.get('origin') || req.headers.get('referer');
      if (!source) return csrfFail();
      let sourceHost;
      try {
        sourceHost = new URL(source).host;
      } catch {
        return csrfFail();
      }
      if (sourceHost !== host) return csrfFail();
    }
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

// Sadece API rotalarına uygula. /solve (Python çözücü) /api altında olmadığı için kapsam dışı.
export const config = {
  matcher: '/api/:path*',
};
