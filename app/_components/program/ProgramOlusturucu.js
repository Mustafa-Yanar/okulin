'use client';

import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, Users, Sparkles, AlertTriangle, Check } from 'lucide-react';
import {
  STUDENT_GROUPS, classToGroup, WEEKDAY_SLOT_IDS, WEEKEND_SLOT_IDS,
} from '@/lib/constants';

// ── Ders ↔ branş ↔ pencere ↔ derslik kuralları (prototipte doğrulandı) ──
const COURSE_BRANCH = {
  'Türkçe':'Türkçe','TYT Matematik':'Matematik','AYT Matematik':'Matematik','Geometri':'Matematik',
  'Matematik':'Matematik','Fizik':'Fizik','Kimya':'Kimya','Biyoloji':'Biyoloji',
  'Tarih':'Tarih','Coğrafya':'Coğrafya','Felsefe':'Felsefe',
  'Fen Bilgisi':'Fen Bilgisi','Sosyal Bilgiler':'Sosyal Bilgiler','İnkılap Tarihi':'Sosyal Bilgiler','İngilizce':'İngilizce',
};
const SUB_BRANCH_OF = { 'TYT Matematik':'TYT Matematik','AYT Matematik':'AYT Matematik','Geometri':'Geometri' };
const DAYS = ['Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi','Pazar'];
const SLOTS_PER_DAY = 12;
const MEZUN_DAYS = [0,1,2,3];
const MEZUN_SLOTS = [0,1,2,3,4,5];
const WEEKEND_DAYS = [5,6];
const FLOOR1 = [1,2,3,4,5], FLOOR2 = [6,7,8], FLOOR3 = [9,10,11,12];

const COURSE_COLOR = {
  'Türkçe':'#ec4899','TYT Matematik':'#6366f1','AYT Matematik':'#4f46e5','Geometri':'#818cf8','Matematik':'#6366f1',
  'Fizik':'#0ea5e9','Kimya':'#14b8a6','Biyoloji':'#22c55e','Tarih':'#f59e0b','Coğrafya':'#84cc16','Felsefe':'#a855f7',
  'Fen Bilgisi':'#06b6d4','Sosyal Bilgiler':'#f97316','İnkılap Tarihi':'#f97316','İngilizce':'#8b5cf6',
};
const BRANCH_COLOR = COURSE_COLOR;

function classType(cls) {
  if (cls.startsWith('m')) return parseInt(cls.slice(1)) <= 5 ? 'Sayısal' : 'Eşit Ağırlık';
  const g = Math.floor(parseInt(cls) / 100), sec = parseInt(cls.slice(1));
  if (g === 7 || g === 8) return 'Genel';
  if (g === 3) return sec <= 3 ? 'Sayısal' : 'Eşit Ağırlık';
  if (g === 4) return sec <= 5 ? 'Sayısal' : 'Eşit Ağırlık';
  return 'Lise Ortak';
}
function coursesForClass(cls) {
  const g = classToGroup(cls), t = classType(cls);
  if (g === 'ortaokul') {
    const sosyal = cls.startsWith('8') ? 'İnkılap Tarihi' : 'Sosyal Bilgiler';
    return ['Türkçe','Matematik','Fen Bilgisi',sosyal,'İngilizce'];
  }
  if (g === 'mezun') {
    if (t === 'Sayısal') return ['Türkçe','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji'];
    return ['Türkçe','TYT Matematik','AYT Matematik','Geometri','Tarih','Coğrafya','Felsefe'];
  }
  const is12 = cls.startsWith('4');
  const matCourses = is12 ? ['TYT Matematik','AYT Matematik','Geometri'] : ['Matematik'];
  if (t === 'Sayısal') return ['Türkçe',...matCourses,'Fizik','Kimya','Biyoloji'];
  if (t === 'Eşit Ağırlık') return ['Türkçe',...matCourses,'Tarih','Coğrafya','Felsefe'];
  return ['Türkçe','Matematik','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe'];
}
function loadKey(cls) {
  const g = classToGroup(cls), t = classType(cls);
  if (g === 'ortaokul') return 'Ortaokul';
  if (g === 'mezun') return 'Mezun ' + t;
  if (t === 'Lise Ortak') return 'Lise Ortak';
  return 'Lise ' + t;
}

const DEFAULT_LOAD = {
  'Mezun Sayısal':      {'Türkçe':2,'TYT Matematik':4,'AYT Matematik':4,'Geometri':2,'Fizik':4,'Kimya':4,'Biyoloji':4},
  'Mezun Eşit Ağırlık': {'Türkçe':4,'TYT Matematik':4,'AYT Matematik':4,'Geometri':2,'Tarih':4,'Coğrafya':4,'Felsefe':2},
  'Ortaokul':           {'Türkçe':4,'Matematik':4,'Fen Bilgisi':4,'Sosyal Bilgiler':4,'İnkılap Tarihi':4,'İngilizce':4},
  'Lise Sayısal':       {'Türkçe':0,'Matematik':0,'TYT Matematik':0,'AYT Matematik':0,'Geometri':0,'Fizik':0,'Kimya':0,'Biyoloji':0},
  'Lise Eşit Ağırlık':  {'Türkçe':0,'Matematik':0,'TYT Matematik':0,'AYT Matematik':0,'Geometri':0,'Tarih':0,'Coğrafya':0,'Felsefe':0},
  'Lise Ortak':         {'Türkçe':0,'Matematik':0,'Fizik':0,'Kimya':0,'Biyoloji':0,'Tarih':0,'Coğrafya':0,'Felsefe':0},
};

// Tüm kayıtlı sınıflar (constants STUDENT_GROUPS) — gerçekte hangi şubeler açık olursa
const ALL_CLASSES = [
  ...STUDENT_GROUPS.ortaokul.classes,
  ...STUDENT_GROUPS.lise.classes,
  ...STUDENT_GROUPS.mezun.classes,
];

function teacherTeaches(t, branch) {
  return t.branch === branch || (t.extraBranches || []).includes(branch);
}
function classSlotPairs(cls) {
  const g = classToGroup(cls), pairs = [];
  if (g === 'mezun') { MEZUN_DAYS.forEach(d => MEZUN_SLOTS.forEach(s => pairs.push([d,s]))); return pairs; }
  [...WEEKEND_DAYS,0,1,2,3,4].forEach(d => { for (let s=0;s<SLOTS_PER_DAY;s++) pairs.push([d,s]); });
  return pairs;
}
function shortCourse(c) {
  return ({'TYT Matematik':'TYT','AYT Matematik':'AYT','Geometri':'Geo','Matematik':'Mat','Fen Bilgisi':'Fen','Sosyal Bilgiler':'Sos','İnkılap Tarihi':'İnk'})[c] || c.slice(0,5);
}
// gün+slot → sistem slot id (w1..w12 / e1..e12)
function slotIdFor(day, slotIdx) {
  return day >= 5 ? WEEKEND_SLOT_IDS[slotIdx] : WEEKDAY_SLOT_IDS[slotIdx];
}

export default function ProgramOlusturucu({ api, showToast, activeClasses }) {
  const [teachers, setTeachers] = useState(null);
  const [load, setLoad] = useState(() => JSON.parse(JSON.stringify(DEFAULT_LOAD)));
  const [result, setResult] = useState(null);
  const [viewMode, setViewMode] = useState('class');
  const [viewDay, setViewDay] = useState('all');
  const [maxWeekly, setMaxWeekly] = useState(40);
  const [applying, setApplying] = useState(false);

  // Hangi sınıflar gerçekte aktif: öğrencisi olan sınıflar (prop) ya da hepsi
  const classes = useMemo(() => {
    const base = (activeClasses && activeClasses.length) ? activeClasses : ALL_CLASSES;
    return base.filter(c => ALL_CLASSES.includes(c)).sort();
  }, [activeClasses]);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/teachers');
        // Ali DOĞAN (Tarih) → ortaokul Sosyal Bilgiler/İnkılap da verebilir
        const withExtra = data.map(t => t.branch === 'Tarih'
          ? { ...t, extraBranches: ['Sosyal Bilgiler'] } : t);
        setTeachers(withExtra);
      } catch (e) { showToast?.(e.message, 'error'); setTeachers([]); }
    })();
  }, [api, showToast]);

  const activeLoadKeys = useMemo(() => [...new Set(classes.map(loadKey))], [classes]);
  const coursesForKey = (key) => {
    const set = new Set();
    classes.filter(c => loadKey(c) === key).forEach(c => coursesForClass(c).forEach(d => set.add(d)));
    return [...set];
  };

  function classRoomMap() {
    const map = {}; const used1 = [], used2 = [], used3 = [];
    const mark = r => { if (FLOOR1.includes(r)) used1.push(r); else if (FLOOR2.includes(r)) used2.push(r); else used3.push(r); };
    const nextFree = (floor, usedArr) => { for (const r of floor) if (!usedArr.includes(r)) { usedArr.push(r); mark(r); return r; } return floor[0]; };
    classes.forEach(cls => {
      const g = classToGroup(cls);
      if (g === 'ortaokul') map[cls] = nextFree(FLOOR3, used3);
      else if (g === 'mezun') {
        if (['m1','m2','m3','m6','m7'].includes(cls)) map[cls] = nextFree(FLOOR1, used1);
        else if (['m4','m8','m9'].includes(cls)) map[cls] = nextFree(FLOOR2, used2);
        else map[cls] = nextFree([...FLOOR1,...FLOOR2], [...used1,...used2]);
      }
    });
    classes.filter(c => classToGroup(c) === 'lise')
      .sort((a,b) => parseInt(b[0]) - parseInt(a[0]) || a.localeCompare(b))
      .forEach(cls => { map[cls] = nextFree([...FLOOR1,...FLOOR2,...FLOOR3], [...used1,...used2,...used3]); });
    return map;
  }

  // ── min-conflicts çözücü ──
  function generate() {
    if (!teachers) return;
    const t0 = performance.now();
    const vars = []; const unplaced = [];
    for (const cls of classes) {
      const key = loadKey(cls), grp = classToGroup(cls);
      for (const course of coursesForClass(cls)) {
        const hours = (load[key] && load[key][course]) || 0; if (hours <= 0) continue;
        const branch = COURSE_BRANCH[course];
        const eligible = teachers.filter(tt => teacherTeaches(tt, branch) && (tt.allowedGroups || []).includes(grp)).map(e => e.id);
        if (eligible.length === 0) { for (let h=0;h<hours;h++) unplaced.push({cls,course,reason:'uygun öğretmen yok'}); continue; }
        for (let h=0;h<hours;h++) vars.push({ cls, course, branch, grp, eligibleIds: eligible });
      }
    }
    const roomOf = classRoomMap();
    const pairsOf = {}; classes.forEach(c => pairsOf[c] = classSlotPairs(c));
    const byClass = {}; classes.forEach(c => byClass[c] = []);
    vars.forEach((v,i) => byClass[v.cls].push(i));
    const teacherById = {}; teachers.forEach(t => teacherById[t.id] = t);
    const rnd = arr => arr[(Math.random()*arr.length)|0];

    for (const c of classes) if (byClass[c].length > pairsOf[c].length) {
      const fazla = byClass[c].length - pairsOf[c].length;
      for (let k=0;k<fazla;k++) unplaced.push({ cls:c, course:'(çeşitli)', reason:'sınıf penceresine sığmıyor' });
    }

    function attempt(maxSteps) {
      classes.forEach(c => {
        const slots = [...pairsOf[c]].sort(() => Math.random()-0.5);
        byClass[c].forEach((vi,k) => { const p = slots[k % slots.length]; vars[vi].day=p[0]; vars[vi].slot=p[1]; vars[vi].room=roomOf[c]; });
      });
      vars.forEach(v => v.tid = rnd(v.eligibleIds));
      const tkey = v => v.tid+'|'+v.day+'|'+v.slot;
      const conflicts = () => {
        let n=0; const m=new Map();
        vars.forEach(v => { const k=tkey(v); m.set(k,(m.get(k)||0)+1); });
        m.forEach(c => { if (c>1) n+=c-1; });
        vars.forEach(v => { if ((teacherById[v.tid].offDays||[]).includes(v.day)) n++; });
        return n;
      };
      const badVars = () => {
        const m=new Map();
        vars.forEach((v,i) => { const k=tkey(v); if(!m.has(k))m.set(k,[]); m.get(k).push(i); });
        const bad=[]; m.forEach(a => { if (a.length>1) bad.push(...a); });
        vars.forEach((v,i) => { if ((teacherById[v.tid].offDays||[]).includes(v.day)) bad.push(i); });
        return [...new Set(bad)];
      };
      let cur = conflicts();
      for (let step=0; step<maxSteps && cur>0; step++) {
        const bad = badVars(); if (!bad.length) break;
        const v = vars[rnd(bad)];
        let bestTid=v.tid, bestDelta=0;
        for (const tid of v.eligibleIds) { const o=v.tid; v.tid=tid; const c=conflicts(); if (c-cur<bestDelta){bestDelta=c-cur;bestTid=tid;} v.tid=o; }
        v.tid = bestTid;
        const mates = byClass[v.cls]; const wj = rnd(mates);
        const c0 = conflicts();
        const td=vars[wj].day, ts=vars[wj].slot; vars[wj].day=v.day; vars[wj].slot=v.slot; v.day=td; v.slot=ts;
        if (conflicts() > c0) { const dd=v.day,ss=v.slot; v.day=vars[wj].day; v.slot=vars[wj].slot; vars[wj].day=dd; vars[wj].slot=ss; }
        cur = conflicts();
      }
      return cur;
    }
    let best = Infinity;
    for (let r=0; r<80 && best>0 && performance.now()-t0<6000; r++) { const c = attempt(4000); if (c<best) best=c; }

    const assigned = []; const tLoad = {}; teachers.forEach(t => tLoad[t.id]=0);
    if (best > 0) {
      const seen = new Set();
      vars.forEach(v => {
        const k = v.tid+'|'+v.day+'|'+v.slot;
        const offBad = (teacherById[v.tid].offDays||[]).includes(v.day);
        if (seen.has(k) || offBad) unplaced.push({ cls:v.cls, course:v.course, reason: offBad?'öğretmen izinli':'öğretmen çakışması' });
        else { seen.add(k); assigned.push({ cls:v.cls, course:v.course, teacherId:v.tid, teacherName:teacherById[v.tid].name, day:v.day, slot:v.slot, room:v.room }); tLoad[v.tid]++; }
      });
    } else {
      vars.forEach(v => { assigned.push({ cls:v.cls, course:v.course, teacherId:v.tid, teacherName:teacherById[v.tid].name, day:v.day, slot:v.slot, room:v.room }); tLoad[v.tid]++; });
    }
    setResult({ assigned, unplaced, tLoad, total: assigned.length, ms: Math.round(performance.now()-t0) });
    setViewDay('all');
    showToast?.(`${assigned.length} ders yerleşti${unplaced.length?`, ${unplaced.length} açıkta`:''}`, unplaced.length?'info':'success');
  }

  // ── Uygula: sonucu program:{teacherId} şablonlarına yaz ──
  async function applyToTemplates(weekKey) {
    if (!result || !result.assigned.length) return;
    setApplying(true);
    try {
      // öğretmen → { [dayIndex]: { [slotId]: {type:'ders', cls, subBranch?, fixed:true} } }
      const byTeacher = {};
      for (const a of result.assigned) {
        const sid = slotIdFor(a.day, a.slot);
        if (!sid) continue;
        (byTeacher[a.teacherId] = byTeacher[a.teacherId] || {});
        (byTeacher[a.teacherId][a.day] = byTeacher[a.teacherId][a.day] || {});
        const entry = { type:'ders', cls:a.cls, fixed:true };
        if (SUB_BRANCH_OF[a.course]) entry.subBranch = SUB_BRANCH_OF[a.course];
        byTeacher[a.teacherId][a.day][sid] = entry;
      }
      let ok = 0;
      for (const [teacherId, program] of Object.entries(byTeacher)) {
        await api('/api/program', { method:'POST', body: JSON.stringify({ teacherId, weekKey, program }) });
        ok++;
      }
      showToast?.(`${ok} öğretmenin programı şablona uygulandı`, 'success');
    } catch (e) {
      showToast?.(e.message, 'error');
    } finally { setApplying(false); }
  }

  if (!teachers) return <div className="flex items-center justify-center h-48 text-gray-400">Yükleniyor...</div>;

  // özet
  const demandByBranch = {}; let totalDemand = 0;
  classes.forEach(cls => { const key = loadKey(cls); coursesForClass(cls).forEach(course => { const h=(load[key]&&load[key][course])||0; if(h){ const b=COURSE_BRANCH[course]; demandByBranch[b]=(demandByBranch[b]||0)+h; totalDemand+=h; } }); });
  const capByBranch = {}; teachers.forEach(t => { capByBranch[t.branch]=(capByBranch[t.branch]||0)+1; (t.extraBranches||[]).forEach(b=>capByBranch[b]=(capByBranch[b]||0)+1); });
  const risky = Object.keys(demandByBranch).filter(b => demandByBranch[b]>0 && (!capByBranch[b] || demandByBranch[b]/capByBranch[b]>maxWeekly));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-700 text-lg flex items-center gap-2" style={{ fontWeight:700 }}>
          <LayoutGrid size={18} className="text-indigo-500" /> Otomatik Ders Programı
        </h3>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 flex items-center gap-1">Haftalık maks
            <input type="number" value={maxWeekly} onChange={e=>setMaxWeekly(parseInt(e.target.value)||40)} className="input !w-16 !py-1.5 text-center" /></label>
          <button onClick={generate} className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm">
            <Sparkles size={14} /> Oluştur
          </button>
        </div>
      </div>

      {/* özet */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { l:'Toplam ders talebi', v:totalDemand+' saat', c:'#6366f1' },
          { l:'Kadro kapasitesi', v:(teachers.length*maxWeekly)+' saat', c: totalDemand>teachers.length*maxWeekly?'#dc2626':'#16a34a' },
          { l:'Sınıf sayısı', v:classes.length, c:'#0ea5e9' },
          { l:'Riskli branş', v:risky.length, c: risky.length?'#d97706':'#16a34a' },
        ].map((k,i)=>(
          <div key={i} className="card p-3.5">
            <div className="text-[11px] text-gray-400 uppercase tracking-wide">{k.l}</div>
            <div className="text-xl mt-0.5" style={{ fontWeight:800, color:k.c }}>{k.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* ders yükü */}
        <div className="col-span-12 lg:col-span-7 card p-4">
          <h4 className="font-600 text-sm mb-1" style={{ fontWeight:600 }}>Haftalık Ders Yükü</h4>
          <p className="text-xs text-gray-400 mb-3">Sınıf türü × ders — saat/hafta. Düzenlenebilir.</p>
          <div className="overflow-auto">
            <LoadTable load={load} setLoad={setLoad} keys={activeLoadKeys} coursesForKey={coursesForKey} />
          </div>
        </div>
        {/* öğretmen listesi (salt okunur özet) */}
        <div className="col-span-12 lg:col-span-5 card p-4">
          <h4 className="font-600 text-sm mb-3 flex items-center gap-1.5" style={{ fontWeight:600 }}><Users size={14} /> Öğretmenler ({teachers.length})</h4>
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {teachers.map(t => (
              <div key={t.id} className="flex items-center justify-between text-xs rounded-lg px-2 py-1.5" style={{ background:'#fafbfd' }}>
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background:BRANCH_COLOR[t.branch]||'#9ca3af' }} />{t.name}</span>
                <span className="text-gray-400">{t.branch}{t.extraBranches?.length?` +${t.extraBranches.length}`:''}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">Öğretmen ekleme/branş/izin günü <b>Öğretmenler</b> sekmesinden yapılır.</p>
        </div>
      </div>

      {result && <ResultView result={result} classes={classes} teachers={teachers}
        viewMode={viewMode} setViewMode={setViewMode} viewDay={viewDay} setViewDay={setViewDay}
        maxWeekly={maxWeekly} applying={applying} onApply={applyToTemplates} />}
    </div>
  );
}

// ── Ders yükü tablosu ──
function LoadTable({ load, setLoad, keys, coursesForKey }) {
  const ORDER = ['Türkçe','Matematik','TYT Matematik','AYT Matematik','Geometri','Fizik','Kimya','Biyoloji','Tarih','Coğrafya','Felsefe','Fen Bilgisi','Sosyal Bilgiler','İnkılap Tarihi','İngilizce'];
  const allCourses = ORDER.filter(d => keys.some(k => coursesForKey(k).includes(d)));
  const sumFor = k => coursesForKey(k).reduce((s,d)=>s+((load[k]&&load[k][d])||0),0);
  const set = (k,d,val) => setLoad(prev => ({ ...prev, [k]: { ...(prev[k]||{}), [d]: Math.max(0, parseInt(val)||0) } }));
  return (
    <table className="text-xs w-full">
      <thead><tr>
        <th className="text-left p-2 text-gray-400 sticky left-0 bg-white" style={{ fontWeight:600 }}>Ders \ Grup</th>
        {keys.map(k => <th key={k} className="p-2 text-gray-600 text-center whitespace-nowrap" style={{ fontWeight:700 }}>{k}</th>)}
      </tr></thead>
      <tbody>
        {allCourses.map(d => (
          <tr key={d}>
            <td className="p-1.5 sticky left-0 bg-white" style={{ fontWeight:600 }}>
              <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background:COURSE_COLOR[d] }} />{d}</span>
            </td>
            {keys.map(k => coursesForKey(k).includes(d)
              ? <td key={k} className="text-center p-1"><input type="number" min="0" value={(load[k]&&load[k][d])||0}
                  onChange={e=>set(k,d,e.target.value)} className="input !w-12 !py-1 text-center" /></td>
              : <td key={k} className="text-center text-gray-200">–</td>)}
          </tr>
        ))}
        <tr style={{ background:'#f5f6fb' }}>
          <td className="p-2 text-gray-500 sticky left-0" style={{ fontWeight:700, background:'#f5f6fb' }}>Σ saat</td>
          {keys.map(k => { const s=sumFor(k); const cap=k.startsWith('Mezun')?24:96;
            return <td key={k} className="text-center" style={{ fontWeight:700, color: s>cap?'#dc2626':'#4b5563' }}>{s}</td>; })}
        </tr>
      </tbody>
    </table>
  );
}

// ── Sonuç görünümü ──
function ResultView({ result, classes, teachers, viewMode, setViewMode, viewDay, setViewDay, maxWeekly, applying, onApply }) {
  const usedDays = [...new Set(result.assigned.map(a => a.day))].sort();
  const days = viewDay === 'all' ? usedDays : [parseInt(viewDay)];

  const teacherById = {}; teachers.forEach(t => teacherById[t.id]=t);
  const loadRows = teachers.map(t => ({ name:t.name, n:result.tLoad[t.id]||0, branch:t.branch })).sort((a,b)=>b.n-a.n);
  const maxN = Math.max(1, ...loadRows.map(r=>r.n));

  const unplacedGrouped = {};
  result.unplaced.forEach(u => { const k=`${u.course} — ${u.reason}`; (unplacedGrouped[k]=unplacedGrouped[k]||{cls:new Set(),n:0}).n++; unplacedGrouped[k].cls.add(u.cls); });

  let rowKeys;
  if (viewMode === 'class') rowKeys = classes;
  else if (viewMode === 'teacher') rowKeys = teachers.map(t=>t.name);
  else rowKeys = [...Array(12).keys()].map(i => i+1);

  const find = (rk, d, i) => result.assigned.find(a => a.day===d && a.slot===i &&
    (viewMode==='class' ? a.cls===rk : viewMode==='teacher' ? a.teacherName===rk : a.room===rk));

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex flex-wrap gap-2">
          <span className="badge bg-emerald-100 text-emerald-700" style={{ padding:'6px 12px', fontSize:12 }}>✓ Yerleşen: {result.total}</span>
          <span className={`badge ${result.unplaced.length?'bg-red-100 text-red-700':'bg-gray-100 text-gray-500'}`} style={{ padding:'6px 12px', fontSize:12 }}>
            {result.unplaced.length?'⚠':'✓'} Yerleşemeyen: {result.unplaced.length}</span>
          <span className="badge bg-gray-100 text-gray-500" style={{ padding:'6px 12px', fontSize:12 }}>{result.ms}ms</span>
        </div>
        <div className="flex gap-2 items-center text-xs">
          <select value={viewMode} onChange={e=>setViewMode(e.target.value)} className="input !w-auto !py-1.5">
            <option value="class">Sınıf bazlı</option><option value="teacher">Öğretmen bazlı</option><option value="room">Derslik bazlı</option>
          </select>
          <select value={viewDay} onChange={e=>setViewDay(e.target.value)} className="input !w-auto !py-1.5">
            <option value="all">Tüm günler</option>
            {usedDays.map(d => <option key={d} value={d}>{DAYS[d]}</option>)}
          </select>
          <button onClick={() => onApply(currentWeekKey())} disabled={applying || result.unplaced.length>0}
            className="btn-success !px-3 !py-1.5 flex items-center gap-1.5 disabled:opacity-50" title={result.unplaced.length?'Önce tüm dersler yerleşmeli':''}>
            {applying ? 'Uygulanıyor...' : <><Check size={13} /> Bu Haftaya Uygula</>}
          </button>
        </div>
      </div>

      {result.unplaced.length > 0 && (
        <details className="mb-3 rounded-xl border border-red-100 p-3 text-xs" style={{ background:'#fef2f2aa' }}>
          <summary className="cursor-pointer text-red-600 flex items-center gap-1.5" style={{ fontWeight:700 }}><AlertTriangle size={13} /> Yerleşemeyen dersler ({result.unplaced.length})</summary>
          <ul className="mt-2 space-y-1 text-gray-600">
            {Object.entries(unplacedGrouped).map(([k,v]) => <li key={k}>• <b>{k}</b> ×{v.n} <span className="text-gray-400">({[...v.cls].map(c=>c.toUpperCase()).join(', ')})</span></li>)}
          </ul>
        </details>
      )}

      <details className="mb-3 rounded-xl border border-gray-100 p-3" open>
        <summary className="cursor-pointer text-indigo-600 text-xs" style={{ fontWeight:700 }}>Öğretmen yük dağılımı</summary>
        <div className="mt-2 grid md:grid-cols-2 gap-x-6 gap-y-1">
          {loadRows.map(r => (
            <div key={r.name} className="flex items-center gap-2 text-[11px]">
              <span className="w-28 truncate text-gray-600">{r.name}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width:`${r.n/maxN*100}%`, background: r.n>maxWeekly?'#ef4444':BRANCH_COLOR[r.branch]||'#6366f1' }} />
              </div>
              <span className="w-8 text-right" style={{ fontWeight:600, color:r.n>maxWeekly?'#dc2626':'#374151' }}>{r.n}</span>
            </div>
          ))}
        </div>
      </details>

      <div className="overflow-x-auto">
        <table className="text-[11px]" style={{ borderCollapse:'collapse' }}>
          <thead><tr>
            <th className="p-2 sticky left-0 z-10" style={{ background:'#f5f6fb', border:'1px solid #eef0f5' }}>
              {viewMode==='class'?'Sınıf':viewMode==='teacher'?'Öğretmen':'Derslik'}</th>
            {days.map(d => [...Array(SLOTS_PER_DAY).keys()].map(i => (
              <th key={d+'-'+i} className="p-1 text-gray-400" style={{ minWidth:74, border:'1px solid #eef0f5', background:'#f5f6fb', fontWeight:500 }}>
                {DAYS[d].slice(0,3)}<br /><span className="text-gray-300">{i+1}</span></th>
            )))}
          </tr></thead>
          <tbody>
            {rowKeys.map(rk => (
              <tr key={rk}>
                <td className="p-2 sticky left-0 z-10 whitespace-nowrap" style={{ background:'#fff', fontWeight:700, border:'1px solid #eef0f5' }}>
                  {viewMode==='class' ? String(rk).toUpperCase() : viewMode==='room' ? `D${rk} (${rk<=5?'1.k':rk<=8?'2.k':'3.k'})` : rk}
                </td>
                {days.map(d => [...Array(SLOTS_PER_DAY).keys()].map(i => {
                  const a = find(rk, d, i);
                  if (!a) return <td key={d+'-'+i} style={{ minWidth:74, border:'1px solid #eef0f5' }} />;
                  const c = COURSE_COLOR[a.course] || '#6366f1';
                  return (
                    <td key={d+'-'+i} className="p-1 text-center" style={{ minWidth:74, border:`1px solid ${c}30`, background:`${c}14`, color:c }}>
                      <b>{viewMode==='class'?shortCourse(a.course):a.cls.toUpperCase()}</b><br />
                      <span style={{ opacity:.6 }}>{viewMode==='class'?a.teacherName.split(' ')[0]:shortCourse(a.course)}</span>
                    </td>
                  );
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Mevcut ISO hafta anahtarı (lib/slots getWeekKey ile aynı mantık)
function currentWeekKey() {
  const d = new Date(); d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2,'0')}`;
}
