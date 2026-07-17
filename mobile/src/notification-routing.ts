import type { RoleCategory } from './rol';

// Push tap yönlendirmesi (spec §6/6, plan ADR'si): hedef HER ZAMAN Bildirimler
// (+focus) — inbox tam içeriği gösterir ve okundu işaretler. Rol-başına derin
// native rota eşlemesi detay ekranları gelince (Plan 5+).

// FCM data payload'ından eventId (sunucu lib/push/providers.ts data.eventId gönderir).
export function eventIdFrom(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const v = (data as Record<string, unknown>).eventId;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

// Inbox item aksiyonu: NotificationEvent.url web path'i taşır (/?tab=odev,
// /?sekme=odeme...). Yönetim WebView'e path'le gider; native roller Bugün'e
// (ilgili kartlar orada). Yalnız aynı-origin path kabul (// ve mutlak URL ret).
export type UrlTarget = { type: 'today' } | { type: 'web'; path: string } | null;

export function targetForUrl(url: string | null | undefined, role: RoleCategory | null): UrlTarget {
  if (!url || !url.startsWith('/') || url.startsWith('//')) return null;
  if (role === 'management') return { type: 'web', path: url };
  if (role === null) return null;
  if (url === '/') return null; // kök: inbox'tan gidilecek ek ekran yok
  return { type: 'today' };
}
