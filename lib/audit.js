import { tenantRedis } from './tenant';

// Denetim kaydı (audit log) — kritik işlemlerin izini tutar.
// "Kim, ne zaman, neyi, ne yaptı" sorusuna cevap verir.
//
// Saklama: audit:<ISO-ts>:<rand> string key, 90 gün TTL.
// - String key → backup script'inin GET'iyle uyumlu, yedeklenir
// - ISO timestamp prefix → leksikografik sıralama = kronolojik
// - 90 gün TTL → otomatik temizlik, sınırsız büyümez
//
// ÖNEMLİ: Audit yazımı ana işlemi ASLA bozmaz. Hata olursa sadece uyarı loglar.

const TTL_90_DAYS = 60 * 60 * 24 * 90;

// entry: { actorRole, actorName, actorId, action, target?, detail? }
//   action örn: 'student.delete', 'finance.payment', 'auth.resetPassword'
//   target örn: { type:'student', id, name }
//   detail: insana okunur kısa özet
// scope (ops.): { org, branch } — istek bağlamı dışı (cron/callback) yazımlarda
//   audit'i AÇIKÇA doğru tenant'a yazmak için. Verilmezse header bağlamı kullanılır.
export async function logAudit(entry, scope) {
  try {
    const redis = tenantRedis(scope?.org, scope?.branch);
    const ts = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `audit:${ts}:${rand}`;
    await redis.set(key, { ts, ...entry }, { ex: TTL_90_DAYS });
  } catch (e) {
    console.warn('[audit] kayıt başarısız:', e?.message);
  }
}

// session'dan aktör alanlarını çıkarır
export function actorFrom(session) {
  return {
    actorRole: session?.role || 'bilinmiyor',
    actorName: session?.name || 'bilinmiyor',
    actorId: session?.id || 'bilinmiyor',
  };
}
