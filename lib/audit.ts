import { tdb, withScope } from './sqldb';
import type { Session } from './auth';

// Denetim kaydı (audit log) — kritik işlemlerin izini tutar.
// "Kim, ne zaman, neyi, ne yaptı" sorusuna cevap verir.
//
// Saklama: audit:<ISO-ts>:<rand> string key, 90 gün TTL.
// - String key → backup script'inin GET'iyle uyumlu, yedeklenir
// - ISO timestamp prefix → leksikografik sıralama = kronolojik
// - 90 gün TTL → otomatik temizlik, sınırsız büyümez
//
// ÖNEMLİ: Audit yazımı ana işlemi ASLA bozmaz. Hata olursa sadece uyarı loglar.

export interface AuditEntry {
  actorRole?: string;
  actorName?: string;
  actorId?: string;
  action: string;
  target?: { type?: string; id?: string | null; name?: string | null };
  detail?: string;
  // Serbest ek alanlar — entry olduğu gibi Json'a yazılır (okuma şekli korunur).
  [key: string]: unknown;
}

export interface AuditScope {
  org?: string;
  branch?: string;
}

// entry: { actorRole, actorName, actorId, action, target?, detail? }
//   action örn: 'student.delete', 'finance.payment', 'auth.resetPassword'
//   target örn: { type:'student', id, name }
//   detail: insana okunur kısa özet
// scope (ops.): { org, branch } — istek bağlamı dışı (cron/callback) yazımlarda
//   audit'i AÇIKÇA doğru tenant'a yazmak için. Verilmezse header bağlamı kullanılır.
export async function logAudit(entry: AuditEntry, scope?: AuditScope): Promise<void> {
  try {
    const ts = new Date().toISOString();
    // data = tam entry (okuma şekli birebir korunur); at/actor/action sorgu için.
    await tdb(scope?.org, scope?.branch).auditLog.create({ data: withScope({
      at: new Date(ts), actor: entry.actorName || entry.actorId || null,
      action: entry.action || '', data: { ts, ...entry },
    }) });
  } catch (e) {
    console.warn('[audit] kayıt başarısız:', e instanceof Error ? e.message : e);
  }
}

// session'dan aktör alanlarını çıkarır
export function actorFrom(session: Session | null | undefined): Pick<AuditEntry, 'actorRole' | 'actorName' | 'actorId'> {
  return {
    actorRole: session?.role || 'bilinmiyor',
    actorName: session?.name || 'bilinmiyor',
    actorId: session?.id || 'bilinmiyor',
  };
}
