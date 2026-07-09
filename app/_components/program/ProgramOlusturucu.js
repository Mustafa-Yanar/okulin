'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, AlertTriangle, Check, Download, Eye, Save, ShieldCheck } from 'lucide-react';
import {
  classToGroup, slotId as makeSlotId, slotNoOf,
} from '@/lib/constants';
import TeacherPresets from '../director/TeacherPresets';
import { useConfirm } from '../ConfirmProvider';
import { useClasses } from '../ClassesContext';

// Ders adı = branş adı; otomatik eşleme yok (çoklu branş modeli).

const DAYS = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];

const COURSE_COLOR = {
  'Türkçe':'#ec4899','TYT Matematik':'#6366f1','AYT Matematik':'#4f46e5','Geometri':'#818cf8','Matematik':'#6366f1',
  'Fizik':'#0ea5e9','Kimya':'#14b8a6','Biyoloji':'#22c55e','Tarih':'#f59e0b','Coğrafya':'#84cc16','Felsefe':'#a855f7',
  'Fen Bilgisi':'#06b6d4','Sosyal Bilgiler':'#f97316','İnkılap Tarihi':'#f97316','İngilizce':'#8b5cf6',
};

// Sütun tanımları — tam isim ve kısa etiket
const LOAD_COLUMNS = [
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
const COL_COURSES = {
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
function colKeyFor(cls) {
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
function coursesForCol(key) { return COL_COURSES[key] || []; }

// colKey → gerçekte kullanılan ders listesi (registry). Kurumun kendi eklediği dersler
// (örn. "Paragraf") sabit COL_COURSES'ta hiç yoktur — bu yüzden ders yükü tablosu VE
// analyzeLoad, önce registry sınıflarının dersler[] birleşimine bakar; sütunda henüz
// hiç sınıf/ders yoksa (örn. mezun şubesi daha açılmamış) sabit listeye düşer, tablo
// "hiç ders yok" görünmesin diye.
function coursesForColFromRegistry(colKeyOf, registryClasses) {
  const map = {}; // colKey -> Set<ders>
  for (const c of registryClasses || []) {
    const key = colKeyOf(c.id);
    if (!key) continue;
    const set = map[key] || (map[key] = new Set());
    for (const d of c.dersler || []) set.add(d);
  }
  const result = {};
  for (const key of Object.keys(COL_COURSES)) {
    const used = map[key];
    result[key] = used && used.size ? ORDER.filter(d => used.has(d)).concat([...used].filter(d => !ORDER.includes(d))) : COL_COURSES[key];
  }
  return result;
}

// Tüm derslerin görünüm sırası (tablo satırları) — bilinen sıradaki çekirdek dersler,
// ardından kurumun eklediği özel dersler (kullanılış sırasına göre) sona eklenir.
const ORDER = ['Türkçe','Matematik','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji',
               'Tarih','Coğrafya','Felsefe','Fen Bilgisi','Sosyal Bilgiler','İnkılap Tarihi','İngilizce'];

// Registry şube kaydından (kademe/duzey/dal) sütun anahtarı türet. Özel şubeler
// (s_…) sabit-kod colKeyFor ile çözülemez; kayıttaki metadata tek doğru kaynak.
// Eşleşen sütun yoksa null → şube listede görünür ama ders talebi üretmez.
function colKeyFromRegistry(c) {
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
const SOLVER_GROUPS = ['ortaokul', 'lise', 'mezun'];

function teacherTeaches(t, course) {
  return (t.branches || []).includes(course);
}

// Sınıfın KATI ders penceresi: slotTemplate {gün: [slotNo, ...]} → {gün: [slotIdx, ...]}.
// slotNo 1-tabanlı (kullanıcı görünümü), solver 0-tabanlı slotIdx bekler → slotNo-1.
// Şablon yoksa/boşsa boş pencere → o sınıfa hiç ders yerleşmez (yalnız işaretli slotlar).
function windowsFromTemplate(slotTemplate) {
  const win = {};
  if (!slotTemplate) return win;
  for (const [dStr, nos] of Object.entries(slotTemplate)) {
    const d = parseInt(dStr);
    const idxs = [...new Set((nos || []).map(n => n - 1))].filter(i => i >= 0).sort((a, b) => a - b);
    if (idxs.length) win[d] = idxs;
  }
  return win;
}

// ── Ders gruplama (parça deseni) yardımcıları ──
// Desen string'i: "3-2-2" → [3,2,2]. Ayraç olarak rakam dışı her şey kabul edilir.
function parsePattern(str) {
  return String(str || '')
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map(Number)
    .filter(n => n > 0 && n <= 12);
}
// Desen girilmemişse varsayılan: 2'li gruplar + tek kalan saat 1'lik grup.
function defaultSplit(h) {
  const arr = Array(Math.floor(h / 2)).fill(2);
  if (h % 2) arr.push(1);
  return arr;
}
// Bir hücrenin etkin deseni: override varsa o, yoksa saatten varsayılan.
function resolvePieces(load, grouping, key, course) {
  const h = (load[key]?.[course]) || 0;
  if (h <= 0) return [];
  const pat = parsePattern(grouping?.[key]?.[course]);
  return pat.length ? pat : defaultSplit(h);
}

// slotIdx (0-tabanlı, solver çıktısı) → 7-gün slot id (d{gün}s{no}). slotNo = idx+1.
function slotIdFor(day, slotIdx) {
  if (slotIdx == null || slotIdx < 0) return null;
  return makeSlotId(day, slotIdx + 1);
}
// Sonuç kartı etiketi: gerçek saat artık güne özgü (sabit varsayılan yok) → ders no göster.
function slotLabel(day, slotIdx) {
  return slotIdx == null ? '' : `${slotIdx + 1}. ders`;
}
function shortCourse(c) {
  return ({'TYT Matematik':'TYT Mat','AYT Matematik':'AYT Mat','Geometri':'Geo','Matematik':'Mat','Fen Bilgisi':'Fen','Sosyal Bilgiler':'Sos','İnkılap Tarihi':'İnk','İngilizce':'İng'})[c] || c.slice(0,5);
}
function currentWeekKey() {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate()+4-(d.getDay()||7));
  const ys = new Date(d.getFullYear(),0,1);
  const wk = Math.ceil((((d-ys)/86400000)+1)/7);
  return `${d.getFullYear()}-W${String(wk).padStart(2,'0')}`;
}

// Öğretmenin hangi gruplara ders girebileceği (boşsa tüm gruplar)
function teacherGroups(t) {
  const ag = t.allowedGroups || [];
  return ag.length > 0 ? ag : ['ortaokul','lise','mezun'];
}

// Her öğretmenin işaretlediği (gün, slotIndex) uygunluk çiftlerini topla — KATI mod,
// solver da aynı kaynağı kullanır. Ön analiz ve generate() aynı fonksiyonu paylaşır ki
// "hata yok" derken solver'ın gerçekte gördüğü kısıt kaçmasın.
async function fetchTeacherSlots(teachers, api) {
  const teacherSlots = {};
  await Promise.all(teachers.map(async t => {
    try {
      const resp = await api(`/api/program?teacherId=${t.id}`); // {weekKey, program}
      const prog = resp.program || {};
      const pairs = [];
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
function groupSlotUnion(grp, classes, windowsOf, groupOf) {
  const union = new Set();
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
function teacherHourCap(t, grp, classes, windowsOf, groupOf, teacherSlots) {
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
function pieceFeasibleDays(win, L, eligTeachers, teacherSlots) {
  const days = [];
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
function maxDayMatching(feasibleSets) {
  const dayOf = new Map(); // day -> piece index
  function tryAssign(i, visited) {
    for (const d of feasibleSets[i]) {
      if (visited.has(d)) continue;
      visited.add(d);
      if (!dayOf.has(d) || tryAssign(dayOf.get(d), visited)) { dayOf.set(d, i); return true; }
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
function analyzeLoad(classes, load, teachers, grouping, { colKeyOf, groupOf, labelOf, windowsOf, teacherSlots, coursesForCol: coursesForColArg }) {
  const errors = [], warnings = [], infos = [];
  const coursesOf = coursesForColArg || coursesForCol;

  // 0. Program penceresi işaretlenmemiş sınıflar → o sınıfa hiç ders yerleşmez (uyarı).
  for (const cls of classes) {
    const key = colKeyOf(cls);
    const demand = coursesOf(key).reduce((s, c) => s + ((load[key]?.[c]) || 0), 0);
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
      const h = (load[key]?.[course]) || 0; if (h <= 0) continue;
      const eligible = teachers.filter(tt =>
        teacherTeaches(tt, course) && teacherGroups(tt).includes(grp)
      );
      if (eligible.length === 0) {
        errors.push(`${labelOf(cls)} — ${course}: uygun öğretmen yok`);
      }
    }
  }

  // 3. Branş bazında talep vs kapasite (SAAT bazında)
  const branchHours = {}; // branch+grp → toplam saat talebi

  for (const cls of classes) {
    const key = colKeyOf(cls), grp = groupOf(cls);
    for (const course of coursesOf(key)) {
      const h = (load[key]?.[course]) || 0; if (h <= 0) continue;
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
      const clsPieces = []; // {course, L, days:Set} — 3c için birikir
      for (const course of coursesOf(key)) {
        const pat = resolvePieces(load, grouping, key, course);
        if (!pat.length) continue;
        const elig = teachers.filter(tt => teacherTeaches(tt, course) && teacherGroups(tt).includes(grp));
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
      const reported = [];
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
        if (!(teacherTeaches(t, course) && teacherGroups(t).includes(grp))) {
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
    return s + coursesOf(key).reduce((ss, c) => ss + ((load[key]?.[c]) || 0), 0);
  }, 0);
  if (totalHours === 0) {
    infos.push('Hiç ders saati girilmemiş — ders yükü tablosunu doldurun.');
  }

  return { errors, warnings, infos, ok: errors.length === 0 };
}

// ── Ana bileşen ──
export default function ProgramOlusturucu({ api, showToast, branding }) {
  const confirm = useConfirm();
  const { classes: registryClasses, loaded: registryLoaded } = useClasses();
  const [teachers, setTeachers] = useState(null);
  // Ders yükü BOŞ başlar (tüm değerler 0) — kaydedilmiş plan varsa config'ten yüklenir.
  const [load, setLoad]         = useState({});
  const [grouping, setGrouping] = useState({}); // {colKey: {ders: "3-2-2"}} — gruplama override
  const [result, setResult]     = useState(null);
  const [maxWeekly, setMaxWeekly] = useState(40);
  const [planDirty, setPlanDirty] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying]   = useState(false);
  const [clearing, setClearing]   = useState(false);
  const [conflicts, setConflicts] = useState(null);
  const [preview, setPreview]     = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [analysis, setAnalysis]   = useState(null);
  const [presetTeacherId, setPresetTeacherId] = useState(''); // ön eşleştirme paneli (madde 11)
  const [feasChecking, setFeasChecking] = useState(false);   // Kesin Kontrol çalışıyor
  const [feasResult, setFeasResult] = useState(null);        // {feasible, suggestions:[...]}

  const classMeta = useMemo(
    () => new Map((registryClasses || []).map(c => [c.id, c])),
    [registryClasses]
  );

  // Sınıf listesi: kayıtlı şube registry'si TEK kaynak — kurum ne açtıysa o kullanılır
  // (boş/dolu olması engel değil). Registry henüz yüklenmediyse (ilk render) boş liste
  // döner, sabit-kod/öğrenci-türevli fallback'e ASLA düşülmez — aksi halde kurum kendi
  // şubelerini elle açmışken eski 34'lük sabit liste görünür.
  const classes = useMemo(() => {
    if (!registryLoaded) return [];
    const fromRegistry = (registryClasses || [])
      .filter(c => SOLVER_GROUPS.includes(c.group))
      .map(c => c.id);
    return [...new Set(fromRegistry)].sort();
  }, [registryLoaded, registryClasses]);

  // Registry-öncelikli köprüler: özel şubelerde (s_…) sabit-kod ayrıştırma çalışmaz.
  const groupOf = useCallback(
    cls => classMeta.get(cls)?.group || classToGroup(cls),
    [classMeta]
  );
  const colKeyOf = useCallback(cls => {
    const c = classMeta.get(cls);
    if (c) return colKeyFromRegistry(c) || (/^s_/.test(cls) ? null : colKeyFor(cls));
    return colKeyFor(cls);
  }, [classMeta]);
  const labelOf = useCallback(
    cls => /^s_/.test(cls) ? (classMeta.get(cls)?.ad || cls) : String(cls).toUpperCase(),
    [classMeta]
  );
  // Sınıfın KATI ders penceresi (slotTemplate → {gün: [slotIdx]}). İşaretsizse boş.
  const windowsOf = useCallback(
    cls => windowsFromTemplate(classMeta.get(cls)?.slotTemplate),
    [classMeta]
  );

  // colKey → gerçek ders listesi (registry'den, kurumun özel dersleri dahil). Sabit
  // COL_COURSES yalnız sütunda hiç sınıf/ders yoksa fallback olarak kullanılır.
  const courseMap = useMemo(
    () => coursesForColFromRegistry(colKeyOf, registryClasses),
    [colKeyOf, registryClasses]
  );
  const coursesOfCol = useCallback(key => courseMap[key] || [], [courseMap]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/teachers');
        setTeachers(data);
      } catch(e) { showToast?.(e.message,'error'); setTeachers([]); }
    })();
  }, [api, showToast]);

  // Kaydedilmiş planı yükle (haftalık ders yükü + günlük limitler + maks).
  // Config yoksa/boşsa tablo 0'larla kalır.
  useEffect(() => {
    (async () => {
      try {
        const cfg = await api('/api/config');
        const plan = cfg?.programPlan || {};
        if (plan.load && Object.keys(plan.load).length) setLoad(plan.load);
        if (plan.grouping && Object.keys(plan.grouping).length) setGrouping(plan.grouping);
        if (plan.maxWeekly) setMaxWeekly(plan.maxWeekly);
      } catch { /* muhasebeci vb. okuyamazsa sessiz — boş tabloyla devam */ }
    })();
  }, [api]);

  // Planı kaydet — sekme değiştirip dönünce girilen değerler kaybolmasın.
  async function savePlan() {
    setSavingPlan(true);
    try {
      await api('/api/config', {
        method: 'PATCH',
        body: JSON.stringify({ patch: { programPlan: { load, grouping, maxWeekly } } }),
      });
      setPlanDirty(false);
      showToast?.('Ders yükü planı kaydedildi', 'success');
    } catch(e) { showToast?.(e.message, 'error'); }
    finally { setSavingPlan(false); }
  }

  // Dirty-işaretli sarmalayıcılar: kullanıcı girişi planı değiştirdi → Kaydet aktifleşir.
  const updateLoad = useCallback(updater => { setLoad(updater); setPlanDirty(true); }, []);
  const updateGrouping = useCallback(updater => { setGrouping(updater); setPlanDirty(true); }, []);

  // Analizi yeniden hesapla: teachers/load/grouping/classes/pencere değişince.
  // Öğretmen uygunluk (available) verisi de çekilir — Oluştur ile aynı kısıtı görür,
  // aksi halde "hata yok" deyip solver'ın gerçekte açıkta bıraktığı dersleri kaçırır.
  useEffect(() => {
    if (!teachers) return;
    let cancelled = false;
    (async () => {
      const teacherSlots = await fetchTeacherSlots(teachers, api);
      if (cancelled) return;
      setAnalysis(analyzeLoad(classes, load, teachers, grouping, { colKeyOf, groupOf, labelOf, windowsOf, teacherSlots, coursesForCol: coursesOfCol }));
    })();
    return () => { cancelled = true; };
  }, [teachers, load, grouping, classes, colKeyOf, groupOf, labelOf, windowsOf, coursesOfCol, api]);

  // Ders yükü tablosu her zaman tüm sütunları gösterir
  const activeCols = LOAD_COLUMNS;

  // ── CP-SAT çözücü (OR-Tools, Python serverless) ──
  // Kısıtların tümü server'da modellenir; frontend payload'ı hazırlar ve sonucu gösterir.
  // Solver payload'ını kur — hem generate() hem feasibilityCheck() kullanır.
  // teacherSlots dışarıdan verilir (feasibility farklı senaryolar için değiştirir).
  const buildPayload = useCallback((teacherSlots) => {
    const windows = {}, colKey = {}, group = {};
    classes.forEach(c => {
      windows[c] = windowsOf(c);
      colKey[c] = colKeyOf(c);
      group[c] = groupOf(c);
    });
    // "Hayalet talep" temizliği: config'te kalmış ama sınıfların dersler[]'inde
    // olmayan dersleri ayıkla (bkz commit 5d1d9c8).
    const cleanLoad = {};
    for (const [ck, courses] of Object.entries(load)) {
      const valid = new Set(coursesOfCol(ck));
      const filtered = {};
      for (const [course, saat] of Object.entries(courses || {})) {
        if (valid.has(course)) filtered[course] = saat;
      }
      if (Object.keys(filtered).length) cleanLoad[ck] = filtered;
    }
    const pieces = {};
    Object.entries(grouping).forEach(([key, courses]) => {
      Object.entries(courses || {}).forEach(([course, str]) => {
        const pat = parsePattern(str);
        if (pat.length) (pieces[key] = pieces[key] || {})[course] = pat;
      });
    });
    const presets = teachers.flatMap(t =>
      (t.presets || []).map(p => ({ teacherId: t.id, cls: p.cls, course: p.course }))
    );
    return { classes, teachers, load: cleanLoad, pieces, maxWeekly, windows, colKey, group, teacherSlots, presets };
  }, [classes, teachers, windowsOf, colKeyOf, groupOf, load, coursesOfCol, grouping, maxWeekly]);

  async function generate() {
    if (!teachers) return;
    setResult(null);
    setConflicts(null);
    setGenerating(true);
    try {
      // KATI mod: her öğretmenin işaretlediği (gün, slotIndex) çiftleri — ön analizle aynı kaynak.
      const teacherSlots = await fetchTeacherSlots(teachers, api);
      const payload = buildPayload(teacherSlots);
      const data = await api('/api/program-solve', { method: 'POST', body: JSON.stringify(payload) });

      const assigned = data.assigned || [];
      const unplaced = data.unplaced || [];
      const tLoad = data.tLoad || {};
      teachers.forEach(t => { if (tLoad[t.id] == null) tLoad[t.id] = 0; });

      setResult({ assigned, unplaced, tLoad, total: assigned.length, ms: data.ms ?? 0 });
      // Geçersiz preset uyarıları
      (data.presetWarnings || []).forEach(w => showToast?.(`Ön eşleştirme atlandı: ${w}`, 'info'));
      showToast?.(`${assigned.length} ders yerleşti${unplaced.length ? `, ${unplaced.length} açıkta` : ''}`, unplaced.length ? 'info' : 'success');
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setGenerating(false);
    }
  }

  // ── Kesin Kontrol: yerleşebilirliği solver'la KESİN test et ──
  // Ön analiz (3b/3c) sınıf-yerel sezgisel; çapraz-sınıf öğretmen çekişmesini yok sayar.
  // Bu buton solver'ı feasibilityTest modunda (tüm dersler zorunlu) çalıştırıp FEASIBLE
  // (yerleşir) / INFEASIBLE (geometrik imkansız) kesin cevabını verir. INFEASIBLE ise
  // hangi öğretmeni tam-güne çıkarmanın çözdüğünü deneyerek somut öneri üretir.
  async function feasibilityCheck() {
    if (!teachers) return;
    setFeasChecking(true);
    setFeasResult(null);
    try {
      const teacherSlots = await fetchTeacherSlots(teachers, api);
      const base = buildPayload(teacherSlots);

      // 1) Mevcut durumu kesin test et
      const r0 = await api('/api/program-solve', {
        method: 'POST',
        body: JSON.stringify({ ...base, feasibilityTest: true }),
      });
      if (r0.feasible) {
        setFeasResult({ feasible: true, suggestions: [] });
        showToast?.('Tüm dersler yerleşebilir — program tam çözülür', 'success');
        return;
      }

      // 2) INFEASIBLE → darboğazı BELİRTİDEN değil YAPIDAN bul.
      //    "Açıkta kalan ders" her solve'da simetrik dersler (Kimya/Fizik/TYT) arasında
      //    keyfi değişir — ona GÜVENMEYİZ. Bunun yerine ders veren + genişletilebilir HER
      //    öğretmeni sistematik test ederiz: tam-güne çıkarınca INFEASIBLE çözülüyor mu?
      //    Çözenler = tek başına yeterli darboğaz noktaları. Hiçbiri çözmüyorsa darboğaz
      //    ÇOKLU (tek öğretmenle açılamaz) — bunu açıkça söyleriz.
      const allWin = {};
      for (const c of classes) {
        const w = windowsOf(c);
        for (const [d, slots] of Object.entries(w)) {
          (allWin[d] = allWin[d] || new Set());
          for (const s of slots) allWin[d].add(s);
        }
      }
      const fullSlots = [];
      for (const [d, set] of Object.entries(allWin)) for (const s of set) fullSlots.push([Number(d), s]);

      const teachesSomething = new Set();
      for (const c of classes) {
        const key = colKeyOf(c), grp = groupOf(c);
        for (const course of coursesOfCol(key)) {
          if (!((load[key]?.[course]) > 0)) continue;
          for (const t of teachers) {
            if ((t.branches || []).includes(course) && teacherGroups(t).includes(grp)) teachesSomething.add(t.id);
          }
        }
      }
      const candidates = teachers.filter(t => {
        if (!teachesSomething.has(t.id)) return false;
        return (teacherSlots[t.id] || []).length < fullSlots.length; // genişletilebilir
      });

      // Gün bazlı branş kıtlığı: her gün için, o gün ders verebilen öğretmenlerin
      // kapsadığı branşlar vs sınıfların ihtiyaç duyduğu branşlar. "Herkesin
      // Pazartesi'si var" sayısal üstünlük değil — asıl mesele ÇEŞİTLİLİK. Hem
      // kullanıcıya kök neden olarak gösterilir hem de gün-takası aramasını yönlendirir.
      const neededBranches = new Set();
      for (const c of classes) {
        const key = colKeyOf(c);
        for (const course of coursesOfCol(key)) if ((load[key]?.[course]) > 0) neededBranches.add(course);
      }
      const dayGaps = [];
      const windowDays = [...new Set(fullSlots.map(([d]) => d))].sort((a, b) => a - b);
      for (const d of windowDays) {
        const present = teachers.filter(t => (teacherSlots[t.id] || []).some(([dd]) => dd === d));
        const covered = new Set();
        for (const t of present) for (const b of (t.branches || [])) covered.add(b);
        const missing = [...neededBranches].filter(b => !covered.has(b));
        if (missing.length) dayGaps.push({ day: d, missing });
      }
      // En ağır kıtlık günü önce — arama bütçesi önce oraya harcansın (darboğaz
      // büyük olasılıkla en çok branşın eksik olduğu günde).
      dayGaps.sort((a, b) => b.missing.length - a.missing.length);

      // ── Müdahaleleri GERÇEK maliyetle dene (slot sayısı ≠ maliyet) ──
      // Maliyet sırası (her kurum için genel taksonomi):
      //   0) GÜN TAKASI  — ek saat YOK, ek gün YOK; öğretmen aynı yükle farklı güne kayar.
      //   1) GÜNÜ UZAT   — +2 saat, ek gün yok ("o gün 2 saat erken gel").
      //   2) YENİ GÜN AÇ — +2 saat + yepyeni bir gün (yol, tam gün blokaj) — en pahalı.
      // Toplam solver çağrısı bütçelenir; derin analiz butonu ama sonsuz sürmesin.
      let budget = 45;
      const tryFeas = async (slotsOverride) => {
        if (budget <= 0) return false;
        budget--;
        const rt = await api('/api/program-solve', {
          method: 'POST',
          body: JSON.stringify({ ...buildPayload(slotsOverride), feasibilityTest: true }),
        });
        return !!rt.feasible;
      };

      const dayOfSlots = (slots) => new Set(slots.map(([d]) => d));
      const swapFix = [];   // {teacherId,name,fromDay,toDay} — 0 ek saat
      const cheapFix = [];  // {teacherId,name,day,slots[]} — +2 saat, mevcut gün
      const costlyFix = []; // {teacherId,name,day,slots[]} — +2 saat, yeni gün

      // Ortak yardımcı: bir öğretmene belirli günlerin eksik slotlarında 2'li hizalı
      // çift ekleyerek dene; çözen ilk çifti fix listesine yaz.
      const tryPairsOn = async (t, days, targetList) => {
        const cur = teacherSlots[t.id] || [];
        const curSet = new Set(cur.map(([d, s]) => `${d}:${s}`));
        const missingByDay = {};
        for (const [d, s] of fullSlots) {
          if (!curSet.has(`${d}:${s}`)) (missingByDay[d] = missingByDay[d] || []).push(s);
        }
        for (const d of days) {
          const sorted = [...(missingByDay[d] || [])].sort((a, b) => a - b);
          for (let i = 0; i + 1 < sorted.length; i++) {
            const pair = [sorted[i], sorted[i + 1]];
            if (pair[1] - pair[0] !== 1) continue;   // ardışık değil
            if (pair[0] % 2 !== 0) continue;         // hizasız çift — atla (1-2/3-4/5-6 çözer)
            if (await tryFeas({ ...teacherSlots, [t.id]: [...cur, [d, pair[0]], [d, pair[1]]] })) {
              targetList.push({ teacherId: t.id, name: t.name, day: d, slots: [pair[0] + 1, pair[1] + 1] });
              break; // bu öğretmen+gün için ilk çözen çift yeter
            }
          }
        }
      };

      // TUR 1 (EN UCUZ SAAT EKLEME, ÖNCE ÇALIŞIR — bütçeyi takaslar tüketmesin):
      // öğretmenin ZATEN geldiği günlerdeki eksik slotlar ("2 saat erken gel").
      for (const t of candidates) {
        const workDays = [...dayOfSlots(teacherSlots[t.id] || [])];
        await tryPairsOn(t, workDays, cheapFix);
      }

      // TUR 2 (GÜN TAKASI — 0 ek saat ama kendi alt-bütçesiyle): dayGaps pusulasıyla
      // budanır — yalnız "eksik branşı olan güne, o branşın öğretmenini taşıma"
      // takasları denenir (kombinasyon patlamasın). Öğretmenin bir çalışma günü komple
      // hedef güne taşınır (aynı slot desenleri, hedef pencereyle kesişerek).
      let swapBudget = 15;
      for (const g of dayGaps) {
        const gapWin = allWin[String(g.day)] || new Set();
        // Eksik branşlardan en çoğunu kapatan öğretmen önce denensin.
        const swapCands = candidates
          .filter(t => (t.branches || []).some(b => g.missing.includes(b)))
          .sort((a, b) =>
            (b.branches || []).filter(x => g.missing.includes(x)).length -
            (a.branches || []).filter(x => g.missing.includes(x)).length);
        for (const t of swapCands) {
          const cur = teacherSlots[t.id] || [];
          const workDays = [...dayOfSlots(cur)];
          if (!workDays.length || workDays.includes(g.day)) continue;
          for (const from of workDays) {
            if (swapBudget <= 0) break;
            swapBudget--;
            const moved = cur.filter(([d]) => d !== from)
              .concat(cur.filter(([d]) => d === from).map(([, s]) => [g.day, s]))
              .filter(([d, s]) => d !== g.day || gapWin.has(s));
            if (await tryFeas({ ...teacherSlots, [t.id]: moved })) {
              swapFix.push({ teacherId: t.id, name: t.name, fromDay: from, toDay: g.day });
              break; // bu öğretmen için ilk çözen takas yeter
            }
          }
          if (swapBudget <= 0 || swapFix.length >= 3) break;
        }
        if (swapBudget <= 0 || swapFix.length >= 3) break;
      }

      // TUR 3 (EN PAHALI): yeni gün açma — dayGaps pusulasıyla sıralı: önce eksik
      // branşlı günler, o günde de eksik branşı en çok kapatan öğretmen önce. Aksi
      // halde alakasız öğretmenler bütçeyi tüketip gerçek çözümlere sıra gelmiyor.
      const daysForNew = dayGaps.length ? dayGaps.map(g => g.day) : windowDays;
      for (const d of daysForNew) {
        const g = dayGaps.find(x => x.day === d);
        const newCands = candidates
          .filter(t => !dayOfSlots(teacherSlots[t.id] || []).has(d))
          .sort((a, b) => {
            const ma = g ? (a.branches || []).filter(x => g.missing.includes(x)).length : 0;
            const mb = g ? (b.branches || []).filter(x => g.missing.includes(x)).length : 0;
            return mb - ma;
          });
        for (const t of newCands) {
          await tryPairsOn(t, [d], costlyFix);
          if (costlyFix.length >= 4) break;
        }
        if (costlyFix.length >= 4) break;
      }

      setFeasResult({
        feasible: false,
        swapFix: swapFix.slice(0, 3),
        cheapFix: cheapFix.slice(0, 4),
        costlyFix: costlyFix.slice(0, 4),
        cheapest: cheapFix[0] || null,
        dayGaps,
        budgetExhausted: budget <= 0,
        multiBottleneck: swapFix.length === 0 && cheapFix.length === 0 && costlyFix.length === 0,
      });
      showToast?.(
        (swapFix.length || cheapFix.length || costlyFix.length)
          ? 'Tüm dersler yerleşemez — çözüm önerileri hazır'
          : 'Tüm dersler yerleşemez — tek bir öğretmen değişikliği YETMİYOR (birden çok darboğaz)',
        'error'
      );
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally {
      setFeasChecking(false);
    }
  }

  // ── Çakışma kontrolü: mevcut programları oku ve çakışanları bul ──
  async function checkConflicts() {
    if (!result?.assigned.length) return;
    try {
      // Mevcut programları çek
      const existing = {};
      await Promise.all(teachers.map(async t => {
        try {
          const resp = await api(`/api/program?teacherId=${t.id}`);
          existing[t.id] = resp.program || {}; // {weekKey, program} → program
        } catch { existing[t.id] = {}; }
      }));
      const items = [];
      for (const a of result.assigned) {
        const sid = slotIdFor(a.day, a.slot); if (!sid) continue;
        const prog = existing[a.teacherId] || {};
        const dayProg = prog[String(a.day)] || {};
        const cur = dayProg[sid];
        if (cur && cur.cls && cur.cls !== a.cls) {
          const tName = teachers.find(t=>t.id===a.teacherId)?.name || a.teacherId;
          items.push(`${tName} — ${DAYS[a.day]} ${sid}: mevcut ${labelOf(cur.cls)} → yeni ${labelOf(a.cls)} (${a.course})`);
        }
      }
      setConflicts({ items, checked: true });
      return items.length;
    } catch(e) {
      showToast?.(e.message,'error');
      return -1;
    }
  }

  // ── Mevcut programları temizle ──
  async function clearAllPrograms() {
    if (!(await confirm({ message: 'Tüm öğretmenlerin izin günleri, ders programları ve etüt rezervasyonları silinecek. Emin misiniz?', confirmLabel: 'Tümünü Sil' }))) return;
    setClearing(true);
    try {
      const res = await api('/api/admin/week', { method: 'POST', body: JSON.stringify({ action: 'reset-all' }) });
      showToast?.(`Temizlendi — ${res.teachers} öğretmen, ${res.deleted.programs} program, ${res.deleted.slots} slot, ${res.deleted.offDays} izin günü`, 'success');
      // Öğretmen listesini yeniden yükle (offDays değişti)
      const data = await api('/api/teachers');
      setTeachers(data);
    } catch(e) { showToast?.(e.message,'error'); }
    finally { setClearing(false); }
  }

  // ── Uygula: program:{teacherId} şablonlarına yaz ──
  async function applyToTemplates(weekKey) {
    if (!result?.assigned.length) return;
    // Çakışma kontrolü yapılmamışsa önce kontrol et
    if (!conflicts?.checked) {
      const n = await checkConflicts();
      if (n === -1) return;
      if (n > 0) {
        showToast?.(`${n} çakışma var — kontrol edip onaylayın`,'info');
        return;
      }
    }
    setApplying(true);
    try {
      // Önce tüm öğretmenlerin programını temizle
      for (const t of teachers) {
        await api('/api/program', { method: 'DELETE', body: JSON.stringify({ teacherId: t.id }) });
      }
      // Yeni programı yaz
      const byTeacher = {};
      for (const a of result.assigned) {
        const sid = slotIdFor(a.day, a.slot); if (!sid) continue;
        byTeacher[a.teacherId] = byTeacher[a.teacherId] || {};
        byTeacher[a.teacherId][a.day] = byTeacher[a.teacherId][a.day] || {};
        const entry = {type:'ders', cls:a.cls, fixed:true, branch:a.course};
        byTeacher[a.teacherId][a.day][sid] = entry;
      }
      let ok=0;
      for (const [teacherId,program] of Object.entries(byTeacher)) {
        await api('/api/program',{method:'POST',body:JSON.stringify({teacherId,weekKey,program})});
        ok++;
      }
      showToast?.(`${ok} öğretmenin programı uygulandı`,'success');
      setConflicts(null);
    } catch(e) { showToast?.(e.message,'error'); }
    finally { setApplying(false); }
  }

  // ── PDF yazdır ──
  function printSchedule(type, id) {
    setPreview(type);
    setPreviewId(id);
    setTimeout(() => window.print(), 400);
  }

  if (!teachers) return <div className="flex items-center justify-center h-48 text-gray-400">Yükleniyor...</div>;

  // Ön eşleştirme paneli aşağıda (öğretmen seçici + TeacherPresets) — teacher.presets'i düzenler.

  let totalDemand=0;
  classes.forEach(cls => {
    const key=colKeyOf(cls);
    coursesOfCol(key).forEach(course => { totalDemand+=(load[key]?.[course])||0; });
  });
  const capByBranch={};
  teachers.forEach(t => {
    (t.branches||[]).forEach(b=>capByBranch[b]=(capByBranch[b]||0)+1);
  });

  return (
    <div className="space-y-5">
      {/* Aksiyonlar (başlık kaldırıldı) */}
      <div className="flex items-center justify-end flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-gray-500 flex items-center gap-1">Haftalık maks
            <input type="number" value={maxWeekly} onChange={e=>{setMaxWeekly(parseInt(e.target.value)||40); setPlanDirty(true);}}
              className="input !w-16 !py-1.5 text-center" />
          </label>
          <button onClick={clearAllPrograms} disabled={clearing}
            className="btn-ghost !px-3 !py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1.5 border border-red-200"
            title="Tüm öğretmenlerin mevcut programını sil">
            {clearing ? 'Siliniyor...' : 'Programları Temizle'}
          </button>
          <button onClick={feasibilityCheck} disabled={feasChecking || generating}
            className="btn-ghost !px-3 !py-2 text-xs flex items-center gap-1.5 border border-indigo-200 text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
            title="Tüm derslerin yerleşip yerleşemeyeceğini solver ile KESİN test et">
            <ShieldCheck size={14} /> {feasChecking ? 'Kontrol ediliyor…' : 'Kesin Kontrol'}
          </button>
          <button onClick={generate} disabled={generating}
            className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm disabled:opacity-60">
            <Sparkles size={14} /> {generating ? 'Oluşturuluyor… (~30 sn)' : 'Oluştur'}
          </button>
        </div>
      </div>

      {/* Kesin Kontrol sonucu */}
      {feasResult && (
        feasResult.feasible ? (
          <div className="card p-3 border-l-4" style={{borderLeftColor:'#16a34a', background:'#f0fdf4'}}>
            <div className="flex items-center gap-2 text-sm" style={{color:'#15803d', fontWeight:600}}>
              <ShieldCheck size={16} /> Tüm dersler yerleşebilir — program tam çözülür.
            </div>
          </div>
        ) : (
          <div className="card p-3 border-l-4" style={{borderLeftColor:'#dc2626', background:'#fef2f2'}}>
            <div className="flex items-center gap-2 text-sm mb-1.5" style={{color:'#b91c1c', fontWeight:700}}>
              <AlertTriangle size={16} /> Mevcut haliyle tüm dersler yerleşemez (geometrik olarak imkansız)
            </div>
            <p className="text-xs text-gray-600 mb-1">
              Toplam saatler yeterli olsa bile, ders bloklarının gün/saat ızgarasına çakışmadan
              dizilmesi mümkün değil.
            </p>
            {/* Gün bazlı branş kıtlığı — kök neden çoğu zaman burada.
                "Her öğretmenin Pazartesi'si var" sayısal üstünlük değil; o gün hangi
                BRANŞLARIN öğretmeni yoksa o günün slotları doldurulamaz. */}
            {feasResult.dayGaps?.length > 0 && (
              <div className="text-xs mt-1.5 mb-1.5 p-2 rounded-lg" style={{background:'#eff6ff', border:'1px solid #bfdbfe'}}>
                <div style={{color:'#1e40af', fontWeight:700}}>Gün bazlı öğretmen eksikliği (muhtemel kök neden):</div>
                <ul className="mt-1 space-y-0.5" style={{color:'#1e3a8a'}}>
                  {feasResult.dayGaps.map(g => (
                    <li key={g.day}>
                      • <b>{DAYS[g.day]}</b> günü şu branşların öğretmeni hiç müsait değil:{' '}
                      <b>{g.missing.join(', ')}</b>
                    </li>
                  ))}
                </ul>
                <p className="mt-1" style={{color:'#1e40af'}}>
                  O gün bu dersler işlenemediği için diğer günler tıkanıyor.
                </p>
              </div>
            )}

            {feasResult.multiBottleneck ? (
              <p className="text-xs text-gray-600 mt-1.5">
                <b>Birden fazla darboğaz var</b> — tek bir öğretmen değişikliği (gün takası, saat ekleme)
                yetmiyor. Şunları birlikte deneyin: ders yükünü azaltın, sınıf penceresine gün ekleyin,
                veya en dar branşlara (tek öğretmenli dersler) ikinci öğretmen ekleyin.
              </p>
            ) : (
              <>
                {feasResult.swapFix?.length > 0 && (
                  <>
                    <p className="text-xs mb-1 mt-1.5" style={{color:'#166534'}}>
                      <b>Saat eklemeden çözümler (gün değişikliği)</b> — öğretmenin toplam yükü
                      değişmez, sadece hangi gün geldiği değişir:
                    </p>
                    <ul className="text-xs space-y-1">
                      {feasResult.swapFix.map((s, i) => (
                        <li key={i} style={{color:'#166534'}}>
                          • <b>{s.name}</b> — <b>{DAYS[s.fromDay]}</b> yerine <b>{DAYS[s.toDay]}</b> gelsin
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {feasResult.cheapest && (
                  <div className="text-xs mt-1.5 mb-1 p-2 rounded-lg" style={{background:'#f0fdf4', border:'1px solid #bbf7d0'}}>
                    <span style={{color:'#166534', fontWeight:700}}>Düşük maliyetli saat ekleme:</span>{' '}
                    <b>{feasResult.cheapest.name}</b> — <b>{DAYS[feasResult.cheapest.day]}</b> günü zaten
                    geliyor; yalnızca <b>{feasResult.cheapest.slots.join('. ve ')}. dersi</b> de müsait
                    işaretleyin. Yeni gün açmaya gerek yok, sadece o gün erken/geç kalıyor.
                  </div>
                )}

                {feasResult.cheapFix.length > 0 && (
                  <>
                    <p className="text-xs text-gray-600 mb-1 mt-1.5">
                      <b>Ucuz çözümler</b> — öğretmen o gün <u>zaten geliyor</u>, sadece saat ekleniyor:
                    </p>
                    <ul className="text-xs space-y-1">
                      {feasResult.cheapFix.map((s, i) => (
                        <li key={i} style={{color:'#374151'}}>
                          • <b>{s.name}</b> — {DAYS[s.day]} {s.slots.join('. ve ')}. ders
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {feasResult.costlyFix.length > 0 && (
                  <>
                    <p className="text-xs text-gray-500 mb-1 mt-2">
                      <b>Maliyetli çözümler</b> — öğretmene <u>yeni bir gün</u> açmak gerekir (yol/tam gün):
                    </p>
                    <ul className="text-xs space-y-1" style={{color:'#6b7280'}}>
                      {feasResult.costlyFix.map((s, i) => (
                        <li key={i}>
                          • <b>{s.name}</b> — {DAYS[s.day]} {s.slots.join('. ve ')}. ders
                          <span className="text-gray-400"> (bu gün hiç gelmiyor)</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <p className="text-[11px] text-gray-400 mt-1.5">
                  Her satır <b>tek başına</b> çözer — hepsini birden yapmanız gerekmez. Dersler 2 saatlik
                  bloklar halinde yerleştiği için tek saat eklemek yetmez, 2 ardışık saat gerekir.
                  {feasResult.budgetExhausted && ' (Analiz süre sınırına ulaştı — listelenmeyen başka çözümler de olabilir.)'}
                </p>
              </>
            )}
          </div>
        )
      )}

      {/* Özet kartlar */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          {l:'Toplam talep', v:totalDemand+' saat', c:'#6366f1'},
          {l:'Kadro kapasitesi', v:(teachers.length*maxWeekly)+' saat', c:totalDemand>teachers.length*maxWeekly?'#dc2626':'#16a34a'},
          {l:'Sınıf sayısı', v:classes.length, c:'#0ea5e9'},
        ].map((k,i)=>(
          <div key={i} className="card p-3.5">
            <div className="text-[11px] text-gray-400 uppercase tracking-wide">{k.l}</div>
            <div className="text-xl mt-0.5" style={{fontWeight:800,color:k.c}}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Ders yükü tablosu */}
      <div className="card p-4">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div>
            <h4 className="font-600 text-sm mb-1" style={{fontWeight:600}}>Haftalık Ders Yükü</h4>
            <p className="text-xs text-gray-400 mb-3">
              Üst kutuya haftalık toplam saati, alt kutuya gruplama deseni yazın — örn 7 saat için <b>3-2-2</b> veya <b>2-2-2-1</b>.
              Boş bırakılırsa 2'li gruplar kullanılır (tek kalan saat 1'lik ders olur). Her grup aynı gün içinde ardışık işlenir, farklı gruplar farklı günlere dağılır.
              Kaydet'e basarsanız plan saklanır — sekme değiştirince sıfırlanmaz.
            </p>
          </div>
          <button onClick={savePlan} disabled={savingPlan || !planDirty}
            className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            title={planDirty ? 'Girilen değerleri kaydet' : 'Kaydedilmemiş değişiklik yok'}>
            <Save size={12}/> {savingPlan ? 'Kaydediliyor…' : planDirty ? 'Kaydet' : 'Kaydedildi'}
          </button>
        </div>
        <LoadTable load={load} setLoad={updateLoad} grouping={grouping} setGrouping={updateGrouping} cols={activeCols} courseMap={courseMap} />
      </div>

      {/* Sınıf bazlı günlük ders limiti (K7) — boş bırakılan gün serbesttir */}
      {/* Sınıf ders penceresi artık her sınıf kartından "Program Penceresi" ile işaretlenir
          (class.slotTemplate → KATI windows). Eski "Sınıf Bazlı Günlük Ders Limiti" kaldırıldı. */}

      {/* Ön eşleştirme (sabit dersler) — öğretmen seç → o öğretmene sınıf-ders kilitle (CP-SAT HARD preset). */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-label">Ön eşleştirme — öğretmen</label>
          <select className="input !w-auto text-sm" value={presetTeacherId}
            onChange={e => setPresetTeacherId(e.target.value)}>
            <option value="">Seç…</option>
            {[...teachers].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'))
              .map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        {presetTeacherId ? (() => {
          const t = teachers.find(x => x.id === presetTeacherId);
          return t ? (
            <TeacherPresets
              key={`preset-${t.id}`}
              teacher={t}
              showToast={showToast}
              onSaved={(presets) => setTeachers(prev => prev.map(x => x.id === t.id ? { ...x, presets } : x))}
            />
          ) : null;
        })() : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Bir öğretmen seçince o öğretmene sınıf-ders kilitleyebilirsiniz; program oluşturulurken çözücü
            mutlaka uyar (saati kendi seçer).
          </p>
        )}
      </div>

      {/* Ön analiz paneli */}
      {analysis && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            {analysis.ok
              ? <Check size={14} className="text-emerald-500" />
              : <AlertTriangle size={14} className="text-red-500" />}
            <span className="text-sm" style={{fontWeight:700, color: analysis.ok ? '#059669' : '#dc2626'}}>
              {analysis.ok ? 'Ön analiz tamam — oluşturabilirsiniz' : `${analysis.errors.length} hata, ${analysis.warnings.length} uyarı`}
            </span>
          </div>
          {analysis.errors.length > 0 && (
            <ul className="text-xs space-y-1">
              {analysis.errors.map((e,i) => (
                <li key={i} className="flex items-start gap-1.5 text-red-700">
                  <span className="mt-0.5 shrink-0">✕</span><span>{e}</span>
                </li>
              ))}
            </ul>
          )}
          {analysis.warnings.length > 0 && (
            <ul className="text-xs space-y-1">
              {analysis.warnings.map((w,i) => (
                <li key={i} className="flex items-start gap-1.5 text-amber-700">
                  <span className="mt-0.5 shrink-0">⚠</span><span>{w}</span>
                </li>
              ))}
            </ul>
          )}
          {analysis.infos.length > 0 && (
            <ul className="text-xs space-y-1">
              {analysis.infos.map((inf,i) => (
                <li key={i} className="flex items-start gap-1.5 text-gray-400">
                  <span className="mt-0.5 shrink-0">i</span><span>{inf}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Çakışma uyarısı */}
      {conflicts?.checked && conflicts.items.length > 0 && (
        <div className="card p-4 border-amber-200" style={{background:'#fffbeb'}}>
          <div className="flex items-start gap-2 mb-2">
            <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-amber-700" style={{fontWeight:700}}>Mevcut programla {conflicts.items.length} çakışma var</p>
              <p className="text-xs text-amber-600 mt-0.5">Uygulamak bu slotların üzerine yazacak. Devam etmek istiyor musunuz?</p>
            </div>
          </div>
          <ul className="text-xs text-gray-600 mb-3 space-y-0.5 pl-5 list-disc">
            {conflicts.items.slice(0,10).map((item,i)=><li key={i}>{item}</li>)}
            {conflicts.items.length>10 && <li className="text-gray-400">...ve {conflicts.items.length-10} tane daha</li>}
          </ul>
          <div className="flex gap-2">
            <button onClick={() => applyToTemplates(currentWeekKey())} disabled={applying}
              className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5">
              {applying ? 'Uygulanıyor...' : <><Check size={12}/> Yine de Uygula</>}
            </button>
            <button onClick={() => setConflicts(null)} className="btn-ghost !px-3 !py-1.5 text-xs">İptal</button>
          </div>
        </div>
      )}

      {/* Sonuç */}
      {result && (
        <ResultView
          result={result} classes={classes} teachers={teachers} labelOf={labelOf}
          maxWeekly={maxWeekly} applying={applying}
          conflictsChecked={conflicts?.checked && conflicts.items.length === 0}
          onApply={() => applyToTemplates(currentWeekKey())}
          onCheckConflicts={checkConflicts}
          onPrintTeacher={id => printSchedule('teacher',id)}
          onPrintClass={cls => printSchedule('class',cls)}
        />
      )}

      {/* Yazdırma önizleme (ekranda gizli, sadece print'te görünür) */}
      {preview && result && (
        <PrintPreview
          type={preview} id={previewId}
          result={result} teachers={teachers} classes={classes} labelOf={labelOf}
          brandName={branding?.name}
          onClose={()=>setPreview(null)}
        />
      )}
    </div>
  );
}

// ── Ders yükü tablosu: sütunlar dikey, satırlar dersler ──
// Her hücre iki girişli: üstte toplam SAAT, altta gruplama deseni (örn "3-2-2").
// Desen boşsa varsayılan 2'li bölme uygulanır. Desen girilince saat = desen toplamı.
function LoadTable({ load, setLoad, grouping, setGrouping, cols, courseMap }) {
  // Bilinen sıradaki çekirdek dersler önce, kurumun özel dersleri (courseMap'te olup
  // ORDER'da olmayan) sona eklenir — böylece "Paragraf" gibi dersler satırlardan düşmez.
  const allCourses = useMemo(() => {
    const used = new Set();
    for (const c of cols) for (const d of (courseMap[c.key] || [])) used.add(d);
    const known = ORDER.filter(d => used.has(d));
    const extra = [...used].filter(d => !ORDER.includes(d));
    return [...known, ...extra];
  }, [cols, courseMap]);
  const [editing, setEditing] = useState({}); // "colKey|ders" → yazım halindeki ham desen

  const clearPattern = (key, d) => setGrouping(prev => {
    if (prev[key]?.[d] == null) return prev;
    const nk = { ...(prev[key] || {}) }; delete nk[d];
    const next = { ...prev, [key]: nk };
    if (!Object.keys(nk).length) delete next[key];
    return next;
  });

  const set = (key, d, val) => {
    setLoad(prev => ({...prev,[key]:{...(prev[key]||{}),[d]:Math.max(0,parseInt(val)||0)}}));
    clearPattern(key, d); // saat değişince eski desen toplamla çelişir — varsayılana dön
  };

  // Desen commit (blur): geçerliyse normalize edip sakla, saat = desen toplamı.
  const commitPattern = (key, d, raw) => {
    setEditing(s => { const n = {...s}; delete n[key+'|'+d]; return n; });
    const pat = parsePattern(raw);
    const cur = grouping?.[key]?.[d] || '';
    if (!pat.length) { if (cur) clearPattern(key, d); return; }
    const norm = pat.join('-');
    const sum = pat.reduce((a,b)=>a+b,0);
    if (norm === cur && sum === ((load[key]?.[d])||0)) return; // değişiklik yok
    setGrouping(prev => ({...prev, [key]: {...(prev[key]||{}), [d]: norm}}));
    setLoad(prev => ({...prev, [key]: {...(prev[key]||{}), [d]: sum}}));
  };

  const sumFor = key => (courseMap[key]||[]).reduce((s,d)=>s+((load[key]?.[d])||0),0);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full" style={{borderCollapse:'collapse', tableLayout:'fixed'}}>
        <thead>
          <tr>
            <th className="text-left px-2 py-1 text-gray-400 sticky left-0 bg-white" style={{fontWeight:600, width:120}}>Ders</th>
            {cols.map(c => (
              <th key={c.key} className="px-1 py-1 text-gray-600 text-center" style={{fontWeight:700, width:64}}>
                {/* Dikey yazı */}
                <div style={{writingMode:'vertical-rl', transform:'rotate(180deg)', whiteSpace:'nowrap', height:90, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11}}>
                  {c.label}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allCourses.map(d => (
            <tr key={d} className="border-t border-gray-50">
              <td className="px-2 py-1.5 sticky left-0 bg-white" style={{fontWeight:600}}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:COURSE_COLOR[d] || '#94a3b8'}} />
                  {d}
                </span>
              </td>
              {cols.map(c => {
                if (!courseMap[c.key]?.includes(d))
                  return <td key={c.key} className="text-center text-gray-100 px-1 py-1">–</td>;
                const h = (load[c.key]?.[d]) || 0;
                const ek = c.key + '|' + d;
                return (
                  <td key={c.key} className="text-center px-1 py-1 align-top">
                    <input type="number" min="0" value={h}
                      onChange={e=>set(c.key,d,e.target.value)}
                      className="input !w-full !py-1.5 text-center text-sm" />
                    <input type="text" inputMode="numeric"
                      value={editing[ek] ?? grouping?.[c.key]?.[d] ?? ''}
                      placeholder={h > 0 ? defaultSplit(h).join('-') : '—'}
                      onChange={e=>setEditing(s=>({...s,[ek]:e.target.value}))}
                      onBlur={e=>commitPattern(c.key,d,e.target.value)}
                      className="input !w-full !py-1 text-center mt-1"
                      style={{fontSize:10, color:'var(--text-muted)'}}
                      title="Gruplama — örn 3-2-2 (boş = 2'li bloklar, tek kalan saat 1'lik)" />
                  </td>
                );
              })}
            </tr>
          ))}
          <tr style={{background:'var(--bg-muted)'}} className="border-t-2 border-gray-200">
            <td className="px-2 py-2 sticky left-0 font-700" style={{background:'var(--bg-muted)',color:'var(--text-secondary)',fontWeight:700}}>Σ saat</td>
            {cols.map(c => {
              const s=sumFor(c.key);
              const cap = c.key.startsWith('Mezun') ? 24 : 200;
              return <td key={c.key} className="text-center px-1 py-2" style={{fontWeight:700,color:s>cap?'#dc2626':'var(--text-secondary)'}}>{s}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Sonuç görünümü ──
function ResultView({ result, classes, teachers, labelOf, maxWeekly, applying, conflictsChecked, onApply, onCheckConflicts, onPrintTeacher, onPrintClass }) {
  const [viewMode, setViewMode] = useState('class');
  const [viewDay, setViewDay]   = useState('all');

  const usedDays = [...new Set(result.assigned.map(a=>a.day))].sort();
  const days = viewDay==='all' ? usedDays : [parseInt(viewDay)];
  const teacherById={}; teachers.forEach(t=>teacherById[t.id]=t);
  const loadRows = teachers.map(t=>({name:t.name,n:result.tLoad[t.id]||0,branch:(t.branches||[])[0],id:t.id})).sort((a,b)=>b.n-a.n);
  const maxN = Math.max(1,...loadRows.map(r=>r.n));

  const unplacedGrouped={};
  result.unplaced.forEach(u=>{const k=`${u.course} — ${u.reason}`;(unplacedGrouped[k]=unplacedGrouped[k]||{cls:new Set(),n:0}).n++;unplacedGrouped[k].cls.add(u.cls);});

  const rowKeys = viewMode==='class' ? classes : teachers.map(t=>t.name);

  const find=(rk,d,i)=>result.assigned.find(a=>a.day===d&&a.slot===i&&(
    viewMode==='class'?a.cls===rk:a.teacherName===rk));

  return (
    <div className="card p-4 space-y-3">
      {/* Durum + kontroller */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-emerald-100 text-emerald-700" style={{padding:'6px 12px',fontSize:12}}>✓ {result.total} yerleşti</span>
          {result.unplaced.length>0 && (
            <span className="badge bg-red-100 text-red-700" style={{padding:'6px 12px',fontSize:12}}>⚠ {result.unplaced.length} açıkta</span>
          )}
          <span className="badge bg-gray-100 text-gray-500" style={{padding:'6px 12px',fontSize:12}}>{result.ms}ms</span>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <select value={viewMode} onChange={e=>setViewMode(e.target.value)} className="input !w-auto !py-1.5 text-xs">
            <option value="class">Sınıf bazlı</option>
            <option value="teacher">Öğretmen bazlı</option>
          </select>
          <select value={viewDay} onChange={e=>setViewDay(e.target.value)} className="input !w-auto !py-1.5 text-xs">
            <option value="all">Tüm günler</option>
            {usedDays.map(d=><option key={d} value={d}>{DAYS[d]}</option>)}
          </select>
          {conflictsChecked
            ? (
              <button onClick={onApply} disabled={applying||result.unplaced.length>0}
                className="btn-success !px-3 !py-1.5 flex items-center gap-1.5 text-xs disabled:opacity-50">
                {applying?'Uygulanıyor...':<><Check size={13}/> Şablona Uygula</>}
              </button>
            ) : (
              <button onClick={onCheckConflicts} disabled={applying||result.unplaced.length>0}
                className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-xs disabled:opacity-50"
                title={result.unplaced.length?'Önce tüm dersler yerleşmeli':''}>
                <Check size={13}/> Uygula
              </button>
            )
          }
        </div>
      </div>

      {/* Yerleşemeyen dersler */}
      {result.unplaced.length>0 && (
        <details className="rounded-xl border border-red-100 p-3 text-xs" style={{background:'#fef2f2aa'}}>
          <summary className="cursor-pointer text-red-600 flex items-center gap-1.5" style={{fontWeight:700}}>
            <AlertTriangle size={13}/> Yerleşemeyen ({result.unplaced.length})
          </summary>
          <ul className="mt-2 space-y-1 text-gray-600">
            {Object.entries(unplacedGrouped).map(([k,v])=>(
              <li key={k}>• <b>{k}</b> ×{v.n} <span className="text-gray-400">({[...v.cls].map(c=>labelOf(c)).join(', ')})</span></li>
            ))}
          </ul>
        </details>
      )}

      {/* Öğretmen yük + PDF butonları */}
      <details className="rounded-xl border border-gray-100 p-3" open>
        <summary className="cursor-pointer text-indigo-600 text-xs" style={{fontWeight:700}}>Öğretmen yük dağılımı (saat) & PDF</summary>
        <div className="mt-2 grid md:grid-cols-2 gap-x-6 gap-y-1.5">
          {loadRows.map(r=>(
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 truncate text-gray-600">{r.name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="h-full rounded-full" style={{width:`${r.n/maxN*100}%`,background:r.n>maxWeekly?'#ef4444':COURSE_COLOR[r.branch]||'#6366f1'}}/>
              </div>
              <span className="w-7 text-right" style={{fontWeight:600,color:r.n>maxWeekly?'#dc2626':'#374151'}}>{r.n}</span>
              <button onClick={()=>onPrintTeacher(r.id)} className="btn-icon btn-icon-primary ml-1" title="PDF / Yazdır">
                <Download size={11}/>
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-[11px] text-gray-400 mb-2">Sınıf programı PDF:</p>
          <div className="flex flex-wrap gap-1.5">
            {classes.map(cls=>(
              <button key={cls} onClick={()=>onPrintClass(cls)}
                className="px-2 py-1 rounded-lg border border-gray-200 text-[10px] text-gray-500 hover:border-indigo-300 hover:text-indigo-600 flex items-center gap-1">
                <Download size={9}/> {labelOf(cls)}
              </button>
            ))}
          </div>
        </div>
      </details>

      {/* Program tablosu */}
      <div className="overflow-x-auto">
        <table className="text-[11px]" style={{borderCollapse:'collapse'}}>
          <thead>
            {/* Gün başlıkları — her gün için sütun sayısı kadar birleşik hücre */}
            <tr>
              <th className="p-2 sticky left-0 z-10" rowSpan={2} style={{background:'#f5f6fb',border:'1px solid #eef0f5',verticalAlign:'middle'}}>
                {viewMode==='class'?'Sınıf':viewMode==='teacher'?'Öğretmen':'Derslik'}
              </th>
              {days.map(d => {
                const slotsInDay = [...new Set(result.assigned.filter(a=>a.day===d).map(a=>a.slot))].sort((a,b)=>a-b);
                return (
                  <th key={d} colSpan={slotsInDay.length || 1}
                    style={{minWidth:72,border:'1px solid #eef0f5',borderLeft:'3px solid #c7d2fe',background:'#eef2ff',textAlign:'center',padding:'4px 6px',fontWeight:700,color:'#4338ca',fontSize:11}}>
                    {DAYS[d]}
                  </th>
                );
              })}
            </tr>
            {/* Ders sırası numaraları */}
            <tr>
              {days.map(d => {
                const slotsInDay = [...new Set(result.assigned.filter(a=>a.day===d).map(a=>a.slot))].sort((a,b)=>a-b);
                return slotsInDay.map((s,si) => (
                  <th key={d+'-'+s} className="p-1 text-gray-400"
                    style={{minWidth:64,border:'1px solid #eef0f5',borderLeft:si===0?'3px solid #c7d2fe':'1px solid #eef0f5',background:'#f5f6fb',fontWeight:500,textAlign:'center'}}>
                    {si+1}
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map(rk=>(
              <tr key={rk}>
                <td className="p-2 sticky left-0 z-10 whitespace-nowrap" style={{background:'#fff',fontWeight:700,border:'1px solid #eef0f5'}}>
                  {viewMode==='class'?labelOf(rk):viewMode==='room'?`D${rk} (${rk<=5?'1.k':rk<=8?'2.k':'3.k'})`:rk}
                </td>
                {days.map(d => {
                  const slotsInDay = [...new Set(result.assigned.filter(a=>a.day===d).map(a=>a.slot))].sort((a,b)=>a-b);
                  return slotsInDay.map((s,si) => {
                    const a=find(rk,d,s);
                    const leftBorder = si===0 ? '3px solid #c7d2fe' : '1px solid #eef0f5';
                    if (!a) return <td key={d+'-'+s} style={{minWidth:64,border:'1px solid #eef0f5',borderLeft:leftBorder}}/>;
                    const col=COURSE_COLOR[a.course]||'#6366f1';
                    return (
                      <td key={d+'-'+s} className="p-1 text-center" style={{minWidth:64,border:`1px solid ${col}30`,borderLeft:si===0?`3px solid ${col}60`:undefined,background:`${col}14`,color:col}}>
                        <b>{viewMode==='class'?shortCourse(a.course):labelOf(a.cls)}</b><br/>
                        <span style={{opacity:.6,fontSize:10}}>{viewMode==='class'?a.teacherName.split(' ')[0]:shortCourse(a.course)}</span>
                      </td>
                    );
                  });
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Yazdırma önizleme (print-only div) ──
function PrintPreview({ type, id, result, teachers, classes, labelOf, brandName, onClose }) {
  // Bir öğretmenin programını veya bir sınıfın programını oluştur
  const pages = useMemo(() => {
    if (type==='teacher') {
      return teachers.map(t => {
        const lessons = result.assigned.filter(a=>a.teacherId===t.id);
        return { key:t.id, title:`${t.name} — ${(t.branches||[]).join(', ')}`, lessons };
      });
    } else {
      return classes.map(cls => {
        const lessons = result.assigned.filter(a=>a.cls===cls);
        return { key:cls, title:`${labelOf(cls)} Sınıfı Ders Programı`, lessons };
      });
    }
  }, [type, result, teachers, classes, labelOf]);

  const filteredPages = id ? pages.filter(p => p.key === id) : pages;

  // Önizlemeyi PORTAL ile doğrudan document.body'ye render et. Böylece #print-preview
  // body'nin DOĞRUDAN çocuğu olur → print CSS'i "body > *:not(#print-preview) gizle"
  // basit ve güvenilir kuralıyla çalışır (derin DOM'da :has()/visibility desenleri boş
  // sayfa/sidebar sızması üretiyordu). SSR-safe: mount olana dek null döner.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted) return null;

  const content = (
    <div className="fixed inset-0 bg-white z-50 overflow-auto print:static" id="print-preview">
      <div className="no-print p-4 border-b flex items-center justify-between sticky top-0 bg-white z-10">
        <span className="font-700 text-sm" style={{fontWeight:700}}>
          <Eye size={14} className="inline mr-1"/>
          {type==='teacher'?'Öğretmen Programları':'Sınıf Programları'} — {filteredPages.length} sayfa
        </span>
        <div className="flex gap-2">
          <button onClick={()=>window.print()} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5">
            <Download size={13}/> PDF / Yazdır
          </button>
          <button onClick={onClose} className="btn-ghost !px-3 !py-2">Kapat</button>
        </div>
      </div>
      {filteredPages.map((pg,pi)=>(
        <SchedulePage key={pi} title={pg.title} lessons={pg.lessons} labelOf={labelOf} brandName={brandName} />
      ))}
    </div>
  );

  return createPortal(content, document.body);
}

function SchedulePage({ title, lessons, labelOf, brandName }) {
  const usedDays = [...new Set(lessons.map(a=>a.day))].sort();
  // Her gün için slotları sıralı dizi — sıra numarası = slot sırası
  const dayLessons = usedDays.map(d =>
    lessons.filter(a=>a.day===d).sort((a,b)=>a.slot-b.slot)
  );
  const maxRows = Math.max(0, ...dayLessons.map(ls=>ls.length));

  return (
    <div className="print-page p-8" style={{pageBreakAfter:'always',minHeight:'100vh'}}>
      <div className="mb-4 border-b pb-2">
        <h2 style={{fontWeight:700,fontSize:16}}>{title}</h2>
        <p style={{fontSize:11,color:'#9ca3af'}}>{brandName ? `${brandName} — ` : ''}Haftalık Ders Programı</p>
      </div>
      {lessons.length===0 ? (
        <p style={{color:'#9ca3af',fontSize:12}}>Bu program için tanımlı ders bulunmuyor.</p>
      ) : (
        <table style={{borderCollapse:'collapse',width:'100%',fontSize:11}}>
          <thead>
            <tr>
              <th style={{border:'1px solid #e5e7eb',padding:'6px 8px',background:'#f9fafb',textAlign:'center',color:'#9ca3af',width:36}}>Sıra</th>
              {usedDays.map(d => (
                <th key={d} style={{border:'1px solid #e5e7eb',borderLeft:'3px solid #6366f1',padding:'6px 8px',background:'#eef2ff',textAlign:'center',fontWeight:700,color:'#4338ca'}}>
                  {DAYS[d]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...Array(maxRows).keys()].map(rowIdx => (
              <tr key={rowIdx}>
                <td style={{border:'1px solid #e5e7eb',padding:'5px 8px',color:'#9ca3af',textAlign:'center',fontWeight:600,background:'#f9fafb'}}>{rowIdx+1}</td>
                {usedDays.map((d,di) => {
                  const a = dayLessons[di][rowIdx];
                  if (!a) return <td key={d+'-'+rowIdx} style={{border:'1px solid #e5e7eb',borderLeft:'3px solid #6366f130',background:'#fafafa'}}/>;
                  const col = COURSE_COLOR[a.course]||'#6366f1';
                  return (
                    <td key={d+'-'+rowIdx} style={{border:`1px solid ${col}30`,borderLeft:`3px solid ${col}60`,background:`${col}12`,padding:'5px 8px',textAlign:'center'}}>
                      <div style={{fontWeight:700,color:col,fontSize:11}}>{a.course}</div>
                      <div style={{fontSize:10,color:'#6b7280'}}>{slotLabel(d, a.slot)}</div>
                      <div style={{fontSize:10,color:'#9ca3af'}}>{labelOf(a.cls)}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
