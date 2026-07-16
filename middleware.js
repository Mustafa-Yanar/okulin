import { NextResponse } from 'next/server';
import { resolveOrg, resolveBranch } from './lib/org';

// ── Multi-tenant kurum çözümleme + CSRF koruması ──────────────────────────
// 1) host'tan kurumu (org) bul, request'e `x-org` header'ı olarak SUNUCU otoritesiyle
//    yaz. Client'ın gönderdiği x-org YOK SAYILIR (güvenlik) — downstream route'lar ve
//    tenantRedis() bu header'dan kurumu okur.
// 2) Mutasyon isteklerinde (POST/PUT/DELETE/PATCH) origin/referer host'u doğrula (CSRF).
//    Bearer (cron/backup, sunucu-sunucu) muaf.

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// /api/mobile/v1 oturumsuz JSON POST uçları — tarayıcı cookie'si TAŞIMAZ (native
// istemci Origin göndermez) → CSRF vektörü yok. YALNIZ bu tam yollar muaf; Bearer
// korumalı uçlar zaten aşağıdaki Bearer istisnasından geçer, session-open GET'tir.
// SÖZLEŞME: bu listeye cookie-auth ile yetkilenen bir uç EKLENEMEZ (Task 11 testi denetler).
const MOBILE_CSRF_EXEMPT = new Set([
  '/api/mobile/v1/resolve-org',
  '/api/mobile/v1/auth/login',
  '/api/mobile/v1/auth/refresh',
]);

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
    // Ödeme sağlayıcı callback'i (PayTR) server-to-server gelir, Origin yok —
    // HMAC hash ile doğrulanır, CSRF'ten muaf.
    const isPaymentCallback = req.nextUrl.pathname === '/api/payment/callback';
    const isMobileExempt = MOBILE_CSRF_EXEMPT.has(req.nextUrl.pathname);
    if (!isBearer && !isPaymentCallback && !isMobileExempt) {
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
