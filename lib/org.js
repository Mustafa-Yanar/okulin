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

// Host subdomain etiketleri (APP_DOMAIN'in altındaki kısım), yoksa null.
// "cozum.etuttakip.app"        → ["cozum"]
// "akyazi.cozum.etuttakip.app" → ["akyazi","cozum"]  (şube.kurum)
function labelsFromHost(host) {
  if (!host) return null;
  const h = host.split(':')[0].toLowerCase(); // portu at
  if (!APP_DOMAIN) return null;               // domain henüz yok → DEFAULT_ORG'a bırak
  if (h === APP_DOMAIN) return null;          // apex → kurum yok
  const suffix = `.${APP_DOMAIN}`;
  if (!h.endsWith(suffix)) return null;       // başka domain (vercel/preview/local) → DEFAULT_ORG
  const label = h.slice(0, -suffix.length);
  if (!label || label === 'www') return null; // www apex sayılır
  return label.split('.');
}

// Host'tan kurum slug'ı (yoksa null). Kurum = EN SAĞDAKİ etiket (şube.kurum.domain).
export function orgFromHost(host) {
  const labels = labelsFromHost(host);
  if (!labels) return null;
  return sanitizeSlug(labels[labels.length - 1]);
}

// Host'tan şube slug'ı (yoksa null → 'main'). Şube = EN SOLDAKİ etiket, ancak
// en az iki etiket varsa (şube.kurum). Tek etiket (kurum.domain) → şube yok.
export function branchFromHost(host) {
  const labels = labelsFromHost(host);
  if (!labels || labels.length < 2) return null;
  return sanitizeSlug(labels[0]);
}

// Çözülen org (yoksa varsayılan). Tek geçiş noktası.
export function resolveOrg(host) {
  return orgFromHost(host) || DEFAULT_ORG;
}

// Çözülen şube (yoksa 'main'). Tek geçiş noktası.
export function resolveBranch(host) {
  return branchFromHost(host) || 'main';
}

// Host apex mi (okulin.com / www.okulin.com)? Apex = tanıtım sayfası, kurum değil.
export function isApexHost(host) {
  if (!host || !APP_DOMAIN) return false;
  const h = host.split(':')[0].toLowerCase();
  return h === APP_DOMAIN || h === `www.${APP_DOMAIN}`;
}

// Platform (okulin) markası — apex tanıtım sayfası için (kurum-bağımsız).
export const PLATFORM_BRANDING = {
  name: 'okulin',
  shortName: 'okulin',
  logoUrl: '',
  themeColor: '#6366f1',
};
