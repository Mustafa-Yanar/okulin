import { slotId as makeSlotId, slotNoOf } from '@/lib/constants';
import type { ClassRecord } from '@/lib/classes';
import type { TeacherDTO } from '../types';
import type {
  ApiFn, Load, Grouping, Windows, TeacherSlots, ProgramGrid, Assigned, FeasInfeasible, AnalyzeCtx,
} from './program-types';

// ── Program oluşturucu saf mantığı (sabitler + saf fonksiyonlar) ──
// React'e bağlı değil; hem ana bileşen hem alt bileşenler paylaşır. Davranış
// ProgramOlusturucu içindeki eski satır-içi tanımlarla birebir aynı.

export const DAYS = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];

export const COURSE_COLOR: Record<string, string> = {
  'Türkçe':'#ec4899','TYT Matematik':'#6366f1','AYT Matematik':'#4f46e5','Geometri':'#818cf8','Matematik':'#6366f1',
  'Fizik':'#0ea5e9','Kimya':'#14b8a6','Biyoloji':'#22c55e','Tarih':'#f59e0b','Coğrafya':'#84cc16','Felsefe':'#a855f7',
  'Fen Bilgisi':'#06b6d4','Sosyal Bilgiler':'#f97316','İnkılap Tarihi':'#f97316','İngilizce':'#8b5cf6',
};

// Sütun tanımları — tam isim ve kısa etiket
export const LOAD_COLUMNS: { key: string; label: string; short: string }[] = [
  { key:'Ortaokul_7',    label:'7. Sınıf',        short:'7.Sınıf'   },
  { key:'Ortaokul_8',    label:'8. Sınıf',        short:'8.Sınıf'   },
  { key:'Lise Ortak_9',  label:'9. Sınıf',        short:'9.Sınıf'   },
  { key:'Lise Ortak_10', label:'10. Sınıf',       short:'10.Sınıf'  },
  { key:'Lise Sayısal_11',    label:'11 Sayısal',  short:'11 Say.'  },
  { key:'Lise Eşit Ağırlık_11', label:'11 Eşit Ağırlık', short:'11 EA' },
  { key:'Lise Sayısal_12',    label:'12 Sayısal',  short:'12 Say.'  },
  { key:'Lise Eşit Ağırlık_12', label:'12 Eşit Ağırlık', short:'12 EA' },
  { key:'Mezun Sayısal', label:'Mezun Sayısal',    short:'Mez.Say.' },
  { key:'Mezun Eşit Ağırlık', label:'Mezun Eşit Ağırlık', short:'Mez.EA' },
];

// Hangi dersler hangi sütuna ait
export const COL_COURSES: Record<string, string[]> = {
  'Ortaokul_7':              ['Türkçe','Matematik','Fen Bilgisi','Sosyal Bilgiler','İngilizce'],
  'Ortaokul_8':              ['Türkçe','Matematik','Fen Bilgisi','İnkılap Tarihi','İngilizce'],
  'Lise Ortak_9':            ['Türkçe','Matematik','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe'],
  'Lise Ortak_10':           ['Türkçe','Matematik','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe'],
  'Lise Sayısal_11':         ['Türkçe','Matematik','Fizik','Kimya','Biyoloji'],
  'Lise Eşit Ağırlık_11':   ['Türkçe','Matematik','Tarih','Coğrafya','Felsefe'],
  'Lise Sayısal_12':         ['Türkçe','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji'],
  'Lise Eşit Ağırlık_12':   ['Türkçe','TYT Matematik','AYT Matematik','Geometri','Tarih','Coğrafya','Felsefe'],
  'Mezun Sayısal':           ['Türkçe','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji'],
  'Mezun Eşit Ağırlık':     ['Türkçe','TYT Matematik','AYT Matematik','Geometri','Tarih','Coğrafya','Felsefe'],
};

// Sınıf → sütun anahtarı
export function colKeyFor(cls: string): string {
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    return n <= 5 ? 'Mezun Sayısal' : 'Mezun Eşit Ağırlık';
  }
  const grade = Math.floor(parseInt(cls) / 100);
  const sec   = parseInt(cls.slice(1));
  if (grade === 7) return 'Ortaokul_7';
  if (grade === 8) return 'Ortaokul_8';
  if (grade === 9 || grade === 10) return `Lise Ortak_${grade}`;
  if (grade === 3) return sec <= 3 ? 'Lise Sayısal_11' : 'Lise Eşit Ağırlık_11';
  if (grade === 4) return sec <= 5 ? 'Lise Sayısal_12' : 'Lise Eşit Ağırlık_12';
  return 'Lise Ortak_9';
}
export function coursesForCol(key: string | null): string[] { return COL_COURSES[key as string] || []; }

// colKey → gerçekte kullanılan ders listesi (registry). Kurumun kendi eklediği dersler
// (örn. "Paragraf") sabit COL_COURSES'ta hiç yoktur — bu yüzden ders yükü tablosu VE
// analyzeLoad, önce registry sınıflarının dersler[] birleşimine bakar; sütunda henüz
// hiç sınıf/ders yoksa (örn. mezun şubesi daha açılmamış) sabit listeye düşer, tablo
// "hiç ders yok" görünmesin diye.
export function coursesForColFromRegistry(colKeyOf: (cls: string) => string | null, registryClasses: ClassRecord[] | null): Record<string, string[]> {
  const map: Record<string, Set<string>> = {}; // colKey -> Set<ders>
  for (const c of registryClasses || []) {
    const key = colKeyOf(c.id);
    if (!key) continue;
    const set = map[key] || (map[key] = new Set());
    for (const d of c.dersler || []) set.add(d);
  }
  const result: Record<string, string[]> = {};
  for (const key of Object.keys(COL_COURSES)) {
    const used = map[key];
    result[key] = used && used.size ? ORDER.filter(d => used.has(d)).concat([...used].filter(d => !ORDER.includes(d))) : COL_COURSES[key];
  }
  return result;
}

// Tüm derslerin görünüm sırası (tablo satırları) — bilinen sıradaki çekirdek dersler,
// ardından kurumun eklediği özel dersler (kullanılış sırasına göre) sona eklenir.
export const ORDER = ['Türkçe','Matematik','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji',
               'Tarih','Coğrafya','Felsefe','Fen Bilgisi','Sosyal Bilgiler','İnkılap Tarihi','İngilizce'];

// Registry şube kaydından (kademe/duzey/dal) sütun anahtarı türet. Özel şubeler
// (s_…) sabit-kod colKeyFor ile çözülemez; kayıttaki metadata tek doğru kaynak.
// Eşleşen sütun yoksa null → şube listede görünür ama ders talebi üretmez.
export function colKeyFromRegistry(c: ClassRecord | undefined): string | null {
  if (!c) return null;
  if (c.group === 'mezun') {
    if (c.dal === 'ea') return 'Mezun Eşit Ağırlık';
    if (c.dal === 'sayisal' || !c.dal) return 'Mezun Sayısal';
    return null;
  }
  if (c.group === 'ortaokul') {
    return (c.duzey === '7' || c.duzey === '8') ? `Ortaokul_${c.duzey}` : null;
  }
  if (c.group === 'lise') {
    if (c.duzey === '9' || c.duzey === '10') return `Lise Ortak_${c.duzey}`;
    if (c.duzey === '11' || c.duzey === '12') {
      if (c.dal === 'ea') return `Lise Eşit Ağırlık_${c.duzey}`;
      if (c.dal === 'sayisal' || !c.dal) return `Lise Sayısal_${c.duzey}`;
    }
  }
  return null;
}

// Çözücünün blok havuzu ürettiği köprü grupları — ilkokul kapsam dışı (Faz 2+).
export const SOLVER_GROUPS = ['ortaokul', 'lise', 'mezun'];

export function teacherTeaches(t: TeacherDTO, course: string): boolean {
  return (t.branches || []).includes(course);
}

// Sınıfın KATI ders penceresi: slotTemplate {gün: [slotNo, ...]} → {gün: [slotIdx, ...]}.
// slotNo 1-tabanlı (kullanıcı görünümü), solver 0-tabanlı slotIdx bekler → slotNo-1.
// Şablon yoksa/boşsa boş pencere → o sınıfa hiç ders yerleşmez (yalnız işaretli slotlar).
export function windowsFromTemplate(slotTemplate: unknown): Windows {
  const win: Windows = {};
  if (!slotTemplate) return win;
  // ClassRecord.slotTemplate Json (unknown) — kayıtlı sözleşme {gün: [slotNo...]}.
  for (const [dStr, nos] of Object.entries(slotTemplate as Record<string, number[]>)) {
    const d = parseInt(dStr);
    const idxs = [...new Set((nos || []).map(n => n - 1))].filter(i => i >= 0).sort((a, b) => a - b);
    if (idxs.length) win[d] = idxs;
  }
  return win;
}

// ── Ders gruplama (parça deseni) yardımcıları ──
// Desen string'i: "3-2-2" → [3,2,2]. Ayraç olarak rakam dışı her şey kabul edilir.
export function parsePattern(str: string | undefined): number[] {
  return String(str || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter(n => n > 0 && n <= 12);
}
// Desen girilmemişse varsayılan: 2'li gruplar + tek kalan saat 1'lik grup.
export function defaultSplit(h: number): number[] {
  const arr: number[] = Array(Math.floor(h / 2)).fill(2);
  if (h % 2) arr.push(1);
  return arr;
}
// Bir hücrenin etkin deseni: override varsa o, yoksa saatten varsayılan.
export function resolvePieces(load: Load, grouping: Grouping | undefined, key: string | null, course: string): number[] {
  const h = (load[key as string]?.[course]) || 0;
  if (h <= 0) return [];
  const pat = parsePattern(grouping?.[key as string]?.[course]);
  return pat.length ? pat : defaultSplit(h);
}

// slotIdx (0-tabanlı, solver çıktısı) → 7-gün slot id (d{gün}s{no}). slotNo = idx+1.
export function slotIdFor(day: number, slotIdx: number | null | undefined): string | null {
  if (slotIdx == null || slotIdx < 0) return null;
  return makeSlotId(day, slotIdx + 1);
}
// Sonuç kartı etiketi: gerçek saat artık güne özgü (sabit varsayılan yok) → ders no göster.
export function slotLabel(day: number, slotIdx: number | null): string {
  return slotIdx == null ? '' : `${slotIdx + 1}. ders`;
}
// Kesin Kontrol "sistem önerisi": nicel bir "en ucuz" iddiası DEĞİL. Maliyetin gerçek
// kurları (saat ücreti mi maaş mı, öğretmenin başka kurumda işi var mı) sistemce
// bilinemez — o yüzden kategoriler eşdeğer sunulur, burada yalnızca "en küçük ve en
// güvenli değişiklik" varsayılan olarak işaretlenir: mevcut günü uzatmak monotondur
// (hiçbir mevcut düzeni bozmaz), takas gün düzenini değiştirir, yeni gün en büyüğüdür.
export function feasSuggestion(fr: FeasInfeasible): { text: string; why: string } | null {
  if (fr.cheapest) return {
    text: `${fr.cheapest.name} — ${DAYS[fr.cheapest.day]} günü ${fr.cheapest.slots.join('. ve ')}. ders saatini müsait işaretleyin`,
    why: 'öğretmen o gün zaten geliyor; en küçük değişiklik, mevcut hiçbir düzeni bozmaz',
  };
  if (fr.swapFix?.length) return {
    text: `${fr.swapFix[0].name} — ${DAYS[fr.swapFix[0].fromDay]} yerine ${DAYS[fr.swapFix[0].toDay]} gelsin`,
    why: 'ek ders saati gerektirmez; ancak öğretmenin gün düzenini değiştirir',
  };
  if (fr.costlyFix?.length) return {
    text: `${fr.costlyFix[0].name} — ${DAYS[fr.costlyFix[0].day]} ${fr.costlyFix[0].slots.join('. ve ')}. ders`,
    why: 'bulunan tek çözüm sınıfı yeni gün açmak',
  };
  return null;
}
// Manuel düzenlemede blok üyeliği: sınıf aynı slotta tek ders işler (K5) → benzersiz.
export const entryKeyOf = (a: Assigned) => `${a.day}|${a.slot}|${a.cls}`;
export function shortCourse(c: string): string {
  return ({'TYT Matematik':'TYT Mat','AYT Matematik':'AYT Mat','Geometri':'Geo','Matematik':'Mat','Fen Bilgisi':'Fen','Sosyal Bilgiler':'Sos','İnkılap Tarihi':'İnk','İngilizce':'İng'} as Record<string, string>)[c] || c.slice(0,5);
}
export function currentWeekKey(): string {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  const ys = new Date(d.getFullYear(),0,1);
  const wk = Math.ceil((((d.getTime()-ys.getTime())/86400000)+1)/7);
  return `${d.getFullYear()}-W${String(wk).padStart(2,'0')}`;
}

// Öğretmenin hangi gruplara ders girebileceği (boşsa tüm gruplar)
export function teacherGroups(t: TeacherDTO): string[] {
  const ag = t.allowedGroups || [];
  return ag.length > 0 ? ag : ['ortaokul','lise','mezun'];
}

// Her öğretmenin işaretlediği (gün, slotIndex) uygunluk çiftlerini topla — KATI mod,
// solver da aynı kaynağı kullanır. Ön analiz ve generate() aynı fonksiyonu paylaşır ki
// "hata yok" derken solver'ın gerçekte gördüğü kısıt kaçmasın.
export async function fetchTeacherSlots(teachers: TeacherDTO[], api: ApiFn): Promise<TeacherSlots> {
  const teacherSlots: TeacherSlots = {};
  await Promise.all(teachers.map(async t => {
    try {
      const resp = await api<{ weekKey?: string; program?: ProgramGrid }>(`/api/program?teacherId=${t.id}`); // {weekKey, program}
      const prog = resp.program || {};
      const pairs: [number, number][] = [];
      for (const dayStr of Object.keys(prog)) {
        const day = parseInt(dayStr);
        const slots = prog[dayStr] || {};
        for (const slotId of Object.keys(slots)) {
          if (slots[slotId]?.type !== 'available') continue;
          const no = slotNoOf(slotId); // d{gün}s{no} → no (1-tabanlı)
          if (no != null && no >= 1) pairs.push([day, no - 1]); // 0-tabanlı slotIdx
        }
      }
      teacherSlots[t.id] = pairs;
    } catch { teacherSlots[t.id] = []; }
  }));
  return teacherSlots;
}

// Bir grubun (gün,slot) pencere birleşimi: o gruptaki tüm sınıfların işaretli slotları.
// Öğretmen kapasitesi bunun üst sınırı — aynı slotta tek sınıfa girer (birleşim sayılır).
export function groupSlotUnion(grp: string, classes: string[], windowsOf: (cls: string) => Windows, groupOf: (cls: string) => string | null): Set<string> {
  const union = new Set<string>();
  for (const cls of classes) {
    if (groupOf(cls) !== grp) continue;
    const win = windowsOf(cls);
    for (const [d, slots] of Object.entries(win)) {
      for (const idx of slots) union.add(`${d}:${idx}`);
    }
  }
  return union;
}

// Öğretmenin bir grupta çalışabileceği toplam SAAT kapasitesi (izin günleri hariç).
// teacherSlots verilmişse (gerçek available işaretleri) kapasite onunla kesiştirilir —
// verilmemişse (henüz yüklenmedi) sınıf pencerelerinin üst sınırına geri düşülür.
export function teacherHourCap(t: TeacherDTO, grp: string, classes: string[], windowsOf: (cls: string) => Windows, groupOf: (cls: string) => string | null, teacherSlots: TeacherSlots | null | undefined): number {
  const offDays = new Set(t.offDays || []);
  const availSet = teacherSlots ? new Set((teacherSlots[t.id] || []).map(([d, idx]) => `${d}:${idx}`)) : null;
  let cap = 0;
  for (const key of groupSlotUnion(grp, classes, windowsOf, groupOf)) {
    const d = parseInt(key.split(':')[0]);
    if (offDays.has(d)) continue;
    if (availSet && !availSet.has(key)) continue;
    cap++;
  }
  return cap;
}

// Bir parçanın (L saat, ARDIŞIK) yerleşebileceği günler: sınıf penceresinde L'lik
// ardışık dizi VAR ve en az bir uygun öğretmen o dizinin TÜM slotlarını available
// işaretlemiş (solver'ın piece_ok kuralıyla aynı). Çapraz-sınıf öğretmen çekişmesi
// YOK SAYILIR (iyimser) — bu yüzden buradan çıkan hatalar KESİNDİR: hiçbir gün
// dağıtımıyla çözülemez, yanlış pozitif üretmez.
export function pieceFeasibleDays(win: Windows, L: number, eligTeachers: TeacherDTO[], teacherSlots: TeacherSlots): number[] {
  const days: number[] = [];
  for (const [dStr, slots] of Object.entries(win)) {
    const d = parseInt(dStr);
    const ok = eligTeachers.some(t => {
      if ((t.offDays || []).includes(d)) return false;
      const av = new Set((teacherSlots[t.id] || []).filter(([dd]) => dd === d).map(([, i]) => i));
      for (let i = 0; i + L <= slots.length; i++) {
        const seg = slots.slice(i, i + L);
        if (seg[L - 1] - seg[0] === L - 1 && seg.every(s => av.has(s))) return true;
      }
      return false;
    });
    if (ok) days.push(d);
  }
  return days;
}

// Parça→gün ikili eşleme (augmenting path). K3 gereği aynı dersin parçaları FARKLI
// günlere gider; kaç parçaya gün bulunabildiğini döner (maksimum eşleme — kesin).
export function maxDayMatching(feasibleSets: number[][]): number {
  const dayOf = new Map<number, number>(); // day -> piece index
  function tryAssign(i: number, visited: Set<number>): boolean {
    for (const d of feasibleSets[i]) {
      if (visited.has(d)) continue;
      visited.add(d);
      if (!dayOf.has(d) || tryAssign(dayOf.get(d)!, visited)) { dayOf.set(d, i); return true; }
    }
    return false;
  }
  let matched = 0;
  for (let i = 0; i < feasibleSets.length; i++) if (tryAssign(i, new Set())) matched++;
  return matched;
}

// Ön analiz: oluşturmadan önce kapasite/çakışma sorunlarını hesapla. teacherSlots
// varsa (Oluştur ile aynı kaynak — /api/program available işaretleri) SAAT bazlı
// kapasite kontrolü (#3) öğretmenin gerçekte uygun olduğu slotlarla sınırlandırılır,
// ayrıca sınıf-yerel KESİN kontroller (#3b K3 gün eşleme, #3c gün-kümesi kapasitesi)
// çalışır. Hangi sınıfın hangi güne gideceği TAHMİN edilmez — yalnız hiçbir dağıtımla
// çözülemeyecek durumlar hata olur (çapraz-sınıf çekişme yok sayılır → iyimser sınır).
export function analyzeLoad(classes: string[], load: Load, teachers: TeacherDTO[], grouping: Grouping, { colKeyOf, groupOf, labelOf, windowsOf, teacherSlots, coursesForCol: coursesForColArg }: AnalyzeCtx) {
  const errors: string[] = [], warnings: string[] = [], infos: string[] = [];
  const coursesOf = coursesForColArg || coursesForCol;

  // 0. Program penceresi işaretlenmemiş sınıflar → o sınıfa hiç ders yerleşmez (uyarı).
  for (const cls of classes) {
    const key = colKeyOf(cls);
    const demand = coursesOf(key).reduce((s, c) => s + ((load[key as string]?.[c]) || 0), 0);
    if (demand <= 0) continue;
    const win = windowsOf(cls);
    if (!Object.keys(win).length) {
      errors.push(`${labelOf(cls)} — ders yükü var ama program penceresi işaretlenmemiş (sınıf kartından "Program Penceresi" ile saat seçin)`);
    }
  }

  // 1. Gruplama deseni sınıfın gün pencerelerine sığıyor mu?
  // Aynı gün aynı derse 1 grup kuralı (K3) → her parça AYRI güne, o günün penceresi
  // parça uzunluğunu almalı. Greedy eşleme: en uzun parça → en geniş pencere.
  for (const cls of classes) {
    const key = colKeyOf(cls);
    const win = windowsOf(cls);
    if (!Object.keys(win).length) continue; // #0'da raporlandı
    const dayLens = Object.values(win).map(a => a.length).sort((a, b) => b - a);
    for (const course of coursesOf(key)) {
      const pat = resolvePieces(load, grouping, key, course);
      if (!pat.length) continue;
      const sorted = [...pat].sort((a, b) => b - a);
      const fits = sorted.length <= dayLens.length && sorted.every((L, i) => L <= dayLens[i]);
      if (!fits) {
        errors.push(`${labelOf(cls)} — ${course}: gruplama ${pat.join('-')} gün pencerelerine sığmıyor (günler: ${dayLens.join(', ')} saat; aynı gün aynı derse 1 grup)`);
      }
    }
  }

  // 2. Uygun öğretmen yok
  for (const cls of classes) {
    const key = colKeyOf(cls), grp = groupOf(cls);
    for (const course of coursesOf(key)) {
      const h = (load[key as string]?.[course]) || 0; if (h <= 0) continue;
      const eligible = teachers.filter(tt =>
        teacherTeaches(tt, course) && teacherGroups(tt).includes(grp as string)
      );
      if (eligible.length === 0) {
        errors.push(`${labelOf(cls)} — ${course}: uygun öğretmen yok`);
      }
    }
  }

  // 3. Branş bazında talep vs kapasite (SAAT bazında)
  const branchHours: Record<string, number> = {}; // branch+grp → toplam saat talebi

  for (const cls of classes) {
    const key = colKeyOf(cls), grp = groupOf(cls);
    for (const course of coursesOf(key)) {
      const h = (load[key as string]?.[course]) || 0; if (h <= 0) continue;
      const k = course + '|' + grp; // ders adı = branş
      branchHours[k] = (branchHours[k] || 0) + h;
    }
  }

  // Her branş+grup için uygun öğretmenlerin toplam saat kapasitesi
  for (const [bk, demand] of Object.entries(branchHours)) {
    const [branch, grp] = bk.split('|');
    const eligible = teachers.filter(tt =>
      teacherTeaches(tt, branch) && teacherGroups(tt).includes(grp)
    );
    if (eligible.length === 0) continue; // zaten hata var yukarıda
    const totalCap = eligible.reduce((s, t) => s + teacherHourCap(t, grp, classes, windowsOf, groupOf, teacherSlots), 0);
    if (demand > totalCap) {
      const grpLabel = grp === 'mezun' ? 'Mezun' : grp === 'lise' ? 'Lise' : 'Ortaokul';
      errors.push(`${branch} (${grpLabel}): ${demand} saat talep, ${totalCap} saat kapasite — ${demand - totalCap} saat sığmaz`);
    } else if (demand > totalCap * 0.85) {
      const grpLabel = grp === 'mezun' ? 'Mezun' : grp === 'lise' ? 'Lise' : 'Ortaokul';
      warnings.push(`${branch} (${grpLabel}): kapasite %${Math.round(demand/totalCap*100)} dolu — yerleştirme zorlaşabilir`);
    }
  }

  // 3b + 3c: öğretmen uygunluğuna dayalı sınıf-yerel KESİN kontroller.
  if (teacherSlots) {
    for (const cls of classes) {
      const key = colKeyOf(cls), grp = groupOf(cls);
      const win = windowsOf(cls);
      const winDays = Object.keys(win).map(Number).sort((a, b) => a - b);
      if (!winDays.length) continue; // #0'da raporlandı
      const clsPieces: { course: string; L: number; days: Set<number> }[] = []; // 3c için birikir
      for (const course of coursesOf(key)) {
        const pat = resolvePieces(load, grouping, key, course);
        if (!pat.length) continue;
        const elig = teachers.filter(tt => teacherTeaches(tt, course) && teacherGroups(tt).includes(grp as string));
        if (!elig.length) continue; // #2'de raporlandı
        const sets = pat.map(L => pieceFeasibleDays(win, L, elig, teacherSlots));
        // 3b: K3 — her grup AYRI güne gitmek zorunda; eşleme kaç gruba gün bulabiliyor?
        const matched = maxDayMatching(sets);
        if (matched < pat.length) {
          const dayNames = [...new Set(sets.flat())].sort().map(d => DAYS[d]).join(', ') || 'hiçbiri';
          errors.push(`${labelOf(cls)} — ${course}: ${pat.join('-')} deseni ${pat.length} ayrı gün ister; öğretmen uygunluğu yalnız ${matched} güne izin veriyor (uygun: ${dayNames}) — ${pat.length - matched} grup açıkta kalır`);
        }
        pat.forEach((L, i) => clsPieces.push({ course, L, days: new Set(sets[i]) }));
      }
      // 3c: gün-kümesi kapasitesi (Hall) — yalnız S günlerine yerleşebilen derslerin
      // toplam saati S'in pencere slot toplamını aşarsa kesin sığmaz.
      const usable = clsPieces.filter(p => p.days.size > 0); // günsüzler 3b'de raporlandı
      const reported: number[] = [];
      for (let mask = 1; mask < (1 << winDays.length); mask++) {
        if (reported.some(r => (mask & r) === r)) continue; // alt kümesi zaten raporlandı
        const S = winDays.filter((_, i) => mask & (1 << i));
        const cap = S.reduce((s, d) => s + (win[d]?.length || 0), 0);
        const inS = usable.filter(p => [...p.days].every(d => S.includes(d)));
        const demand = inS.reduce((s, p) => s + p.L, 0);
        if (demand > cap) {
          const courseNames = [...new Set(inS.map(p => p.course))].join(', ');
          errors.push(`${labelOf(cls)} — ${S.map(d => DAYS[d]).join('+')}: öğretmen uygunluğu gereği bu günlere mecbur dersler (${courseNames}) toplam ${demand} saat, pencere ${cap} slot — ${demand - cap} saat kesin sığmaz`);
          reported.push(mask);
        }
      }
    }
  }

  // 3d: ön eşleştirme (preset) FİZİBİLİTE — tek imkansız preset TÜM programı çökertir
  // (solver'da model.Add(y==1) HARD kısıt; sağlanamazsa INFEASIBLE → 0 yerleşti).
  // Burada her preset için: o öğretmen, o sınıf-dersin EN AZ BİR parçasını kendi
  // uygun (available) slotlarına + sınıf penceresine yerleştirebiliyor mu? Yoksa hata.
  if (teacherSlots) {
    for (const t of teachers) {
      for (const pr of (t.presets || [])) {
        const cls = pr.cls, course = pr.course;
        // Ders gerçekten bu sınıfın yükünde mi? (değilse solver zaten atlar, sessiz)
        const key = colKeyOf(cls), grp = groupOf(cls);
        if (!key) continue;
        const pat = resolvePieces(load, grouping, key, course);
        if (!pat.length) continue; // bu sınıf-derse saat girilmemiş → preset etkisiz
        // Öğretmen bu derse branş+grup olarak uygun mu?
        if (!(teacherTeaches(t, course) && teacherGroups(t).includes(grp as string))) {
          errors.push(`Ön eşleştirme — ${t.name} → ${labelOf(cls)} ${course}: öğretmen bu derse uygun değil (branş/grup uyuşmuyor) → program oluşturulamaz`);
          continue;
        }
        const win = windowsOf(cls);
        if (!Object.keys(win).length) {
          errors.push(`Ön eşleştirme — ${t.name} → ${labelOf(cls)} ${course}: sınıfın program penceresi işaretlenmemiş → preset yerleştirilemez, program oluşturulamaz`);
          continue;
        }
        // En uzun parçayı bu öğretmen tek başına bir güne yerleştirebiliyor mu?
        const longest = Math.max(...pat);
        const days = pieceFeasibleDays(win, longest, [t], teacherSlots);
        if (!days.length) {
          errors.push(`Ön eşleştirme — ${t.name} → ${labelOf(cls)} ${course}: bu öğretmenin uygun günü/saati sınıf penceresine sığmıyor (${longest} saatlik ardışık blok yok) → preset yerleştirilemez, program oluşturulamaz. Preseti kaldırın veya öğretmen uygunluğunu genişletin.`);
        }
      }
    }
  }

  // 4. İzin günü olan öğretmenler
  const offTeachers = teachers.filter(t => (t.offDays||[]).length > 0);
  if (offTeachers.length > 0) {
    offTeachers.forEach(t => {
      const dayNames = (t.offDays||[]).map(d => DAYS[d]).join(', ');
      infos.push(`${t.name} — izin günleri: ${dayNames} (kapasite düşük)`);
    });
  }

  // 5. Hiç talep yok kontrolü
  const totalHours = classes.reduce((s, cls) => {
    const key = colKeyOf(cls);
    return s + coursesOf(key).reduce((ss, c) => ss + ((load[key as string]?.[c]) || 0), 0);
  }, 0);
  if (totalHours === 0) {
    infos.push('Hiç ders saati girilmemiş — ders yükü tablosunu doldurun.');
  }

  return { errors, warnings, infos, ok: errors.length === 0 };
}
