import { tdb } from './sqldb';

// İstemci/sunucu hata loglama — üçüncü taraf YOK, her şey kendi Redis'inde.
// Audit log ile aynı desen: errlog:<ISO-ts>:<rand> string key, 30 gün TTL.
// - String key → backup script'iyle uyumlu
// - ISO timestamp prefix → leksikografik sıralama = kronolojik
// - 30 gün TTL → otomatik temizlik
//
// ÖNEMLİ: Loglama hiçbir akışı bozmaz; hata olursa sessizce yutulur.

// Aşırı uzun alanları kırp (kayıt şişmesini ve DoS'u önler).
function clip(v, max) {
  if (typeof v !== 'string') return '';
  return v.length > max ? v.slice(0, max) : v;
}

// entry: { message, stack?, source?, url?, componentStack?, userAgent?, role?, userId?, userName? }
export async function logError(entry) {
  try {
    const ts = new Date().toISOString();
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
    await tdb().errLog.create({ data: { at: new Date(ts), message: record.message, data: record } });
  } catch (e) {
    console.warn('[errlog] kayıt başarısız:', e?.message);
  }
}

// Son hata kayıtlarını döndürür (yeniden eskiye, en fazla 500).
export async function getErrors() {
  const rows = await tdb().errLog.findMany({ orderBy: { at: 'desc' }, take: 500 });
  return rows.map(r => r.data);
}
