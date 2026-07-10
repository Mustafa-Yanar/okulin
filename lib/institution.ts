// Kurum facet'leri — kurum türü modeli (sektör / mülkiyet / kademe).
// Tek-ağaç taksonomi DEĞİL; 4 bağımsız eksen: sektör, mülkiyet, ölçek(=multi-tenant
// org/branch — burada değil), kademe (çok-seçimli küme). UI + API ortak kaynağı.
// Detay: hafıza "kurum-turu-sinif-modeli".

export type Sektor = 'dershane' | 'okul';
export type Mulkiyet = 'ozel' | 'devlet';
export type Kademe = 'ilkokul' | 'ortaokul' | 'lise' | 'mezun';

export const SEKTORLER: { key: Sektor; label: string }[] = [
  { key: 'dershane', label: 'Dershane / Kurs' },
  { key: 'okul', label: 'Okul' },
];

export const MULKIYETLER: { key: Mulkiyet; label: string }[] = [
  { key: 'ozel', label: 'Özel' },
  { key: 'devlet', label: 'Devlet' },
];

export const KADEMELER: { key: Kademe; label: string }[] = [
  { key: 'ilkokul', label: 'İlkokul (1-4)' },
  { key: 'ortaokul', label: 'Ortaokul (5-8)' },
  { key: 'lise', label: 'Lise (9-12)' },
  { key: 'mezun', label: 'Mezun' },
];

// Sektöre göre SUNULABİLİR kademeler (S1 şablonu): dershane'de İlkokul yok, okulda Mezun yok.
// Ortak: Ortaokul + Lise. Kurum yalnız sahip olduğu kademeleri seçer (küme).
export function kademelerForSektor(sektor: string | null | undefined): Kademe[] {
  if (sektor === 'okul') return ['ilkokul', 'ortaokul', 'lise'];
  return ['ortaokul', 'lise', 'mezun']; // dershane (varsayılan)
}

// Form ön-seçimi — sektör seçilince tüm sunulabilir kademeler işaretli gelir.
export function defaultKademeler(sektor: string | null | undefined): Kademe[] {
  return kademelerForSektor(sektor);
}

// Facet alanları taşıyan (eski/eksik olabilir) kurum kaydı görünümü.
export interface OrgFacetsInput {
  sektor?: string | null;
  mulkiyet?: string | null;
  kademeler?: unknown;
}

export interface OrgFacets {
  sektor: Sektor;
  mulkiyet: Mulkiyet;
  kademeler: Kademe[];
}

// Eski/eksik org kaydına okuma-anı varsayılanı uygula (geriye-uyum, additive).
// Mevcut kurumlar (facet alanı olmayan) dershane/özel + sektör kademeleri sayılır.
export function normalizeFacets(org: OrgFacetsInput = {}): OrgFacets {
  const sektor: Sektor = org.sektor === 'okul' ? 'okul' : 'dershane';
  const mulkiyet: Mulkiyet = sektor === 'dershane' ? 'ozel' : (org.mulkiyet === 'devlet' ? 'devlet' : 'ozel');
  const allowed = kademelerForSektor(sektor);
  const kademeler = Array.isArray(org.kademeler) && org.kademeler.length
    ? (org.kademeler as Kademe[]).filter((k) => allowed.includes(k))
    : allowed;
  return { sektor, mulkiyet, kademeler };
}
