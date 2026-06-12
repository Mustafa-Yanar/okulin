// Kurum facet'leri — kurum türü modeli (sektör / mülkiyet / kademe).
// Tek-ağaç taksonomi DEĞİL; 4 bağımsız eksen: sektör, mülkiyet, ölçek(=multi-tenant
// org/branch — burada değil), kademe (çok-seçimli küme). UI + API ortak kaynağı.
// Detay: hafıza "kurum-turu-sinif-modeli".

export const SEKTORLER = [
  { key: 'dershane', label: 'Dershane / Kurs' },
  { key: 'okul', label: 'Okul' },
];

export const MULKIYETLER = [
  { key: 'ozel', label: 'Özel' },
  { key: 'devlet', label: 'Devlet' },
];

export const KADEMELER = [
  { key: 'ilkokul', label: 'İlkokul (1-4)' },
  { key: 'ortaokul', label: 'Ortaokul (5-8)' },
  { key: 'lise', label: 'Lise (9-12)' },
  { key: 'mezun', label: 'Mezun' },
];

// Sektöre göre SUNULABİLİR kademeler (S1 şablonu): dershane'de İlkokul yok, okulda Mezun yok.
// Ortak: Ortaokul + Lise. Kurum yalnız sahip olduğu kademeleri seçer (küme).
export function kademelerForSektor(sektor) {
  if (sektor === 'okul') return ['ilkokul', 'ortaokul', 'lise'];
  return ['ortaokul', 'lise', 'mezun']; // dershane (varsayılan)
}

// Form ön-seçimi — sektör seçilince tüm sunulabilir kademeler işaretli gelir.
export function defaultKademeler(sektor) {
  return kademelerForSektor(sektor);
}

// Eski/eksik org kaydına okuma-anı varsayılanı uygula (geriye-uyum, additive).
// Mevcut kurumlar (facet alanı olmayan) dershane/özel + sektör kademeleri sayılır.
export function normalizeFacets(org = {}) {
  const sektor = org.sektor === 'okul' ? 'okul' : 'dershane';
  const mulkiyet = sektor === 'dershane' ? 'ozel' : (org.mulkiyet === 'devlet' ? 'devlet' : 'ozel');
  const allowed = kademelerForSektor(sektor);
  const kademeler = Array.isArray(org.kademeler) && org.kademeler.length
    ? org.kademeler.filter((k) => allowed.includes(k))
    : allowed;
  return { sektor, mulkiyet, kademeler };
}
