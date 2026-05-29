/** @type {import('next').NextConfig} */

// Güvenlik header'ları — tüm rotalara uygulanır (defense in depth, CSRF middleware'i tamamlar).
// CSP pragmatik: inline SW script + 297 inline style + Next.js hydration için 'unsafe-inline'
// gerekli. Asıl koruma frame-ancestors/object-src/base-uri/form-action'da. Google Fonts izinli.
// (Gelecekte nonce tabanlı katı CSP'ye geçilebilir.)
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  // /solve → kök api/solve.py (Vercel Python function). /solve Next route alanında
  // olmadığı için app/api/* route'larının hiçbiriyle çakışmaz.
  async rewrites() {
    return [{ source: '/solve', destination: '/api/solve' }];
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};
module.exports = nextConfig;
