'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Download, Pencil } from 'lucide-react';
import type { TeacherDTO } from '../types';
import type { SolveResult, Windows, TeacherSlots, Block, Assigned } from './program-types';
import { DAYS, COURSE_COLOR, entryKeyOf, teacherGroups, shortCourse } from './program-logic';

interface ResultViewProps {
  result: SolveResult;
  classes: string[];
  teachers: TeacherDTO[];
  labelOf: (cls: string) => string;
  maxWeekly: number;
  applying: boolean;
  conflictsChecked: boolean;
  onApply: () => void;
  onCheckConflicts: () => void;
  onPrintTeacher: (id: string) => void;
  onPrintClass: (cls: string) => void;
  windowsOf?: (cls: string) => Windows;
  teacherSlots?: TeacherSlots | null;
  groupOf?: (cls: string) => string | null;
  onEdit?: (patch: Partial<Pick<SolveResult, 'assigned' | 'unplaced' | 'tLoad'>>) => void;
}

// ── Sonuç görünümü ──
export default function ResultView({ result, classes, teachers, labelOf, maxWeekly, applying, conflictsChecked, onApply, onCheckConflicts, onPrintTeacher, onPrintClass, windowsOf, teacherSlots, groupOf, onEdit }: ResultViewProps) {
  const [viewMode, setViewMode] = useState('class');
  const [viewDay, setViewDay]   = useState('all');
  const [editMode, setEditMode] = useState(false); // manuel blok taşıma (sınıf görünümünde)
  const [sel, setSel]           = useState<string | null>(null);  // seçili blok id
  const [selUnplaced, setSelUnplaced] = useState<{ idx: number; teacherId: string | null } | null>(null); // açıkta parça seçimi

  const teacherById = useMemo(() => {
    const m: Record<string, TeacherDTO> = {}; teachers.forEach(t => { m[t.id] = t; }); return m;
  }, [teachers]);

  // Sonuç değişince (yeni Oluştur / manuel düzenleme) seçimler bayatlar — temizle.
  // Blok id'leri konum-türevli olduğundan eski seçim yeni sonuçta yanlış bloğa,
  // eski unplaced index'i yanlış parçaya işaret edebilir.
  useEffect(() => { setSel(null); setSelUnplaced(null); }, [result]);

  // ── Manuel düzenleme: assigned → bloklar (aynı gün+sınıf+ders+öğretmen ardışık koşusu) ──
  const { blocks, blockOfEntry } = useMemo(() => {
    const groupsMap = new Map<string, Assigned[]>();
    for (const a of result.assigned) {
      const k = `${a.day}|${a.cls}|${a.course}|${a.teacherId}`;
      if (!groupsMap.has(k)) groupsMap.set(k, []);
      groupsMap.get(k)!.push(a);
    }
    const blocks: Block[] = [], blockOfEntry = new Map<string, string>();
    for (const arr of groupsMap.values()) {
      arr.sort((x, y) => x.slot - y.slot);
      let run = [arr[0]];
      const flush = () => {
        const b: Block = {
          id: `${run[0].day}-${run[0].slot}-${run[0].cls}-${run[0].course}`,
          day: run[0].day, start: run[0].slot, len: run.length,
          cls: run[0].cls, course: run[0].course, teacherId: run[0].teacherId,
        };
        blocks.push(b);
        run.forEach(a => blockOfEntry.set(entryKeyOf(a), b.id));
      };
      for (let i = 1; i < arr.length; i++) {
        if (arr[i].slot === run[run.length - 1].slot + 1) run.push(arr[i]);
        else { flush(); run = [arr[i]]; }
      }
      flush();
    }
    return { blocks, blockOfEntry };
  }, [result.assigned]);

  // Blok (day,start)'a taşınabilir mi? Solver'ın SERT kurallarının birebir kopyası:
  // sınıf penceresi + öğretmen available + K3 (aynı sınıf-ders aynı güne tek blok) +
  // K5 (sınıf çakışması) + K4 (öğretmen çakışması). Hizalama (çift-ofset) solver'ın
  // paketleme tekniğidir, iş kuralı değildir — manuelde dayatılmaz. ignoreIds:
  // taşınan/takas edilen blokların mevcut yerleri yok sayılır.
  const canPlace = useCallback((b: Block, day: number, start: number, ignoreIds: Set<string>) => {
    // K6: izin günü — available işareti kalmış olsa bile izin günü kesin yasak
    // (solver da offDays'i availability'den AYRI, hard denetler).
    if (new Set(teacherById[b.teacherId]?.offDays || []).has(day)) return false;
    const win = windowsOf ? windowsOf(b.cls) : null;
    const winSet = new Set(win?.[day] || []);
    const av = new Set((teacherSlots?.[b.teacherId] || []).filter(([d]) => d === day).map(([, s]) => s));
    for (let i = 0; i < b.len; i++) {
      if (!winSet.has(start + i) || !av.has(start + i)) return false;
    }
    const end = start + b.len - 1;
    for (const a of result.assigned) {
      if (ignoreIds.has(blockOfEntry.get(entryKeyOf(a)) as string)) continue;
      if (a.day !== day) continue;
      if (a.cls === b.cls && a.course === b.course) return false; // K3
      if (a.slot < start || a.slot > end) continue;
      if (a.cls === b.cls) return false;                          // K5
      if (a.teacherId === b.teacherId) return false;              // K4
    }
    return true;
  }, [windowsOf, teacherSlots, teacherById, result.assigned, blockOfEntry]);

  const selBlock = sel ? blocks.find(b => b.id === sel) : null;

  // ── Açıkta kalan parça yerleştirme meta'sı ──
  // - fixedTeacherId: aynı sınıf-dersin yerleşmiş bloğu varsa öğretmen SABİT
  //   (solver'ın tek-öğretmen kuralı: bir sınıf-dersi tek öğretmen verir)
  // - eligibleIds: solver'ın eligible_teachers kuralının birebir kopyası (branş + grup)
  // - presetTeacherId: kurumun ön eşleştirmesi — varsayılan seçim, değiştirilebilir
  const unplacedMeta = useMemo(() => (result.unplaced || []).map(u => {
    const sibling = blocks.find(b => b.cls === u.cls && b.course === u.course);
    const grp = groupOf ? groupOf(u.cls) : null;
    const eligible = teachers.filter(t =>
      (t.branches || []).includes(u.course) && teacherGroups(t).includes(grp as string));
    const preset = eligible.find(t =>
      (t.presets || []).some(p => p.cls === u.cls && p.course === u.course));
    return {
      hours: u.hours || 2, // eski solver yanıtı emniyeti; yeni solver hours gönderir
      fixedTeacherId: sibling ? sibling.teacherId : null,
      eligibleIds: eligible.map(t => t.id),
      presetTeacherId: preset?.id || null,
    };
  }), [result.unplaced, blocks, teachers, groupOf]);

  const upSel  = selUnplaced ? result.unplaced[selUnplaced.idx] : null;
  const upMeta = selUnplaced ? unplacedMeta[selUnplaced.idx] : null;
  // Öğretmen çözünürlüğü: sabit (sibling) > kullanıcının seçtiği > tek aday > ön eşleştirme
  const upTeacherId = upMeta
    ? (upMeta.fixedTeacherId
        || selUnplaced?.teacherId
        || (upMeta.eligibleIds.length === 1 ? upMeta.eligibleIds[0] : null)
        || upMeta.presetTeacherId)
    : null;

  // Aktif parça: taşınan mevcut blok VEYA yerleştirilen açıkta parça (sanal blok).
  // Sanal blokta day/start -1 → "kendi konumunu atla" koşulu hiç tetiklenmez,
  // ignore kümesi gridde hiçbir girdiyle eşleşmez (yerleşik değil).
  const activePiece = useMemo<Block | null>(() => {
    if (selBlock) return selBlock;
    if (!upSel || !upMeta || !upTeacherId) return null;
    return { id: '__unplaced__', day: -1, start: -1, len: upMeta.hours,
             cls: upSel.cls, course: upSel.course, teacherId: upTeacherId };
  }, [selBlock, upSel, upMeta, upTeacherId]);

  // Aktif parçanın gidebileceği boş başlangıçlar ("gün:slot")
  const validTargets = useMemo(() => {
    if (!activePiece) return new Set<string>();
    const out = new Set<string>();
    const ig = new Set([activePiece.id]);
    const win = windowsOf ? windowsOf(activePiece.cls) : {};
    for (const [dStr, slots] of Object.entries(win || {})) {
      const d = parseInt(dStr);
      for (const s of slots) {
        if (d === activePiece.day && s === activePiece.start) continue;
        if (canPlace(activePiece, d, s, ig)) out.add(`${d}:${s}`);
      }
    }
    return out;
  }, [activePiece, canPlace, windowsOf]);

  // Takas: aynı sınıfın başka bloğuyla yer değiştirme — iki yön de kurallara uyuyorsa.
  const swapTargets = useMemo(() => {
    if (!selBlock) return new Set<string>();
    const out = new Set<string>();
    for (const b2 of blocks) {
      if (b2.id === selBlock.id || b2.cls !== selBlock.cls) continue;
      const ig = new Set([selBlock.id, b2.id]);
      if (canPlace(selBlock, b2.day, b2.start, ig) && canPlace(b2, selBlock.day, selBlock.start, ig)) out.add(b2.id);
    }
    return out;
  }, [selBlock, blocks, canPlace]);

  function moveSel(day: number, start: number) {
    if (!selBlock) return;
    const next = result.assigned.map(a =>
      blockOfEntry.get(entryKeyOf(a)) !== selBlock.id ? a
        : { ...a, day, slot: start + (a.slot - selBlock.start) });
    onEdit?.({ assigned: next });
    setSel(null);
  }
  function swapSel(b2: Block) {
    if (!selBlock) return;
    const next = result.assigned.map(a => {
      const bid = blockOfEntry.get(entryKeyOf(a));
      if (bid === selBlock.id) return { ...a, day: b2.day, slot: b2.start + (a.slot - selBlock.start) };
      if (bid === b2.id)       return { ...a, day: selBlock.day, slot: selBlock.start + (a.slot - b2.start) };
      return a;
    });
    onEdit?.({ assigned: next });
    setSel(null);
  }
  // Açıkta parçayı gride yerleştir: L saat satırı ekle, unplaced'dan düş, tLoad güncelle.
  function placeSel(day: number, start: number) {
    if (!selUnplaced || !upSel || !upMeta || !upTeacherId) return;
    const tname = teacherById[upTeacherId]?.name || '';
    const added: Assigned[] = [];
    for (let i = 0; i < upMeta.hours; i++) {
      added.push({ cls: upSel.cls, course: upSel.course, teacherId: upTeacherId,
                   teacherName: tname, day, slot: start + i });
    }
    onEdit?.({
      assigned: [...result.assigned, ...added],
      unplaced: result.unplaced.filter((_, i) => i !== selUnplaced.idx),
      tLoad: { ...result.tLoad, [upTeacherId]: (result.tLoad[upTeacherId] || 0) + upMeta.hours },
    });
    setSelUnplaced(null);
  }
  // Seçili bloğu açığa al: gridden çıkar, unplaced'a ekle, tLoad düş. Yer açmak ya da
  // dersi elle başka öğretmene/başka düzene taşımak için ara adım.
  function unassignSel() {
    if (!selBlock) return;
    onEdit?.({
      assigned: result.assigned.filter(a => blockOfEntry.get(entryKeyOf(a)) !== selBlock.id),
      unplaced: [...result.unplaced, { cls: selBlock.cls, course: selBlock.course,
        hours: selBlock.len, reason: 'elle açığa alındı' }],
      tLoad: { ...result.tLoad,
        [selBlock.teacherId]: Math.max(0, (result.tLoad[selBlock.teacherId] || 0) - selBlock.len) },
    });
    setSel(null);
  }

  // Tuval: normalde yalnız dolu slotlar; düzenleme modunda sınıf pencerelerinin
  // birleşimi de eklenir ki boş hedef hücreler tıklanabilir olsun.
  const dayCanvas = useMemo(() => {
    const m = new Map<number, Set<number>>();
    const add = (d: number, s: number) => { if (!m.has(d)) m.set(d, new Set()); m.get(d)!.add(s); };
    for (const a of result.assigned) add(a.day, a.slot);
    if (editMode && windowsOf) {
      for (const cls of classes) {
        const win = windowsOf(cls) || {};
        for (const [dStr, slots] of Object.entries(win)) slots.forEach(s => add(parseInt(dStr), s));
      }
    }
    return m;
  }, [result.assigned, editMode, windowsOf, classes]);
  const slotsOfDay = (d: number) => [...(dayCanvas.get(d) || [])].sort((a, b) => a - b);

  const canEdit = !!(onEdit && windowsOf && teacherSlots);
  const usedDays = [...dayCanvas.keys()].sort((a,b)=>a-b);
  const days = viewDay==='all' ? usedDays : [parseInt(viewDay)];
  const loadRows = teachers.map(t=>({name:t.name,n:result.tLoad[t.id]||0,branch:(t.branches||[])[0],id:t.id})).sort((a,b)=>b.n-a.n);
  const maxN = Math.max(1,...loadRows.map(r=>r.n));

  const unplacedGrouped: Record<string, { cls: Set<string>; n: number }> = {};
  result.unplaced.forEach(u=>{const k=`${u.course} — ${u.reason}`;(unplacedGrouped[k]=unplacedGrouped[k]||{cls:new Set(),n:0}).n++;unplacedGrouped[k].cls.add(u.cls);});

  const rowKeys = viewMode==='class' ? classes : teachers.map(t=>t.name);

  const find=(rk: string,d: number,i: number)=>result.assigned.find(a=>a.day===d&&a.slot===i&&(
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
          <select value={viewMode} onChange={e=>setViewMode(e.target.value)} disabled={editMode} className="input !w-auto !py-1.5 text-xs disabled:opacity-50">
            <option value="class">Sınıf bazlı</option>
            <option value="teacher">Öğretmen bazlı</option>
          </select>
          <select value={viewDay} onChange={e=>setViewDay(e.target.value)} className="input !w-auto !py-1.5 text-xs">
            <option value="all">Tüm günler</option>
            {usedDays.map(d=><option key={d} value={d}>{DAYS[d]}</option>)}
          </select>
          {canEdit && (
            <button
              onClick={() => setEditMode(e => {
                const n = !e;
                if (n) { setViewMode('class'); setViewDay('all'); }
                setSel(null);
                setSelUnplaced(null);
                return n;
              })}
              className="!px-3 !py-1.5 flex items-center gap-1.5 text-xs rounded-lg border"
              style={editMode
                ? {background:'#4f46e5', color:'#fff', borderColor:'#4f46e5', fontWeight:600}
                : {background:'#fff', color:'#4f46e5', borderColor:'#c7d2fe', fontWeight:600}}>
              <Pencil size={13}/> {editMode ? 'Düzenleme Açık' : 'Düzenle'}
            </button>
          )}
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

      {/* Düzenleme modu bilgi bandı */}
      {editMode && (
        <div className="text-[11px] p-2 rounded-lg" style={{background:'#eef2ff', border:'1px solid #c7d2fe', color:'#4338ca'}}>
          {selBlock ? (
            <>
              Seçili: <b>{selBlock.course}</b> — {labelOf(selBlock.cls)}, {DAYS[selBlock.day]} ({selBlock.len} saat).{' '}
              <span style={{color:'#166534', fontWeight:600}}>Yeşil hücreler</span> geçerli hedefler
              {swapTargets.size > 0 && <>, <span style={{color:'#b45309', fontWeight:600}}>turuncu çerçeveli dersler</span> takas edilebilir</>}.
              {validTargets.size === 0 && swapTargets.size === 0 && <b> Bu blok için kurallara uyan başka konum yok.</b>}
              {' '}Vazgeçmek için bloğa tekrar tıklayın.
              <button onClick={unassignSel}
                className="ml-2 px-1.5 py-0.5 rounded border text-[10px]"
                style={{background:'#fff', color:'#b91c1c', borderColor:'#fecaca', fontWeight:600}}
                title="Bloğu gridden çıkarıp Yerleşemeyen listesine taşır — yer açmak veya öğretmen değiştirmek için">
                Açığa al
              </button>
            </>
          ) : upSel && upMeta ? (
            <>
              Yerleştirilecek: <b>{upSel.course}</b> — {labelOf(upSel.cls)} ({upMeta.hours} saat ardışık blok).
              {upMeta.fixedTeacherId ? (
                <> Öğretmen: <b>{teacherById[upMeta.fixedTeacherId]?.name}</b>
                <span className="text-gray-500"> (bu sınıf-dersin diğer blokları onda — bir sınıf-dersi tek öğretmen verir)</span>.</>
              ) : upMeta.eligibleIds.length === 0 ? (
                <b> Bu derse uygun (branş + grup) öğretmen tanımlı değil — önce Öğretmenler sekmesinden branş/grup ekleyin.</b>
              ) : (
                <>
                  {' '}Öğretmen:
                  {upMeta.eligibleIds.map(tid => {
                    const cur = upTeacherId === tid;
                    return (
                      <button key={tid}
                        onClick={() => setSelUnplaced(su => ({ ...su!, teacherId: tid }))}
                        className="ml-1 px-1.5 py-0.5 rounded border text-[10px]"
                        style={cur
                          ? {background:'#4f46e5', color:'#fff', borderColor:'#4f46e5', fontWeight:600}
                          : {background:'#fff', color:'#4338ca', borderColor:'#c7d2fe'}}>
                        {teacherById[tid]?.name} ({result.tLoad[tid] || 0} saat{upMeta.presetTeacherId === tid ? ' · ön eşleştirme' : ''})
                      </button>
                    );
                  })}
                </>
              )}
              {upTeacherId && (validTargets.size > 0
                ? <> <span style={{color:'#166534', fontWeight:600}}>Yeşil hücreler</span> geçerli hedefler — tıklayınca yerleşir.</>
                : <b> Bu öğretmenle kurallara uyan boş yer yok — {upMeta.fixedTeacherId
                    ? 'bir bloğu taşıyıp/açığa alıp yer açın (öğretmeni değiştirmek için önce bu sınıf-dersin diğer bloklarını açığa alın)'
                    : 'başka öğretmen seçin ya da bir bloğu taşıyıp/açığa alıp yer açın'}.</b>)}
            </>
          ) : (
            <>Taşımak istediğiniz derse tıklayın{result.unplaced.length > 0 && <>; açıkta dersleri aşağıdaki <b>Yerleşemeyen</b> listesinden seçip yerleştirebilirsiniz</>}.
            {' '}Kurallar (öğretmen müsaitliği ve izin günü, sınıf/öğretmen çakışması,
            aynı dersin günde tek blok olması) otomatik denetlenir — yalnızca geçerli hedefler açılır.
            Değişiklikler ekranda kalır; öğretmen programlarına işlenmesi için <b>Uygula</b> gerekir.</>
          )}
        </div>
      )}

      {/* Yerleşemeyen dersler — düzenleme modunda parça parça seçilebilir (elle yerleştirme) */}
      {result.unplaced.length>0 && (
        <details className="rounded-xl border border-red-100 p-3 text-xs" style={{background:'#fef2f2aa'}} open={editMode || undefined}>
          <summary className="cursor-pointer text-red-600 flex items-center gap-1.5" style={{fontWeight:700}}>
            <AlertTriangle size={13}/> Yerleşemeyen ({result.unplaced.length})
            {editMode && <span className="text-[10px] text-gray-400" style={{fontWeight:400}}>— yerleştirmek için parçaya tıklayın</span>}
          </summary>
          {editMode ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.unplaced.map((u, i) => {
                const active = selUnplaced?.idx === i;
                return (
                  <button key={i}
                    onClick={() => { setSel(null); setSelUnplaced(active ? null : { idx: i, teacherId: null }); }}
                    className="px-2 py-1 rounded-lg border text-[11px]"
                    title={u.reason}
                    style={active
                      ? {background:'#4f46e5', color:'#fff', borderColor:'#4f46e5', fontWeight:600}
                      : {background:'#fff', color:'#b91c1c', borderColor:'#fecaca'}}>
                    {labelOf(u.cls)} — {u.course} ({unplacedMeta[i]?.hours || 2} saat)
                  </button>
                );
              })}
            </div>
          ) : (
            <ul className="mt-2 space-y-1 text-gray-600">
              {Object.entries(unplacedGrouped).map(([k,v])=>(
                <li key={k}>• <b>{k}</b> ×{v.n} <span className="text-gray-400">({[...v.cls].map(c=>labelOf(c)).join(', ')})</span></li>
              ))}
            </ul>
          )}
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
                <div className="h-full rounded-full" style={{width:`${r.n/maxN*100}%`,background:r.n>maxWeekly?'#ef4444':COURSE_COLOR[r.branch || '']||'#6366f1'}}/>
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
                {viewMode==='class'?'Sınıf':'Öğretmen'}
              </th>
              {days.map(d => {
                const slotsInDay = slotsOfDay(d);
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
                return slotsOfDay(d).map((s,si) => (
                  <th key={d+'-'+s} className="p-1 text-gray-400"
                    style={{minWidth:64,border:'1px solid #eef0f5',borderLeft:si===0?'3px solid #c7d2fe':'1px solid #eef0f5',background:'#f5f6fb',fontWeight:500,textAlign:'center'}}>
                    {s+1}
                  </th>
                ));
              })}
            </tr>
          </thead>
          <tbody>
            {rowKeys.map(rk=>(
              <tr key={rk}>
                <td className="p-2 sticky left-0 z-10 whitespace-nowrap" style={{background:'#fff',fontWeight:700,border:'1px solid #eef0f5'}}>
                  {viewMode==='class'?labelOf(rk):rk}
                </td>
                {days.map(d => {
                  return slotsOfDay(d).map((s,si) => {
                    const a=find(rk,d,s);
                    const leftBorder = si===0 ? '3px solid #c7d2fe' : '1px solid #eef0f5';
                    if (!a) {
                      // Boş hücre: düzenleme modunda, aktif parçanın (taşınan blok VEYA
                      // yerleştirilen açıkta parça) SATIRINDA ve kurallara uyan başlangıçsa
                      // yeşil tıklanabilir hedef olur.
                      const isTarget = editMode && viewMode==='class' && activePiece
                        && rk === activePiece.cls && validTargets.has(`${d}:${s}`);
                      return (
                        <td key={d+'-'+s}
                          onClick={isTarget ? () => (selBlock ? moveSel(d, s) : placeSel(d, s)) : undefined}
                          title={isTarget ? `${selBlock ? 'Buraya taşı' : 'Buraya yerleştir'} (${s+1}. dersten başlar)` : undefined}
                          style={{minWidth:64,
                            border: isTarget ? '1px dashed #16a34a' : '1px solid #eef0f5',
                            borderLeft: isTarget ? '1px dashed #16a34a' : leftBorder,
                            background: isTarget ? '#dcfce7' : undefined,
                            cursor: isTarget ? 'pointer' : undefined}}/>
                      );
                    }
                    const col=COURSE_COLOR[a.course]||'#6366f1';
                    const bid = blockOfEntry.get(entryKeyOf(a));
                    const isSel = editMode && sel === bid;
                    const isSwap = editMode && selBlock && bid != null && swapTargets.has(bid);
                    const clickable = editMode && viewMode==='class';
                    return (
                      <td key={d+'-'+s} className="p-1 text-center"
                        onClick={clickable ? () => {
                          if (isSwap) swapSel(blocks.find(b => b.id === bid)!);
                          else { setSel(isSel ? null : (bid || null)); setSelUnplaced(null); }
                        } : undefined}
                        title={clickable ? (isSwap ? 'Takas et' : isSel ? 'Seçimi bırak' : 'Taşımak için seç') : undefined}
                        style={{minWidth:64,border:`1px solid ${col}30`,borderLeft:si===0?`3px solid ${col}60`:undefined,
                          background:`${col}14`,color:col,
                          cursor: clickable ? 'pointer' : undefined,
                          outline: isSel ? '2px solid #4f46e5' : isSwap ? '2px dashed #f59e0b' : undefined,
                          outlineOffset: -2}}>
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
