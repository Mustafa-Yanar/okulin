import { tenantRedis } from './tenant';

// İstemci/sunucu hata loglama — üçüncü taraf YOK, her şey kendi Redis'inde.
// Audit log ile aynı desen: errlog:<ISO-ts>:<rand> string key, 30 gün TTL.
// - String key → backup script'iyle uyumlu
// - ISO timestamp prefix → leksikografik sıralama = kronolojik
// - 30 gün TTL → otomatik temizlik
//
// ÖNEMLİ: Loglama hiçbir akışı bozmaz; hata olursa sessizce yutulur.

const TTL_30_DAYS = 60 * 60 * 24 * 30;

// Aşırı uzun alanları kırp (Redis şişmesini ve DoS'u önler).
function clip(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

// entry: { message, stack?, source?, url?, componentStack?, userAgent?, role?, userId?, userName? }
export async function logError(entry) {
  try {
    const redis = tenantRedis();
    const ts = new Date().toISOString();
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `errlog:${ts}:${rand}`;
    const record = {
      ts,
      message: clip(entry.message, 2000),
      stack: clip(entry.stack, 8000),
      source: clip(entry.source, 40) || 'manual',
      url: clip(entry.url, 500),
      componentStack: clip(entry.componentStack, 8000),
      userAgent: clip(entry.userAgent, 500),
      role: clip(entry.role, 40),
      userId: clip(entry.userId, 100),
      userName: clip(entry.userName, 200),
    };
    await redis.set(key, record, { ex: TTL_30_DAYS });
  } catch (e) {
    console.warn('[errlog] kayıt başarısız:', e?.message);
  }
}

// Son hata kayıtlarını döndürür (yeniden eskiye, en fazla 500).
export async function getErrors() {
  const redis = tenantRedis();
  const entries = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'errlog:*', count: 200 });
    cursor = String(next);
    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      keys.forEach(k => pipeline.get(k));
      const vals = await pipeline.exec();
      vals.forEach(v => { if (v) entries.push(v); });
    }
  } while (cursor !== '0');
  entries.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return entries.slice(0, 500);
}
