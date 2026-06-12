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
