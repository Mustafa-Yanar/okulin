// Kurum markalama (multi-tenant Faz B) — SAF yardımcılar.
// Burada Redis/next import YOK → hem server route'lar hem client (page.js) güvenle import eder.
// Marka verisi `org:<slug>` kaydında durur: { name, shortName?, logoUrl?, themeColor? }.

export const BRANDING_DEFAULTS = {
  name: 'Etüt Takip',
  shortName: 'Etüt Takip',
  logoUrl: '', // boş = logo yok → arayüz marka ikonuna (gradyan + BookOpen) düşer
  themeColor: '#6366f1',
};

// #RRGGBB doğrulaması.
export function isValidHex(c) {
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);
}

// org kaydından (veya null) görünür marka üret — eksik alanlar varsayılana düşer.
export function normalizeBranding(orgRec) {
  const name = (orgRec?.name || '').trim() || BRANDING_DEFAULTS.name;
  return {
    name,
    shortName: (orgRec?.shortName || '').trim() || name,
    logoUrl: (orgRec?.logoUrl || '').trim(),
    themeColor: isValidHex(orgRec?.themeColor) ? orgRec.themeColor : BRANDING_DEFAULTS.themeColor,
  };
}

// hex'i koyulaştır (amt<0) / açıklaştır (amt>0), -1..1. Gradient ikinci durağı için.
export function shade(hex, amt) {
  const base = isValidHex(hex) ? hex : BRANDING_DEFAULTS.themeColor;
  let r = parseInt(base.slice(1, 3), 16);
  let g = parseInt(base.slice(3, 5), 16);
  let b = parseInt(base.slice(5, 7), 16);
  const target = amt < 0 ? 0 : 255;
  const p = Math.abs(amt);
  r = Math.round((target - r) * p) + r;
  g = Math.round((target - g) * p) + g;
  b = Math.round((target - b) * p) + b;
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Marka ana gradyanı (login ikonu, vurgu alanları).
export function brandGradient(themeColor) {
  const c = isValidHex(themeColor) ? themeColor : BRANDING_DEFAULTS.themeColor;
  return `linear-gradient(135deg, ${c}, ${shade(c, -0.18)})`;
}
