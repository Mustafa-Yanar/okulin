'use client';

// Öğretmen ders programı editörü: haftalık slot-grid, sabit/geçici ders & etüt,
// izin günü, hafta navigasyonu. Nested EtutPanel ile öğrenci ataması.
import React, { useState, useEffect, useMemo } from 'react';
import LoadingBox from '../Loading';
import { ChevronLeft, ChevronRight, Save, X, Plus } from 'lucide-react';
import {
  ALL_DAYS, WEEKDAY_SLOT_IDS, WEEKEND_SLOT_IDS,
  makeSlots, slotsForDay, getWeekKey, weekRangeLabel,
} from '@/lib/constants';
import { useSlotTimes } from '../SlotTimesContext';
import { api, Modal, getAdjacentWeek, isSlotPast } from './shared';
import EtutCalendar, { timeToMin, minToTop, durationToHeight } from './EtutCalendar';

// Ders slotu eylem paneli: "Ders" işaretli bir slota tıklayınca açılır.
// Etüt artık ayrı takvim sisteminde (etutSablonlari) — bu panelde sadece slotu kapatma var.
function DersPanel({ dayIndex, slotId, clearEntry, setActiveCell, slotTimes }) {
  return (
    <div className="p-4 border-t border-gray-100 bg-gray-50">
      <div className="text-xs font-600 text-gray-500 mb-2" style={{ fontWeight: 600 }}>
        {ALL_DAYS.find(d => d.index === dayIndex)?.label} – {slotsForDay(dayIndex, slotTimes).find(s => s.id === slotId)?.label}
      </div>
      <p className="text-[11px] text-gray-400 mb-3">
        Bu slot ders programına açık. Otomatik program oluşturucu buraya ders yerleştirebilir.
      </p>
      <button onClick={() => { clearEntry(dayIndex, slotId); setActiveCell(null); }}
        className="px-3 py-1.5 rounded-lg text-xs font-600 border bg-white border-gray-200 text-gray-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-all"
        style={{ fontWeight: 600 }}>Slotu Kapat</button>
    </div>
  );
}

export default function ProgramEditor({ teacher, onClose, showToast, students, inline = false }) {
  const currentWeek = getWeekKey();
  const maxWeek = getAdjacentWeek(getAdjacentWeek(currentWeek, 1), 1);
  const [weekKey, setWeekKey] = useState(currentWeek);
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeCell, setActiveCell] = useState(null);
  const [offDays, setOffDays] = useState(teacher.offDays || []);
  const [togglingDay, setTogglingDay] = useState(null);
  const [dirty, setDirty] = useState({});

  // Etüt şablonları (calendar — serbest saatli, haftadan bağımsız)
  const [etutSablonlar, setEtutSablonlar] = useState([]);
  const [showEtutForm, setShowEtutForm] = useState(false);
  const [savingEtut, setSavingEtut] = useState(false);
  const [selectedEtut, setSelectedEtut] = useState(null); // tıklanan etüt (eylem menüsü)

  const { slotTimes } = useSlotTimes();
  const weekdaySlots = useMemo(() => makeSlots(WEEKDAY_SLOT_IDS, slotTimes.weekday), [slotTimes.weekday]);
  const weekendSlots = useMemo(() => makeSlots(WEEKEND_SLOT_IDS, slotTimes.weekend), [slotTimes.weekend]);

  useEffect(() => {
    setLoading(true);
    setActiveCell(null);
    setDirty({});
    (async () => {
      try {
        const data = await api(`/api/program?teacherId=${teacher.id}&week=${weekKey}`);
        setProgram(data.program || {});
      } catch {
        setProgram({});
      } finally {
        setLoading(false);
      }
    })();
  }, [teacher.id, weekKey]);

  // Etüt şablonlarını yükle (haftadan bağımsız — sadece öğretmen değişince)
  useEffect(() => {
    (async () => {
      try {
        const d = await api(`/api/etut-sablon?teacherId=${teacher.id}`);
        setEtutSablonlar(d.sablonlar || []);
      } catch { setEtutSablonlar([]); }
    })();
  }, [teacher.id]);

  async function saveEtutSablon(sablon) {
    setSavingEtut(true);
    try {
      const r = await api('/api/etut-sablon', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, sablon }) });
      setEtutSablonlar(r.sablonlar || []);
      setShowEtutForm(false);
      showToast('Etüt eklendi');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSavingEtut(false); }
  }

  async function deleteEtutSablon(id) {
    try {
      const r = await api('/api/etut-sablon', { method: 'DELETE', body: JSON.stringify({ teacherId: teacher.id, id }) });
      setEtutSablonlar(r.sablonlar || []);
      setSelectedEtut(null);
      showToast('Etüt silindi');
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function toggleEtutSablon(id, scope, aktif) {
    try {
      const r = await api('/api/etut-sablon', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: teacher.id, id, scope, weekKey, aktif }),
      });
      setEtutSablonlar(r.sablonlar || []);
      setSelectedEtut(null);
      showToast(aktif ? 'Etüt aktifleştirildi' : (scope === 'week' ? 'Etüt bu hafta pasifleştirildi' : 'Etüt pasifleştirildi'));
    } catch (e) { showToast(e.message, 'error'); }
  }

  async function assignEtutSablon(id, student) {
    try {
      const r = await api('/api/etut-sablon', {
        method: 'PATCH',
        body: JSON.stringify({ teacherId: teacher.id, id, student }),
      });
      const list = r.sablonlar || [];
      setEtutSablonlar(list);
      setSelectedEtut(list.find(s => s.id === id) || null);
      showToast(student ? 'Öğrenci atandı' : 'Atama kaldırıldı');
    } catch (e) { showToast(e.message, 'error'); }
  }

  // Bir etüt şablonu bu hafta efektif aktif mi? (kalıcı aktif + bu hafta pasif listesinde değil)
  function etutAktifThisWeek(sb) {
    if (sb.aktif === false) return false;
    if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
    return true;
  }

  const canPrev = weekKey !== currentWeek;
  const canNext = weekKey !== maxWeek;

  function getEntry(dayIndex, slotId) {
    return program?.[String(dayIndex)]?.[slotId] || null;
  }

  function setEntry(dayIndex, slotId, entry) {
    setProgram(prev => ({
      ...prev,
      [String(dayIndex)]: {
        ...(prev?.[String(dayIndex)] || {}),
        [slotId]: entry,
      },
    }));
    setDirty(prev => ({ ...prev, [`${dayIndex}:${slotId}`]: entry }));
  }

  function clearEntry(dayIndex, slotId) {
    setProgram(prev => {
      const day = { ...(prev?.[String(dayIndex)] || {}) };
      delete day[slotId];
      return { ...prev, [String(dayIndex)]: day };
    });
    setDirty(prev => ({ ...prev, [`${dayIndex}:${slotId}`]: null }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const diff = {};
      for (const [key, entry] of Object.entries(dirty)) {
        const [dayIdx, slotId] = key.split(':');
        if (!diff[dayIdx]) diff[dayIdx] = {};
        diff[dayIdx][slotId] = entry;
      }
      await api('/api/program', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, weekKey, program: diff }) });
      showToast('Program kaydedildi ve uygulandı');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffDay(dayIndex) {
    const isCurrentlyOff = offDays.includes(dayIndex);
    const willBeOff = !isCurrentlyOff;
    if (willBeOff) {
      const dayProg = program?.[String(dayIndex)] || {};
      const hasEntries = Object.values(dayProg).some(e => e && e.type);
      if (hasEntries) {
        if (!confirm('Bu güne tanımlı ders/etüt var. İzin günü yapılırsa hepsi silinecek. Devam etmek istiyor musunuz?')) return;
      }
    }
    setTogglingDay(dayIndex);
    try {
      const res = await api('/api/teachers', {
        method: 'PUT',
        body: JSON.stringify({ action: 'toggle_off_day', id: teacher.id, dayIndex, off: willBeOff }),
      });
      setOffDays(res.offDays || []);
      if (willBeOff) {
        setProgram(prev => {
          const next = { ...(prev || {}) };
          delete next[String(dayIndex)];
          return next;
        });
        setDirty(prev => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (k.startsWith(`${dayIndex}:`)) delete next[k];
          }
          return next;
        });
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setTogglingDay(null);
    }
  }

  const allowedStudents = students
    ? students.filter(s => !teacher.allowedGroups?.length || teacher.allowedGroups.includes(s.group))
    : [];

  function handleSlotClick(dayIndex, slotId) {
    const entry = getEntry(dayIndex, slotId);
    if (!entry || !entry.type) {
      setEntry(dayIndex, slotId, { type: 'available', fixed: true });
    } else if (entry.type === 'available') {
      setActiveCell(prev => prev?.slotId === slotId && prev?.dayIndex === dayIndex ? null : { dayIndex, slotId });
    }
  }

  const weekNav = (
    <div className="flex items-center gap-2 mb-3 px-1 w-fit">
      <button
        onClick={() => canPrev && setWeekKey(getAdjacentWeek(weekKey, -1))}
        disabled={!canPrev}
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <div className="text-xs text-center min-w-[140px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="font-600" style={{ fontWeight: 600 }}>
          {(() => { const r = weekRangeLabel(weekKey); return `${r.startStr} – ${r.endStr} ${r.yearStr}`; })()}
        </div>
        {weekKey === currentWeek && <div className="text-[10px] text-indigo-500 mt-0.5">Bu hafta</div>}
        {weekKey !== currentWeek && <div className="text-[10px] text-amber-600 mt-0.5">İleri hafta — bu haftaya uygulanır</div>}
      </div>
      <button
        onClick={() => canNext && setWeekKey(getAdjacentWeek(weekKey, 1))}
        disabled={!canNext}
        className={`btn-ghost !p-2 ${!canNext ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronRight size={16} />
      </button>
    </div>
  );

  const offSet = new Set(offDays);
  const visibleDays = ALL_DAYS.filter(d => !offSet.has(d.index));

  // Tüm günler eşit genişlik — dolu günün otomatik genişlemesi kaldırıldı
  // (mobilde hoştu ama masaüstünde gereksiz zıplama yapıyordu).
  const dayCount = visibleDays.length || 1;
  const dayWidth = () => `${100 / dayCount}%`;

  const offDayBar = (
    <div className="flex flex-wrap items-center gap-1 mb-3 px-1">
      <span className="text-[10px] text-gray-400 mr-1">İzin günleri:</span>
      {ALL_DAYS.map(day => {
        const isOff = offSet.has(day.index);
        const busy = togglingDay === day.index;
        return (
          <button key={day.index}
            onClick={() => !busy && toggleOffDay(day.index)}
            disabled={busy}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${isOff ? 'bg-rose-100 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'} ${busy ? 'opacity-50' : ''}`}
            title={isOff ? 'İzin günü — tıklayarak aç' : 'Tıklayarak izin günü yap'}>
            {day.short} {isOff && '×'}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    const inner = <>{weekNav}{offDayBar}<LoadingBox height="h-32" /></>;
    if (inline) return <div className="py-2">{inner}</div>;
    return <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>{inner}</Modal>;
  }

  const weekdayDays = visibleDays.filter(d => !d.weekend);
  const weekendDays = visibleDays.filter(d => d.weekend);
  const hasWeekday = weekdayDays.length > 0;
  const hasWeekend = weekendDays.length > 0;

  const content = (
    <>
      {weekNav}
      {offDayBar}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse table-fixed">
          <thead>
            <tr>
              {hasWeekday && (
                <th className="hiddentext-left py-2 px-2 text-xs text-gray-400 font-600" style={{ fontWeight: 600, width: '72px' }}>Saat</th>
              )}
              {weekdayDays.map(day => (
                <th key={day.index}
                  className="text-center py-2 px-1 text-xs font-600 text-gray-500"
                  style={{ fontWeight: 600, width: dayWidth(day.index) }}>
                  {day.short}
                </th>
              ))}
              {hasWeekday && hasWeekend && (
                <th className="hiddenpx-0" style={{ width: '12px' }}><div className="w-px h-6 bg-gray-200 mx-auto" /></th>
              )}
              {weekendDays.map(day => (
                <th key={day.index}
                  className="text-center py-2 px-1 text-xs font-600 text-indigo-500"
                  style={{ fontWeight: 600, width: dayWidth(day.index) }}>
                  {day.short}
                  <span className="block text-[9px] text-indigo-300">H.sonu</span>
                </th>
              ))}
              {hasWeekend && (
                <th className="hiddentext-right py-2 px-2 text-xs text-indigo-400 font-600" style={{ fontWeight: 600, width: '72px' }}>Saat</th>
              )}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const maxRows = Math.max(hasWeekday ? weekdaySlots.length : 0, hasWeekend ? weekendSlots.length : 0);
              const renderDayCell = (day, rowIdx) => {
                const slots = slotsForDay(day.index, slotTimes);
                const slot = slots[rowIdx];
                if (!slot) return <td key={day.index} className="py-1 px-1"><div className="h-9 rounded bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs flex items-center justify-center">—</div></td>;
                const entry = getEntry(day.index, slot.id);
                const isActive = activeCell?.dayIndex === day.index && activeCell?.slotId === slot.id;
                const type = entry?.type;
                let cellClass = 'h-9 rounded-lg border text-xs font-500 transition-all cursor-pointer flex items-center justify-center px-1 w-full ';
                let cellContent = <span className="text-gray-300 text-[10px]">kapalı</span>;
                if (type === 'available') {
                  cellClass += 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100';
                  cellContent = <span className="text-[10px] font-600" style={{ fontWeight: 600 }}>Ders</span>;
                } else {
                  cellClass += 'bg-white border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/40';
                }
                const slotIsPast = isSlotPast(weekKey, day.index, slot.label);
                const blockPast = false; // ders slotları geçmişte de düzenlenebilir (kapatma)
                if (isActive) cellClass += ' ring-2 ring-indigo-400';
                if (blockPast) cellClass += ' opacity-70 !cursor-not-allowed';
                return (
                  <td key={day.index} className="py-0.5 px-0.5">
                    <div className="relative">
                      <button className={cellClass}
                        disabled={blockPast}
                        title={blockPast ? 'Bu saat dilimi geçmiş — düzenlenemez' : (type ? 'Tıkla: seçenekler' : 'Tıkla: ders saati aç')}
                        onClick={() => !blockPast && handleSlotClick(day.index, slot.id)}>
                        {cellContent}
                      </button>
                      {type && !slotIsPast && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            clearEntry(day.index, slot.id);
                            if (isActive) setActiveCell(null);
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-sm transition-colors z-10"
                          title="Slotu kapat"
                        >
                          <X size={9} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  </td>
                );
              };
              return Array.from({ length: maxRows }, (_, rowIdx) => (
                <tr key={rowIdx} className="border-t border-gray-50">
                  {hasWeekday && (
                    <td className="hiddenpy-1 px-2 text-[10px] text-gray-400 whitespace-nowrap text-left">
                      {weekdaySlots[rowIdx]?.label || ''}
                    </td>
                  )}
                  {weekdayDays.map(day => renderDayCell(day, rowIdx))}
                  {hasWeekday && hasWeekend && (
                    <td className="hiddenpx-0"><div className="w-px h-9 bg-gray-200 mx-auto" /></td>
                  )}
                  {weekendDays.map(day => renderDayCell(day, rowIdx))}
                  {hasWeekend && (
                    <td className="hiddenpy-1 px-2 text-[10px] text-indigo-400 whitespace-nowrap text-right">
                      {weekendSlots[rowIdx]?.label || ''}
                    </td>
                  )}
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>

      {activeCell && getEntry(activeCell.dayIndex, activeCell.slotId)?.type === 'available' && (
        <DersPanel
          key={`${activeCell.dayIndex}:${activeCell.slotId}`}
          dayIndex={activeCell.dayIndex}
          slotId={activeCell.slotId}
          clearEntry={clearEntry}
          setActiveCell={setActiveCell}
          slotTimes={slotTimes}
        />
      )}

      <div className="flex gap-3 mt-4">
        <button className="btn-primary flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Kaydediliyor...' : 'Kaydet ve Uygula'}
        </button>
        {!inline && <button className="btn-ghost" onClick={onClose}>İptal</button>}
      </div>

      {/* GEÇİCİ ÖNİZLEME — yeni etüt takvimi (fazlı geliştirme, Faz 7'de eski grid'in yerini alacak) */}
      <div className="mt-8 pt-6" style={{ borderTop: '2px dashed var(--border-subtle)' }}>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          ⚙️ Yeni Etüt Takvimi (geliştirme önizlemesi)
        </p>
        <EtutCalendar
          weekKey={weekKey}
          currentWeek={currentWeek}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={() => canPrev && setWeekKey(getAdjacentWeek(weekKey, -1))}
          onNext={() => canNext && setWeekKey(getAdjacentWeek(weekKey, 1))}
          headerRight={
            <button className="btn-primary !px-3 !py-1.5 text-sm flex items-center gap-1.5" onClick={() => setShowEtutForm(true)}>
              <Plus size={14} /> Etüt Ekle
            </button>
          }
          renderDayContent={(day) => {
            const blocks = [];
            // 1) Ders blokları (mavi) — grid'deki "available" slotlar
            const slots = slotsForDay(day.index, slotTimes);
            for (const slot of slots) {
              const entry = getEntry(day.index, slot.id);
              if (entry?.type !== 'available') continue;
              const top = minToTop(timeToMin(slot.start));
              const height = Math.max(durationToHeight(timeToMin(slot.end) - timeToMin(slot.start)), 16);
              blocks.push(
                <div key={`slot-${slot.id}`}
                  className="absolute left-0.5 right-0.5 rounded-md px-1 overflow-hidden"
                  style={{ top, height, background: 'color-mix(in srgb, #3b82f6 18%, transparent)', borderLeft: '3px solid #3b82f6' }}
                  title={`${slot.start}–${slot.end} · Ders`}>
                  <div className="text-[9px] leading-tight truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Ders</div>
                  {height >= 28 && <div className="text-[8px] leading-tight" style={{ color: 'var(--text-muted)' }}>{slot.start}</div>}
                </div>
              );
            }
            // 2) Etüt şablonları (serbest saatli, turkuaz aktif / gri pasif, tıkla→menü)
            for (const sb of etutSablonlar) {
              if (sb.dayIndex !== day.index) continue;
              const top = minToTop(timeToMin(sb.start));
              const height = Math.max(durationToHeight(timeToMin(sb.end) - timeToMin(sb.start)), 18);
              const aktif = etutAktifThisWeek(sb);
              blocks.push(
                <button key={`etut-${sb.id}`}
                  onClick={() => setSelectedEtut(sb)}
                  className="absolute left-0.5 right-0.5 rounded-md px-1 overflow-hidden text-left"
                  style={{
                    top, height,
                    background: aktif ? 'color-mix(in srgb, #14b8a6 22%, transparent)' : 'color-mix(in srgb, #94a3b8 16%, transparent)',
                    borderLeft: `3px solid ${aktif ? '#14b8a6' : '#94a3b8'}`,
                    opacity: aktif ? 1 : 0.7,
                  }}
                  title={`Etüt ${sb.start}–${sb.end}${aktif ? '' : ' (pasif)'} · tıkla: seçenekler`}>
                  <div className="text-[9px] leading-tight truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {sb.studentName || 'Etüt'}{aktif ? '' : ' (pasif)'}
                  </div>
                  {height >= 28 && <div className="text-[8px] leading-tight" style={{ color: 'var(--text-muted)' }}>{sb.start}–{sb.end}</div>}
                </button>
              );
            }
            return blocks;
          }}
        />
      </div>

      {selectedEtut && (
        <EtutEylemModal
          sablon={selectedEtut}
          aktif={etutAktifThisWeek(selectedEtut)}
          allowedStudents={allowedStudents}
          onClose={() => setSelectedEtut(null)}
          onToggle={toggleEtutSablon}
          onAssign={assignEtutSablon}
          onDelete={deleteEtutSablon}
        />
      )}

      {showEtutForm && (
        <EtutEkleForm
          defaultSure={slotTimes.etutSuresi || 60}
          molaSure={slotTimes.molaSuresi ?? 10}
          saving={savingEtut}
          busyRangesForDay={(dayIndex) => {
            // O günün meşgul aralıkları: ders/etüt slotları + etüt şablonları
            const ranges = [];
            const slots = slotsForDay(dayIndex, slotTimes);
            for (const slot of slots) {
              const entry = getEntry(dayIndex, slot.id);
              if (entry?.type === 'available') ranges.push({ start: slot.start, end: slot.end, label: 'ders' });
            }
            for (const sb of etutSablonlar) {
              if (sb.dayIndex === dayIndex) ranges.push({ start: sb.start, end: sb.end, label: 'etüt' });
            }
            return ranges;
          }}
          onClose={() => setShowEtutForm(false)}
          onSave={saveEtutSablon}
        />
      )}
    </>
  );

  if (inline) return <div className="py-2">{content}</div>;
  return <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>{content}</Modal>;
}

// ─── Etüt Ekle formu ─────────────────────────────────────────────────────────
// Gün + başlangıç + bitiş (serbest süre). Başlangıç seçilince bitiş, kurum
// varsayılan etüt süresiyle ön-doldurulur (kullanıcı değiştirebilir).
const ETUT_TIME_OPTS = (() => {
  const opts = [];
  for (let min = 7 * 60; min <= 23 * 60; min += 5) {
    const h = Math.floor(min / 60), m = min % 60;
    opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return opts;
})();

function addMinutesToTime(t, addMin) {
  const [h, m] = t.split(':').map(Number);
  let total = h * 60 + m + addMin;
  total = Math.min(total, 23 * 60); // calendar sınırı
  const hh = Math.floor(total / 60), mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function EtutEkleForm({ defaultSure, molaSure = 10, busyRangesForDay, saving, onClose, onSave }) {
  const [dayIndex, setDayIndex] = useState(0);
  const [start, setStart] = useState('15:00');
  const [end, setEnd] = useState(addMinutesToTime('15:00', defaultSure));
  const [ignoreMola, setIgnoreMola] = useState(false);

  const handleStartChange = (v) => {
    setStart(v);
    setEnd(addMinutesToTime(v, defaultSure)); // bitişi otomatik öner
  };

  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const invalid = toMin(end) <= toMin(start);

  // Çakışma + mola kontrolü
  const { overlap, molaWarnings } = useMemo(() => {
    const sMin = toMin(start), eMin = toMin(end);
    const ranges = busyRangesForDay ? busyRangesForDay(dayIndex) : [];
    let overlap = false;
    const molaWarnings = [];
    for (const r of ranges) {
      const rs = toMin(r.start), re = toMin(r.end);
      // Üst üste binme (çakışma)
      if (sMin < re && rs < eMin) { overlap = true; continue; }
      // Mola: bu blok bizim önümüzde bitiyorsa, aradaki boşluk molaSure'den az mı?
      if (re <= sMin && sMin - re < molaSure) {
        molaWarnings.push(`${r.start}–${r.end} ${r.label} bitiminden sonra ${sMin - re} dk var (en az ${molaSure} dk olmalı).`);
      }
      // Mola: bu blok bizden sonra başlıyorsa, aradaki boşluk molaSure'den az mı?
      if (eMin <= rs && rs - eMin < molaSure) {
        molaWarnings.push(`${r.start}–${r.end} ${r.label} başlangıcından önce ${rs - eMin} dk var (en az ${molaSure} dk olmalı).`);
      }
    }
    return { overlap, molaWarnings };
  }, [dayIndex, start, end, molaSure, busyRangesForDay]);

  const hasMola = molaWarnings.length > 0;
  // Çakışma asla geçilemez; mola uyarısı "yoksay" ile geçilebilir.
  const blocked = invalid || overlap || (hasMola && !ignoreMola);

  return (
    <Modal title="Yeni Etüt" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-label block mb-1">Gün</label>
          <select value={dayIndex} onChange={e => { setDayIndex(parseInt(e.target.value)); setIgnoreMola(false); }} className="input">
            {ALL_DAYS.map(d => <option key={d.index} value={d.index}>{d.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label block mb-1">Başlangıç</label>
            <select value={start} onChange={e => { handleStartChange(e.target.value); setIgnoreMola(false); }} className="input">
              {ETUT_TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-label block mb-1">Bitiş</label>
            <select value={end} onChange={e => { setEnd(e.target.value); setIgnoreMola(false); }} className="input">
              {ETUT_TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {invalid && <p className="text-xs" style={{ color: '#ef4444' }}>Bitiş saati başlangıçtan sonra olmalı.</p>}
        {!invalid && overlap && (
          <p className="text-xs" style={{ color: '#ef4444' }}>⛔ Bu saat aralığı mevcut bir ders/etütle çakışıyor — değiştirin.</p>
        )}
        {!invalid && !overlap && hasMola && (
          <div className="rounded-lg p-2.5" style={{ background: 'color-mix(in srgb, #f59e0b 12%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)' }}>
            <p className="text-xs mb-1" style={{ color: '#b45309', fontWeight: 600 }}>⚠ Yeterli mola yok:</p>
            {molaWarnings.map((w, i) => <p key={i} className="text-[11px]" style={{ color: '#b45309' }}>• {w}</p>)}
            <label className="flex items-center gap-1.5 text-xs mt-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={ignoreMola} onChange={e => setIgnoreMola(e.target.checked)} />
              Uyarıyı yoksay
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>İptal</button>
          <button className="btn-primary !px-5" disabled={saving || blocked}
            onClick={() => onSave({ dayIndex, start, end, aktif: true })}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Etüt eylem modalı (tıklanan etüt: aktif/pasif/sil) ──────────────────────
function EtutEylemModal({ sablon, aktif, allowedStudents = [], onClose, onToggle, onAssign, onDelete }) {
  const gun = ALL_DAYS.find(d => d.index === sablon.dayIndex)?.label || '';
  // Pasifleştirme onayı: "sadece bu hafta" varsayılan İŞARETLİ
  const [pasifMode, setPasifMode] = useState(false); // pasifleştirme onayı gösteriliyor mu
  const [sadeceBuHafta, setSadeceBuHafta] = useState(true);

  function handleStudentSelect(e) {
    const sid = e.target.value;
    if (!sid) { onAssign(sablon.id, null); return; }
    const s = allowedStudents.find(x => x.id === sid);
    if (s) onAssign(sablon.id, { id: s.id, name: s.name, cls: s.cls || '' });
  }

  return (
    <Modal title={`${gun} ${sablon.start}–${sablon.end} Etüt`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          Durum:
          <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontWeight: 600,
            background: aktif ? 'color-mix(in srgb,#14b8a6 18%,transparent)' : 'color-mix(in srgb,#94a3b8 18%,transparent)',
            color: aktif ? '#0f766e' : '#475569' }}>
            {aktif ? '● Aktif' : '○ Pasif'}
          </span>
        </div>

        {/* Öğrenci ataması (birebir) */}
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Öğrenci (birebir)</label>
          <select value={sablon.studentId || ''} onChange={handleStudentSelect}
            className="input !text-sm !py-1.5 w-full">
            <option value="">— Boş (atama yok) —</option>
            {allowedStudents.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.cls ? ` · ${s.cls}` : ''}</option>
            ))}
          </select>
          {sablon.studentName && (
            <p className="text-xs mt-1" style={{ color: '#0f766e' }}>Atandı: {sablon.studentName}</p>
          )}
        </div>

        {!pasifMode ? (
          <div className="flex flex-col gap-2">
            {aktif ? (
              <button className="btn-ghost w-full justify-center" onClick={() => setPasifMode(true)}>Pasif Yap</button>
            ) : (
              // Kalıcı pasifse (aktif:false) tümünü aç; sadece bu hafta pasifse o haftayı aç
              <button className="btn-ghost w-full justify-center"
                onClick={() => onToggle(sablon.id, sablon.aktif === false ? 'all' : 'week', true)}>
                Aktif Yap
              </button>
            )}
            <button className="btn-ghost w-full justify-center text-red-500 hover:bg-red-50"
              onClick={() => { if (confirm('Bu etüt kalıcı olarak silinsin mi?')) onDelete(sablon.id); }}>
              Sil
            </button>
          </div>
        ) : (
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-muted)' }}>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={sadeceBuHafta} onChange={e => setSadeceBuHafta(e.target.checked)} />
              Sadece bu hafta
            </label>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {sadeceBuHafta
                ? 'Etüt yalnızca bu hafta pasifleşir, sonraki haftalarda tekrar açık olur.'
                : 'İşaret kaldırıldı — etüt bu hafta ve sonraki tüm haftalarda pasif olur.'}
            </p>
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-ghost" onClick={() => setPasifMode(false)}>Vazgeç</button>
              <button className="btn-primary !px-5"
                onClick={() => onToggle(sablon.id, sadeceBuHafta ? 'week' : 'all', false)}>
                Onayla
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
