// Saf (edge-güvenli) kurum çözümleme — hiç node bağımlılığı yok.
// Hem middleware (edge) hem tenant.js (node) buradan okur.
//
// Kurum (org) host'tan belirlenir:
//   cozum.etuttakip.app          → "cozum"   (APP_DOMAIN'in subdomain'i)
//   etuttakip.app / www.…        → null      (apex/www → kurum yok)
//   cozumetut.vercel.app / local → null      (APP_DOMAIN dışı → çağıran DEFAULT_ORG'a düşer)
//
// APP_DOMAIN tanımlı değilken (domain henüz alınmadı) her host null döner →
// uygulama DEFAULT_ORG ile çalışır (mevcut cozumetut.vercel.app korunur).

export const DEFAULT_ORG = process.env.DEFAULT_ORG || 'cozum';
export const APP_DOMAIN = process.env.APP_DOMAIN || ''; // örn. "etuttakip.app"

// Slug'ı güvenli hale getir: küçük harf, yalnız [a-z0-9-], makul uzunluk.
function sanitizeSlug(s) {
  const clean = String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  return clean.length >= 1 && clean.length <= 40 ? clean : null;
}

// Host'tan kurum slug'ı (yoksa null). Port varsa atılır.
export function orgFromHost(host) {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase(); // portu at
  if (!APP_DOMAIN) return null;               // domain henüz yok → DEFAULT_ORG'a bırak

  if (h === APP_DOMAIN) return null;          // apex → kurum yok
  const suffix = `.${APP_DOMAIN}`;
  if (!h.endsWith(suffix)) return null;       // başka domain (vercel/preview/local) → DEFAULT_ORG

  const label = h.slice(0, -suffix.length);   // "cozum" ya da "a.b" (çok seviyeli)
  if (!label || label === 'www') return null; // www apex sayılır
  // İlk etiketi al (çok seviyeli subdomain'lerde en soldaki) — Faz D şube için yeterli temel.
  const first = label.split('.')[0];
  return sanitizeSlug(first);
}

// Çözülen org (yoksa varsayılan). Tek geçiş noktası.
export function resolveOrg(host) {
  return orgFromHost(host) || DEFAULT_ORG;
}
