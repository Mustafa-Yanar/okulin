// Kurum kodu — kuruma özel, tahmin edilemez giriş kodu (subdomain'i gizler).
// Landing'de kullanıcı kodu girer → orgcode:<KOD> ters aramasıyla hedef subdomain
// çözülür → o adrese yönlendirilir. Kod ≠ subdomain (gizlilik / "ada modeli").
//
// Redis şeması (global, t: prefix YOK — apex/landing kurum-bağımsız çözer):
//   org:<slug>           → kurum kaydına `code` alanı eklenir
//   orgcode:<KOD>        → { slug, branch, name, host }   (ters arama)
// KOD normalize: büyük harf, yalnız güvenli alfabe, tireler/boşluklar atılır.

// Karışması kolay karakterler çıkarıldı (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Yeni kurum kodu üret (6 karakter). Gösterimde XXX-XXX biçimlenir, saklamada düz.
export function generateOrgCode(len = 6): string {
  let out = '';
  // crypto varsa onu kullan (Node + Edge uyumlu), yoksa Math.random fallback.
  const cryptoObj = (typeof globalThis !== 'undefined' && globalThis.crypto) ? globalThis.crypto : null;
  if (cryptoObj && cryptoObj.getRandomValues) {
    const arr = new Uint32Array(len);
    cryptoObj.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += ALPHABET[arr[i] % ALPHABET.length];
  } else {
    for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

// Kullanıcı girişini normalize et (büyük harf, güvenli alfabe dışı her şeyi at).
export function normalizeCode(input: unknown): string {
  return String(input || '')
    .toUpperCase()
    .split('')
    .filter(ch => ALPHABET.includes(ch))
    .join('');
}

// Gösterim biçimi: ABC123 → ABC-123 (6 hane için ortadan böl).
export function formatCode(code: unknown): string {
  const c = normalizeCode(code);
  if (c.length === 6) return `${c.slice(0, 3)}-${c.slice(3)}`;
  return c;
}

// Tek kurum (şubesiz) için hedef host. Şube varsa <branch>.<slug>.
export function hostForOrg(slug: string, branch = 'main', appDomain = process.env.APP_DOMAIN || 'okulin.com'): string {
  if (branch && branch !== 'main') return `${branch}.${slug}.${appDomain}`;
  return `${slug}.${appDomain}`;
}
