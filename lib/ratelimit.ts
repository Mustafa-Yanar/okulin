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

// Login: 5 deneme / 15 dakika (sliding window)
// NOT: sayaç HER denemede artar (başarılı dahil) — route'lar safeLimit'i şifre
// doğrulamadan ÖNCE çağırır. Sık başarılı giriş de pencereyi doldurabilir.
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

// Kurum kodu (landing gate): 10 deneme / 10 dakika (IP başına).
// Kod enumerasyonunu (brute-force) yavaşlatır; meşru kullanıcı bir kez girer.
export const gateRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 m'),
  analytics: false,
  prefix: 'rl:gate',
});

// Demo/iletişim talebi (landing): 3 talep / 10 dakika (IP başına).
// Form spam'ini durdurur; meşru ziyaretçi bir kez gönderir.
export const demoRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(3, '10 m'),
  analytics: false,
  prefix: 'rl:demo',
});

// Hata loglama: 30 kayıt / 1 dakika (IP başına).
// Gerçek hata patlamalarına izin verir ama endpoint spam'ini durdurur.
export const errorLogRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, '1 m'),
  analytics: false,
  prefix: 'rl:errlog',
});

// Mobil push cihaz kaydı: 20 kayıt / 10 dakika (IP başına).
// Meşru istemci login/açılış/rotasyon başına 1 kayıt yapar; token-flood'u keser.
export const mobileRegisterRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, '10 m'),
  analytics: false,
  prefix: 'rl:mreg',
});

// Mobil refresh: 120 istek / 10 dakika (IP başına — NAT arkasında çok cihaz olabilir;
// meşru cihaz ~15 dk'da 1 refresh yapar). Refresh-token taramasını yavaşlatır
// (Plan 2 devri Codex #10/#11'in IP katmanı).
export const mobileRefreshRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(120, '10 m'),
  analytics: false,
  prefix: 'rl:mref',
});

// Mobil içerik uçları (screens/today, notifications): 240 istek / 10 dk — yalnız
// oturum (sid) kovası. IP kovası bilinçli YOK: okul NAT'ında sabah yoğunluğu meşru
// trafiği keserdi; token'sız istek zaten withMobileAuth'ta 401 yer (plan ADR'si).
export const mobileContentRatelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(240, '10 m'),
  analytics: false,
  prefix: 'rl:mcnt',
});

export interface LimitResult {
  success: boolean;
  reset: number;
  limit: number;
  remaining: number;
}

// Fail-open rate limit: Redis erişilemezse (kesinti/timeout) isteği ENGELLEMEZ.
// Gerekçe: rate limit brute-force'u YAVAŞLATMA katmanıdır, kimlik doğrulama DEĞİL.
// Redis bir an düşerse tüm login/şifre/gate uçlarının 500 dönüp kimsenin giriş
// yapamaması, kısa süreli korumasızlıktan daha kötü (auth + bcrypt zaten devrede).
// Redis çalışırken normal koruma aynen sürer.
export async function safeLimit(limiter: Ratelimit, key: string): Promise<LimitResult> {
  try {
    return await limiter.limit(key);
  } catch (e) {
    console.warn('[ratelimit] Redis erişilemedi, limit atlanıyor (fail-open):', e instanceof Error ? e.message : e);
    return { success: true, reset: 0, limit: 0, remaining: 0 };
  }
}

// İstemci IP'sini header'lardan çıkarır.
// Vercel proxy'sinin koyduğu x-forwarded-for ilk olarak alınır.
// Fallback: x-real-ip, sonra 'unknown' (limit yine de geçerli ama tüm 'unknown' tek key olur).
export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}

// Süper-admin IP kısıtı — env `SUPERADMIN_ALLOWED_IPS` (virgülle ayrılmış liste).
// Tanımsız/boş = kısıt YOK (varsayılan). Tek hesabın dinamik/değişken IP'den kilitlenme
// riskini sıfırlamak için bilinçli tercih — kurulunca yalnız listedeki IP'ler girebilir.
export function isSuperadminIpAllowed(ip: string): boolean {
  const raw = process.env.SUPERADMIN_ALLOWED_IPS;
  if (!raw || !raw.trim()) return true;
  const allowed = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.includes(ip);
}

// Kalan süreyi insan-okunabilir Türkçe metne çevirir
// reset: ms epoch
export function formatResetWait(reset: number): string {
  const remainingMs = reset - Date.now();
  if (remainingMs <= 0) return 'birazdan';
  const minutes = Math.ceil(remainingMs / 60000);
  if (minutes < 1) return 'birkaç saniye sonra';
  if (minutes === 1) return '1 dakika sonra';
  if (minutes < 60) return `${minutes} dakika sonra`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} saat sonra`;
}
