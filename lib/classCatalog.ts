// İstemci-güvenli (redis YOK) şube yardımcıları — registry classes[] dizisi üzerinde
// saf fonksiyonlar. /api/classes'tan gelen listeyi tüketen UI bileşenleri bunu kullanır;
// böylece sabit-kod (lib/constants) yerine kurumun gerçek şubelerinden okur.
// Sunucu tarafı eşdeğeri: lib/classes.js (getClasses/getClass, registry-aware).

// /api/classes'ın döndürdüğü kayıt görünümü (registry satırı).
export interface ClassEntry {
  id: string;
  ad?: string | null;
  group?: string | null;
  dersler?: string[] | null;
}

export function findClass(classes: ClassEntry[] | null | undefined, id: string): ClassEntry | null {
  return (classes || []).find((c) => c.id === id) || null;
}

// Şube etiketi: registry'de varsa ad, yoksa fallback (fonksiyon ya da değer; ör. constants.classLabel).
export function classLabelFrom(
  classes: ClassEntry[] | null | undefined,
  id: string,
  fallback?: string | ((id: string) => string),
): string {
  const c = findClass(classes, id);
  if (c?.ad) return c.ad;
  if (typeof fallback === 'function') return fallback(id);
  return fallback ?? id;
}

// Köprü grubuna (ortaokul|lise|mezun|ilkokul) göre şubeler.
export function classesForGroup(classes: ClassEntry[] | null | undefined, group: string): ClassEntry[] {
  return (classes || []).filter((c) => c.group === group);
}

// Şubenin gördüğü dersler (key listesi) — registry'de varsa.
export function coursesForClass(classes: ClassEntry[] | null | undefined, id: string): string[] | null {
  return findClass(classes, id)?.dersler || null;
}

// Kompakt görünüm (grid/çip): eski kodlu şube (701/m1) kodun kendisini gösterir (kompakt);
// özel şube (s_…) okunur kısa adını (ad) gösterir.
export function classShort(classes: ClassEntry[] | null | undefined, id: string): string {
  if (/^s_/.test(id)) return findClass(classes, id)?.ad || id;
  return id;
}

// classShort'un büyük-harf varyantı: eski kod BÜYÜK gösterilir (m1→M1, eski davranış),
// özel şube (s_…) kayıtlı adını OLDUĞU GİBİ gösterir (UUID'yi büyütmek anlamsız; ad
// zaten kullanıcının yazdığı biçimdedir). `cls.toUpperCase()` kalıbının yerine geçer —
// o kalıp s_ UUID'leri ham basıyordu (öğretmen grid / yoklama / etüt hücreleri bug'ı).
export function classShortUpper(classes: ClassEntry[] | null | undefined, id: string): string {
  if (!id) return '';
  if (/^s_/.test(id)) return findClass(classes, id)?.ad || id;
  return id.toUpperCase();
}

// Öğrencileri şube kimliğine (cls) göre grupla — kademe sırası, sonra şube adı (numeric).
// Map-tabanlı: aynı şubenin öğrencileri HER ZAMAN tek grupta toplanır (giriş sırası
// önemsiz). Eski "önce sırala, ardışık grupla" deseni s_ UUID'lerde bozuktu: clsSort
// parseInt('s_…')=NaN → sıralama kararsız → aynı şube birden çok parçaya bölünüyordu.
// Filtreleme (arama/grup) çağıran tarafta yapılır; bu yalnız gruplar + sıralar.
export function groupStudentsByClass<T extends { cls: string; group?: string | null }>(
  list: T[],
  classes: ClassEntry[] | null | undefined,
  labelFallback?: string | ((id: string) => string),
): { cls: string; label: string; group?: string | null; students: T[] }[] {
  const order: Record<string, number> = { ilkokul: 0, ortaokul: 1, lise: 2, mezun: 3 };
  const byCls = new Map<string, { cls: string; label: string; group?: string | null; students: T[] }>();
  for (const s of list) {
    let g = byCls.get(s.cls);
    if (!g) {
      g = { cls: s.cls, label: classLabelFrom(classes, s.cls, labelFallback), group: s.group, students: [] };
      byCls.set(s.cls, g);
    }
    g.students.push(s);
  }
  return [...byCls.values()].sort((a, b) => {
    const gd = (order[a.group || ''] ?? 9) - (order[b.group || ''] ?? 9);
    if (gd !== 0) return gd;
    return a.label.localeCompare(b.label, 'tr', { numeric: true });
  });
}

const GROUP_ORDER = ['ilkokul', 'ortaokul', 'lise', 'mezun'];
const GROUP_LABELS: Record<string, string> = { ilkokul: 'İlkokul', ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

// Şubeleri köprü grubuna göre, sabit sırada grupla — hedefleme ağaçları için.
// → [{ key, label, items: [{ id, ad }] }]  (boş gruplar atlanır)
export function groupedClasses(classes: ClassEntry[] | null | undefined) {
  const byGroup = new Map<string, { id: string; ad: string }[]>();
  for (const c of classes || []) {
    const g = c.group || '';
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push({ id: c.id, ad: c.ad || c.id });
  }
  const known = GROUP_ORDER.filter((g) => byGroup.has(g));
  const extra = [...byGroup.keys()].filter((g) => !GROUP_ORDER.includes(g));
  return [...known, ...extra].map((key) => ({
    key,
    label: GROUP_LABELS[key] || key,
    items: byGroup.get(key)!,
  }));
}
