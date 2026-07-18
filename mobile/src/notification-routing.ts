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
// /?sekme=odeme...). Yönetim WebView'e path'le gider; native rollerde ödev/program
// derin native rotaya (Plan 5), geri kalanı Bugün'e gider (ilgili kartlar orada).
// Yalnız aynı-origin path kabul (// ve mutlak URL ret).
export type UrlTarget =
  | { type: 'today' }
  | { type: 'native'; path: '/odev' | '/hafta' }
  | { type: 'web'; path: string }
  | null;

export function targetForUrl(url: string | null | undefined, role: RoleCategory | null): UrlTarget {
  // Backslash'li path'ler de reddedilir (WHATWG URL \'ı /'a çevirir — derinlemesine savunma;
  // sunucu session-open origin-eşitliği zaten koruyor).
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.includes('\\')) return null;
  if (role === 'management') return { type: 'web', path: url }; // yönetim → WebView (değişmez)
  if (role === null) return null;
  if (url === '/') return null; // kök: inbox'tan gidilecek ek ekran yok
  // Query param'ı GÜVENLİ relative kontrolden SONRA TAM ayrıştır (İnceleme Codex #10: ham
  // substring '/?notab=odev'i yanlış eşlerdi). Sabit origin yalnız parse için (harici çağrı yok).
  let tab: string | null = null,
    sekme: string | null = null;
  try {
    const u = new URL(url, 'https://x.invalid');
    tab = u.searchParams.get('tab');
    sekme = u.searchParams.get('sekme');
  } catch {
    return { type: 'today' };
  }
  if (tab === 'odev') return { type: 'native', path: '/odev' };
  if (sekme === 'program' || tab === 'program') return { type: 'native', path: '/hafta' };
  return { type: 'today' }; // eşlenmeyen (davranış/deneme/form/takvim/ödeme) → Bugün
}
