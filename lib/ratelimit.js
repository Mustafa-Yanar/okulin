// Rate limiter — Upstash Ratelimit + mevcut Redis client'ı kullanır.
// Login ve şifre değiştirme gibi brute-force hedefi olan endpoint'leri korur.
//
// Strateji: IP + username birleşik key.
// - Tek IP'den farklı username deneme: her username için ayrı sayaç → çok kullanıcılı NAT (okul WiFi) engellenmez
// - Aynı IP+username 5 deneme/15 dk → hesap brute-force engellenir
//
// Limit aşılırsa endpoint 429 + Türkçe mesaj döner.

import { Ratelimit } from '@upstash/ratelimit';
import redis from './redis';

// Login: 5 başarısız deneme / 15 dakika (sliding window)
// Başarılı login sayaca dahil edilmez — sadece başarısızlıkta artar (login route'da yönetiliyor)
export const loginRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '15 m'),
  analytics: false,
  prefix: 'rl:login',
});

// Şifre değiştirme: 5 deneme / 1 dakika
// Oturumu kapılmış birinin mevcut şifre tahmin etmesini yavaşlatır
export const passwordChangeRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, '1 m'),
  analytics: false,
  prefix: 'rl:pwchange',
});

// İstemci IP'sini header'lardan çıkarır.
// Vercel proxy'sinin koyduğu x-forwarded-for ilk olarak alınır.
// Fallback: x-real-ip, sonra 'unknown' (limit yine de geçerli ama tüm 'unknown' tek key olur).
export function getClientIp(req) {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

// Kalan süreyi insan-okunabilir Türkçe metne çevirir
// reset: ms epoch
export function formatResetWait(reset) {
  const remainingMs = reset - Date.now();
  if (remainingMs <= 0) return 'birazdan';
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 1) return 'birkaç saniye sonra';
  if (minutes === 1) return '1 dakika sonra';
  if (minutes < 60) return `${minutes} dakika sonra`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} saat sonra`;
}
