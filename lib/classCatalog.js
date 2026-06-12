// İstemci-güvenli (redis YOK) şube yardımcıları — registry classes[] dizisi üzerinde
// saf fonksiyonlar. /api/classes'tan gelen listeyi tüketen UI bileşenleri bunu kullanır;
// böylece sabit-kod (lib/constants) yerine kurumun gerçek şubelerinden okur.
// Sunucu tarafı eşdeğeri: lib/classes.js (getClasses/getClass, registry-aware).

export function findClass(classes, id) {
  return (classes || []).find((c) => c.id === id) || null;
}

// Şube etiketi: registry'de varsa ad, yoksa fallback (fonksiyon ya da değer; ör. constants.classLabel).
export function classLabelFrom(classes, id, fallback) {
  const c = findClass(classes, id);
  if (c?.ad) return c.ad;
  if (typeof fallback === 'function') return fallback(id);
  return fallback ?? id;
}

// Köprü grubuna (ortaokul|lise|mezun|ilkokul) göre şubeler.
export function classesForGroup(classes, group) {
  return (classes || []).filter((c) => c.group === group);
}

// Şubenin gördüğü dersler (key listesi) — registry'de varsa.
export function coursesForClass(classes, id) {
  return findClass(classes, id)?.dersler || null;
}

// Kompakt görünüm (grid/çip): eski kodlu şube (701/m1) kodun kendisini gösterir (kompakt);
// özel şube (s_…) okunur kısa adını (ad) gösterir.
export function classShort(classes, id) {
  if (/^s_/.test(id)) return findClass(classes, id)?.ad || id;
  return id;
}

const GROUP_ORDER = ['ilkokul', 'ortaokul', 'lise', 'mezun'];
const GROUP_LABELS = { ilkokul: 'İlkokul', ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

// Şubeleri köprü grubuna göre, sabit sırada grupla — hedefleme ağaçları için.
// → [{ key, label, items: [{ id, ad }] }]  (boş gruplar atlanır)
export function groupedClasses(classes) {
  const byGroup = new Map();
  for (const c of classes || []) {
    if (!byGroup.has(c.group)) byGroup.set(c.group, []);
    byGroup.get(c.group).push({ id: c.id, ad: c.ad || c.id });
  }
  const known = GROUP_ORDER.filter((g) => byGroup.has(g));
  const extra = [...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g));
  return [...known, ...extra].map((key) => ({
    key,
    label: GROUP_LABELS[key] || key,
    items: byGroup.get(key),
  }));
}
