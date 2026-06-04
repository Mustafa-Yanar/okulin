'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Sparkles, AlertTriangle, Check, Download, Eye } from 'lucide-react';
import {
  STUDENT_GROUPS, classToGroup, WEEKDAY_SLOT_IDS, WEEKEND_SLOT_IDS,
  DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES,
} from '@/lib/constants';

// Ders adı = branş adı; otomatik eşleme yok (çoklu branş modeli).

const DAYS = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
const SLOTS_PER_DAY = 12;
const MEZUN_DAYS = [0,1,2,3];           // Pzt–Per
const MEZUN_SLOTS = [0,1,2,3,4,5];      // w1–w6
const WEEKEND_DAYS = [5,6];

// Hafta içi lise/ortaokul: sadece w10(idx=9) ve w11(idx=10) — 17:15-18:35
const WEEKDAY_LISE_SLOTS = [9,10];
// Hafta sonu — gruba göre kullanılabilir slotlar
// Ortaokul: e1-e10 (idx 0-9) = 5 blok/gün
// Lise: e1-e12 (idx 0-11) = 6 blok/gün (tüm hafta sonu açık)
const WEEKEND_ORTAOKUL_SLOTS = [0,1,2,3,4,5,6,7,8,9];
const WEEKEND_LISE_SLOTS     = [0,1,2,3,4,5,6,7,8,9,10,11];

const FLOOR1 = [1,2,3,4,5], FLOOR2 = [6,7,8], FLOOR3 = [9,10,11,12];

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

const DEFAULT_LOAD = {
  'Ortaokul_7':              {'Türkçe':4,'Matematik':4,'Fen Bilgisi':4,'Sosyal Bilgiler':4,'İngilizce':4},
  'Ortaokul_8':              {'Türkçe':4,'Matematik':4,'Fen Bilgisi':4,'İnkılap Tarihi':4,'İngilizce':4},
  'Lise Ortak_9':            {'Türkçe':4,'Matematik':4,'Fizik':2,'Kimya':2,'Biyoloji':2,'Tarih':2,'Coğrafya':2,'Felsefe':0},
  'Lise Ortak_10':           {'Türkçe':4,'Matematik':4,'Fizik':2,'Kimya':2,'Biyoloji':2,'Tarih':2,'Coğrafya':2,'Felsefe':0},
  'Lise Sayısal_11':         {'Türkçe':4,'Matematik':4,'Fizik':4,'Kimya':4,'Biyoloji':4},
  'Lise Eşit Ağırlık_11':   {'Türkçe':4,'Matematik':4,'Tarih':4,'Coğrafya':4,'Felsefe':0},
  'Lise Sayısal_12':         {'Türkçe':4,'TYT Matematik':4,'AYT Matematik':4,'Geometri':2,'Fizik':4,'Kimya':4,'Biyoloji':4},
  'Lise Eşit Ağırlık_12':   {'Türkçe':4,'TYT Matematik':4,'AYT Matematik':4,'Geometri':2,'Tarih':4,'Coğrafya':4,'Felsefe':2},
  'Mezun Sayısal':           {'Türkçe':2,'TYT Matematik':4,'AYT Matematik':4,'Geometri':2,'Fizik':4,'Kimya':4,'Biyoloji':4},
  'Mezun Eşit Ağırlık':     {'Türkçe':4,'TYT Matematik':4,'AYT Matematik':4,'Geometri':2,'Tarih':4,'Coğrafya':4,'Felsefe':2},
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
function coursesForClass(cls) { return coursesForCol(colKeyFor(cls)); }

const ALL_CLASSES = [...STUDENT_GROUPS.ortaokul.classes,...STUDENT_GROUPS.lise.classes,...STUDENT_GROUPS.mezun.classes];

function teacherTeaches(t, course) {
  return (t.branches || []).includes(course);
}

// Sınıfın ders bloklarını döndürür: [[gün, slotA, slotB], ...]
// Her blok = 2 ardışık slot (aynı ders çifti)
// Kural: 9/10. hafta sonu blokları sadece ortaokula açık; lise ve mezun asla kullanamaz
function classBlockPairs(cls) {
  const g = classToGroup(cls);
  const blocks = [];
  if (g === 'mezun') {
    // Sabah blokları: w1-w6 (idx 0-5) → 3 blok/gün × 4 gün = 12 blok
    MEZUN_DAYS.forEach(d => {
      for (let i = 0; i < MEZUN_SLOTS.length; i += 2)
        blocks.push([d, MEZUN_SLOTS[i], MEZUN_SLOTS[i+1]]);
    });
    return blocks;
  }
  // Ortaokul: 5 blok/gün (e1-e10); Lise: 6 blok/gün (e1-e12, sınır yok)
  const wkendSlots = g === 'ortaokul' ? WEEKEND_ORTAOKUL_SLOTS : WEEKEND_LISE_SLOTS;
  WEEKEND_DAYS.forEach(d => {
    for (let i = 0; i < wkendSlots.length; i += 2)
      blocks.push([d, wkendSlots[i], wkendSlots[i+1]]);
  });
  // Hafta içi akşam: idx 9,10 → 1 blok per gün
  [0,1,2,3,4].forEach(d => blocks.push([d, 9, 10]));
  return blocks;
}

function classRoomMap(classes) {
  const map = {}; const used1=[], used2=[], used3=[];
  const nextFree = (floor, usedArr) => { for (const r of floor) if (!usedArr.includes(r)){usedArr.push(r);return r;} return floor[0]; };
  classes.forEach(cls => {
    const g = classToGroup(cls);
    if (g === 'ortaokul') map[cls] = nextFree(FLOOR3, used3);
    else if (g === 'mezun') {
      if (['m1','m2','m3','m6','m7'].includes(cls)) map[cls] = nextFree(FLOOR1, used1);
      else if (['m4','m8','m9'].includes(cls)) map[cls] = nextFree(FLOOR2, used2);
      else map[cls] = nextFree([...FLOOR1,...FLOOR2], [...used1,...used2]);
    }
  });
  classes.filter(c=>classToGroup(c)==='lise')
    .sort((a,b)=>parseInt(b[0])-parseInt(a[0])||a.localeCompare(b))
    .forEach(cls=>{ map[cls]=nextFree([...FLOOR1,...FLOOR2,...FLOOR3],[...used1,...used2,...used3]); });
  return map;
}

function slotIdFor(day, slotIdx) {
  return day >= 5 ? WEEKEND_SLOT_IDS[slotIdx] : WEEKDAY_SLOT_IDS[slotIdx];
}
function slotLabel(day, slotIdx) {
  const times = day >= 5 ? DEFAULT_WEEKEND_TIMES : DEFAULT_WEEKDAY_TIMES;
  const t = times[slotIdx];
  return t ? `${t.start}–${t.end}` : '';
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

// Bir grubun kullanabileceği toplam blok kapasitesi (öğretmen başına)
function teacherBlockCap(t, grp) {
  const offDays = new Set(t.offDays || []);
  if (grp === 'mezun') {
    return MEZUN_DAYS.filter(d => !offDays.has(d)).length * (MEZUN_SLOTS.length / 2);
  }
  // Ortaokul: 5 blok/gün (e1-e10); Lise: 6 blok/gün (e1-e12, sınır yok)
  const wkendBlks = grp === 'ortaokul' ? 5 : 6;
  const wkend = WEEKEND_DAYS.filter(d => !offDays.has(d)).length * wkendBlks;
  const wkday = [0,1,2,3,4].filter(d => !offDays.has(d)).length * 1;
  return wkend + wkday;
}

// Ön analiz: oluşturmadan önce kapasite/çakışma sorunlarını hesapla
function analyzeLoad(classes, load, teachers) {
  const errors = [], warnings = [], infos = [];

  // 1. Tek sayı kontrolü
  for (const cls of classes) {
    const key = colKeyFor(cls);
    for (const course of coursesForCol(key)) {
      const h = (load[key]?.[course]) || 0;
      if (h > 0 && h % 2 !== 0) {
        errors.push(`${cls.toUpperCase()} — ${course}: ${h} saat (tek sayı, blok yapılamaz)`);
      }
    }
  }

  // 2. Uygun öğretmen yok
  for (const cls of classes) {
    const key = colKeyFor(cls), grp = classToGroup(cls);
    for (const course of coursesForCol(key)) {
      const h = (load[key]?.[course]) || 0; if (h <= 0) continue;
      const eligible = teachers.filter(tt =>
        teacherTeaches(tt, course) && teacherGroups(tt).includes(grp)
      );
      if (eligible.length === 0) {
        errors.push(`${cls.toUpperCase()} — ${course}: uygun öğretmen yok`);
      }
    }
  }

  // 3. Branş bazında talep vs kapasite
  // Her branş için: toplam talep saati ve toplam blok kapasitesi
  const branchDemand = {}; // branch → toplam saat talebi
  const branchPairs = {};  // branch+grp kombinasyonu için toplam çift talebi

  for (const cls of classes) {
    const key = colKeyFor(cls), grp = classToGroup(cls);
    for (const course of coursesForCol(key)) {
      const h = (load[key]?.[course]) || 0; if (h <= 0) continue;
      const branch = course; // ders adı = branş
      const k = branch + '|' + grp;
      branchPairs[k] = (branchPairs[k] || 0) + Math.ceil(h / 2);
      branchDemand[branch] = (branchDemand[branch] || 0) + h;
    }
  }

  // Her branş+grup için uygun öğretmenlerin toplam blok kapasitesi
  for (const [bk, pairDemand] of Object.entries(branchPairs)) {
    const [branch, grp] = bk.split('|');
    const eligible = teachers.filter(tt =>
      teacherTeaches(tt, branch) && teacherGroups(tt).includes(grp)
    );
    if (eligible.length === 0) continue; // zaten hata var yukarıda
    const totalCap = eligible.reduce((s, t) => s + teacherBlockCap(t, grp), 0);
    if (pairDemand > totalCap) {
      const grpLabel = grp === 'mezun' ? 'Mezun' : grp === 'lise' ? 'Lise' : 'Ortaokul';
      errors.push(`${branch} (${grpLabel}): ${pairDemand * 2} saat talep, ${totalCap * 2} saat kapasite — ${pairDemand - totalCap} blok sığmaz`);
    } else if (pairDemand > totalCap * 0.85) {
      const grpLabel = grp === 'mezun' ? 'Mezun' : grp === 'lise' ? 'Lise' : 'Ortaokul';
      warnings.push(`${branch} (${grpLabel}): kapasite %${Math.round(pairDemand/totalCap*100)} dolu — yerleştirme zorlaşabilir`);
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
    const key = colKeyFor(cls);
    return s + coursesForCol(key).reduce((ss, c) => ss + ((load[key]?.[c]) || 0), 0);
  }, 0);
  if (totalHours === 0) {
    infos.push('Hiç ders saati girilmemiş — ders yükü tablosunu doldurun.');
  }

  return { errors, warnings, infos, ok: errors.length === 0 };
}

// ── Ana bileşen ──
export default function ProgramOlusturucu({ api, showToast, activeClasses }) {
  const [teachers, setTeachers] = useState(null);
  const [load, setLoad]         = useState(() => JSON.parse(JSON.stringify(DEFAULT_LOAD)));
  const [result, setResult]     = useState(null);
  const [maxWeekly, setMaxWeekly] = useState(40);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying]   = useState(false);
  const [clearing, setClearing]   = useState(false);
  const [conflicts, setConflicts] = useState(null);
  const [preview, setPreview]     = useState(null);
  const [previewId, setPreviewId] = useState(null);
  const [analysis, setAnalysis]   = useState(null);
  // Ön eşleştirme (preset) paneli
  const [presets, setPresets]         = useState([]); // [{teacherId, cls, course}]
  const [presetCls, setPresetCls]       = useState('');
  const [presetCourse, setPresetCourse] = useState('');
  const [presetTeacher, setPresetTeacher] = useState('');

  const classes = useMemo(() => {
    const base = (activeClasses?.length) ? activeClasses : ALL_CLASSES;
    return base.filter(c => ALL_CLASSES.includes(c)).sort();
  }, [activeClasses]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/teachers');
        setTeachers(data);
      } catch(e) { showToast?.(e.message,'error'); setTeachers([]); }
    })();
  }, [api, showToast]);

  // Analizi yeniden hesapla: teachers/load/extraWeekend/classes değişince
  useEffect(() => {
    if (!teachers) return;
    setAnalysis(analyzeLoad(classes, load, teachers));
  }, [teachers, load, classes]);

  // Ders yükü tablosu her zaman tüm sütunları gösterir
  const activeCols = LOAD_COLUMNS;

  // ── CP-SAT çözücü (OR-Tools, Python serverless) ──
  // Kısıtların tümü server'da modellenir; frontend payload'ı hazırlar ve sonucu gösterir.
  async function generate() {
    if (!teachers) return;
    setResult(null);
    setConflicts(null);
    setGenerating(true);
    try {
      // Her sınıfın blok havuzu + sütun anahtarı + grubu → payload (domain mantığı tek kaynak: burası)
      const blocks = {}, colKey = {}, group = {};
      classes.forEach(c => {
        blocks[c] = classBlockPairs(c);
        colKey[c] = colKeyFor(c);
        group[c] = classToGroup(c);
      });

      // KATI mod: her öğretmenin işaretlediği (gün, slotIndex) çiftlerini topla.
      // Müdür slotu 'available' olarak işaretliyor; işaretsiz öğretmene ders atanmaz.
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
              const idx = day >= 5 ? WEEKEND_SLOT_IDS.indexOf(slotId) : WEEKDAY_SLOT_IDS.indexOf(slotId);
              if (idx >= 0) pairs.push([day, idx]);
            }
          }
          teacherSlots[t.id] = pairs;
        } catch { teacherSlots[t.id] = []; }
      }));

      const payload = { classes, teachers, load, maxWeekly, blocks, colKey, group, teacherSlots, presets };
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
          items.push(`${tName} — ${DAYS[a.day]} ${sid}: mevcut ${cur.cls.toUpperCase()} → yeni ${a.cls.toUpperCase()} (${a.course})`);
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
    if (!window.confirm('Tüm öğretmenlerin izin günleri, ders programları ve etüt rezervasyonları silinecek. Emin misiniz?')) return;
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

  const teacherById = {}; teachers.forEach(t => teacherById[t.id] = t);

  // Bir ders+sınıf için uygun öğretmenler (analyzeLoad'daki eligible mantığıyla aynı)
  function eligibleTeachersForPreset(cls, course) {
    if (!cls || !course) return [];
    const grp = classToGroup(cls);
    return teachers.filter(t => teacherTeaches(t, course) && teacherGroups(t).includes(grp));
  }
  function addPreset() {
    if (!presetTeacher || !presetCls || !presetCourse) return;
    setPresets(prev => {
      const filtered = prev.filter(p => !(p.cls === presetCls && p.course === presetCourse));
      return [...filtered, { teacherId: presetTeacher, cls: presetCls, course: presetCourse }];
    });
    setPresetTeacher('');
  }
  function removePreset(i) {
    setPresets(prev => prev.filter((_, idx) => idx !== i));
  }

  let totalDemand=0;
  classes.forEach(cls => {
    const key=colKeyFor(cls);
    coursesForCol(key).forEach(course => { totalDemand+=(load[key]?.[course])||0; });
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
            <input type="number" value={maxWeekly} onChange={e=>setMaxWeekly(parseInt(e.target.value)||40)}
              className="input !w-16 !py-1.5 text-center" />
          </label>
          <button onClick={clearAllPrograms} disabled={clearing}
            className="btn-ghost !px-3 !py-2 text-xs text-red-500 hover:bg-red-50 flex items-center gap-1.5 border border-red-200"
            title="Tüm öğretmenlerin mevcut programını sil">
            {clearing ? 'Siliniyor...' : 'Programları Temizle'}
          </button>
          <button onClick={generate} disabled={generating}
            className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm disabled:opacity-60">
            <Sparkles size={14} /> {generating ? 'Oluşturuluyor… (~30 sn)' : 'Oluştur'}
          </button>
        </div>
      </div>

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
        <h4 className="font-600 text-sm mb-1" style={{fontWeight:600}}>Haftalık Ders Yükü</h4>
        <p className="text-xs text-gray-400 mb-3">Her sınıf türü için haftalık ders saatlerini girin.</p>
        <LoadTable load={load} setLoad={setLoad} cols={activeCols} />
      </div>

      {/* Ön eşleştirmeler (sabit öğretmen-ders kilidi) */}
      <div className="card p-4 space-y-3">
        <div>
          <h4 className="font-600 text-sm" style={{fontWeight:600}}>Ön Eşleştirmeler</h4>
          <p className="text-xs text-gray-400">Seçtiğiniz dersler bu öğretmenlere kilitlenir; çözücü mutlaka uyar.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-end">
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">Sınıf</label>
            <select value={presetCls} onChange={e=>{setPresetCls(e.target.value); setPresetCourse(''); setPresetTeacher('');}}
              className="input !w-auto !py-1.5 text-xs">
              <option value="">Seç</option>
              {classes.map(c=><option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">Ders</label>
            <select value={presetCourse} disabled={!presetCls}
              onChange={e=>{setPresetCourse(e.target.value); setPresetTeacher('');}}
              className="input !w-auto !py-1.5 text-xs disabled:opacity-50">
              <option value="">Seç</option>
              {presetCls && coursesForClass(presetCls).map(c=><option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-400 block mb-1">Öğretmen</label>
            <select value={presetTeacher} disabled={!presetCourse}
              onChange={e=>setPresetTeacher(e.target.value)}
              className="input !w-auto !py-1.5 text-xs disabled:opacity-50">
              <option value="">Seç</option>
              {eligibleTeachersForPreset(presetCls, presetCourse).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <button onClick={addPreset} disabled={!presetTeacher||!presetCls||!presetCourse}
            className="btn-primary !px-3 !py-1.5 text-xs disabled:opacity-50">Ekle</button>
        </div>
        {presetCourse && eligibleTeachersForPreset(presetCls, presetCourse).length === 0 && (
          <p className="text-[11px] text-amber-600">Bu derse uygun öğretmen yok.</p>
        )}
        {presets.length > 0 && (
          <div className="space-y-1">
            {presets.map((p,i)=>(
              <div key={i} className="flex items-center justify-between text-xs bg-indigo-50 rounded-lg px-3 py-1.5">
                <span className="text-gray-700">
                  <b>{teacherById[p.teacherId]?.name || p.teacherId}</b> → {p.cls.toUpperCase()} → {p.course}
                </span>
                <button onClick={()=>removePreset(i)} className="text-gray-400 hover:text-red-500 px-1" title="Sil">✕</button>
              </div>
            ))}
          </div>
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
          result={result} classes={classes} teachers={teachers}
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
          result={result} teachers={teachers} classes={classes}
          onClose={()=>setPreview(null)}
        />
      )}
    </div>
  );
}

// ── Ders yükü tablosu: sütunlar dikey, satırlar dersler ──
function LoadTable({ load, setLoad, cols }) {
  const ORDER = ['Türkçe','Matematik','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji',
                 'Tarih','Coğrafya','Felsefe','Fen Bilgisi','Sosyal Bilgiler','İnkılap Tarihi','İngilizce'];
  const allCourses = ORDER.filter(d => cols.some(c => COL_COURSES[c.key]?.includes(d)));
  const set = (key, d, val) => setLoad(prev => ({...prev,[key]:{...(prev[key]||{}),[d]:Math.max(0,parseInt(val)||0)}}));
  const sumFor = key => (COL_COURSES[key]||[]).reduce((s,d)=>s+((load[key]?.[d])||0),0);

  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full" style={{borderCollapse:'collapse'}}>
        <thead>
          <tr>
            <th className="text-left p-2 text-gray-400 sticky left-0 bg-white min-w-[110px]" style={{fontWeight:600}}>Ders</th>
            {cols.map(c => (
              <th key={c.key} className="p-2 text-gray-600 text-center min-w-[64px]" style={{fontWeight:700}}>
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
              <td className="p-1.5 sticky left-0 bg-white" style={{fontWeight:600}}>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{background:COURSE_COLOR[d]}} />
                  {d}
                </span>
              </td>
              {cols.map(c => COL_COURSES[c.key]?.includes(d)
                ? (
                  <td key={c.key} className="text-center p-1">
                    <input type="number" min="0" value={(load[c.key]?.[d])||0}
                      onChange={e=>set(c.key,d,e.target.value)}
                      className="input !w-16 !py-1.5 text-center text-sm" />
                  </td>
                )
                : <td key={c.key} className="text-center text-gray-100 p-1">–</td>
              )}
            </tr>
          ))}
          <tr style={{background:'var(--bg-muted)'}} className="border-t-2 border-gray-200">
            <td className="p-2 sticky left-0 font-700" style={{background:'var(--bg-muted)',color:'var(--text-secondary)',fontWeight:700}}>Σ saat</td>
            {cols.map(c => {
              const s=sumFor(c.key);
              const cap = c.key.startsWith('Mezun') ? 24 : 200;
              return <td key={c.key} className="text-center p-2" style={{fontWeight:700,color:s>cap?'#dc2626':'var(--text-secondary)'}}>{s}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── Sonuç görünümü ──
function ResultView({ result, classes, teachers, maxWeekly, applying, conflictsChecked, onApply, onCheckConflicts, onPrintTeacher, onPrintClass }) {
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
              <li key={k}>• <b>{k}</b> ×{v.n} <span className="text-gray-400">({[...v.cls].map(c=>c.toUpperCase()).join(', ')})</span></li>
            ))}
          </ul>
        </details>
      )}

      {/* Öğretmen yük + PDF butonları */}
      <details className="rounded-xl border border-gray-100 p-3" open>
        <summary className="cursor-pointer text-indigo-600 text-xs" style={{fontWeight:700}}>Öğretmen yük dağılımı & PDF</summary>
        <div className="mt-2 grid md:grid-cols-2 gap-x-6 gap-y-1.5">
          {loadRows.map(r=>(
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 truncate text-gray-600">{r.name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="h-full rounded-full" style={{width:`${r.n/maxN*100}%`,background:r.n>maxWeekly?'#ef4444':COURSE_COLOR[r.branch]||'#6366f1'}}/>
              </div>
              <span className="w-7 text-right" style={{fontWeight:600,color:r.n>maxWeekly?'#dc2626':'#374151'}}>{r.n}</span>
              <button onClick={()=>onPrintTeacher(r.id)} className="ml-1 p-1 rounded hover:bg-indigo-50 text-gray-400 hover:text-indigo-600" title="PDF / Yazdır">
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
                <Download size={9}/> {cls.toUpperCase()}
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
                  {viewMode==='class'?String(rk).toUpperCase():viewMode==='room'?`D${rk} (${rk<=5?'1.k':rk<=8?'2.k':'3.k'})`:rk}
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
                        <b>{viewMode==='class'?shortCourse(a.course):a.cls.toUpperCase()}</b><br/>
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
function PrintPreview({ type, id, result, teachers, classes, onClose }) {
  const teacherById={}; teachers.forEach(t=>teacherById[t.id]=t);

  // Bir öğretmenin programını veya bir sınıfın programını oluştur
  const pages = useMemo(() => {
    if (type==='teacher') {
      return teachers.map(t => {
        const lessons = result.assigned.filter(a=>a.teacherId===t.id);
        return { title:`${t.name} — ${(t.branches||[]).join(', ')}`, lessons };
      });
    } else {
      return classes.map(cls => {
        const lessons = result.assigned.filter(a=>a.cls===cls);
        return { title:`${cls.toUpperCase()} Sınıfı Ders Programı`, lessons };
      });
    }
  }, [type, id, result, teachers, classes]);

  const filteredPages = id
    ? pages.filter(p => type==='teacher' ? teacherById[id] && p.title.startsWith(teacherById[id].name) : p.title.startsWith(id.toUpperCase()))
    : pages;

  return (
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
        <SchedulePage key={pi} title={pg.title} lessons={pg.lessons} />
      ))}
    </div>
  );
}

function SchedulePage({ title, lessons }) {
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
        <p style={{fontSize:11,color:'#9ca3af'}}>Çözüm Etüt Merkezi — Haftalık Ders Programı</p>
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
                      <div style={{fontSize:10,color:'#9ca3af'}}>{a.cls.toUpperCase()}</div>
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
