'use client';

// Öğretmen ders programı editörü: haftalık slot-grid, sabit/geçici ders & etüt,
// izin günü, hafta navigasyonu. Nested EtutPanel ile öğrenci ataması.
import React, { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Save } from 'lucide-react';
import {
  ALL_DAYS, WEEKDAY_SLOT_IDS, WEEKEND_SLOT_IDS, classLabel,
  makeSlots, slotsForDay, getWeekKey, weekRangeLabel,
} from '@/lib/constants';
import { useSlotTimes } from '../SlotTimesContext';
import { api, Modal, getAdjacentWeek, isSlotPast } from './shared';

export default function ProgramEditor({ teacher, onClose, showToast, students }) {
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
    } else if (entry.type === 'etut') {
      setActiveCell(prev => prev?.slotId === slotId && prev?.dayIndex === dayIndex ? null : { dayIndex, slotId });
    }
  }

  function EtutPanel({ dayIndex, slotId }) {
    const existing = getEntry(dayIndex, slotId);
    const [studentId, setStudentId] = useState(existing?.studentId || '');
    const [studentName, setStudentName] = useState(existing?.studentName || '');
    const [studentCls, setStudentCls] = useState(existing?.studentCls || '');
    const [fixed, setFixed] = useState(existing?.fixed !== false);
    const [studentSearch, setStudentSearch] = useState('');

    function saveEtut() {
      setEntry(dayIndex, slotId, { type: 'etut', studentId, studentName, studentCls, fixed });
      setActiveCell(null);
    }

    return (
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <div className="text-xs font-600 text-gray-500 mb-2" style={{ fontWeight: 600 }}>
          {ALL_DAYS.find(d => d.index === dayIndex)?.label} – {slotsForDay(dayIndex, slotTimes).find(s => s.id === slotId)?.label}
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => { clearEntry(dayIndex, slotId); setActiveCell(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-600 border bg-white border-gray-200 text-gray-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-all"
            style={{ fontWeight: 600 }}>Slotu Kapat</button>
          <button onClick={() => { setEntry(dayIndex, slotId, { type: 'etut', studentId: '', studentName: '', studentCls: '', fixed: true }); setActiveCell(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-600 border bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-all"
            style={{ fontWeight: 600 }}>Açık Etüt</button>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sabit öğrenci rezervasyonu (opsiyonel)</label>
          <input className="input text-xs mb-1" placeholder="İsim veya sınıf ara..." value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)} />
          <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg bg-white">
            <button onClick={() => { setStudentId(''); setStudentName(''); setStudentCls(''); setStudentSearch(''); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${!studentId ? 'bg-emerald-50 text-emerald-700 font-600' : 'text-gray-400 hover:bg-gray-50'}`}
              style={{ fontWeight: !studentId ? 600 : 400 }}>— Açık slot —</button>
            {allowedStudents.filter(s => {
              const q = studentSearch.toLowerCase();
              return !q || s.name.toLowerCase().includes(q) || s.cls.toLowerCase().includes(q);
            }).slice(0, 20).map(s => (
              <button key={s.id} onClick={() => { setStudentId(s.id); setStudentName(s.name); setStudentCls(s.cls); setStudentSearch(''); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${studentId === s.id ? 'bg-emerald-50 text-emerald-700 font-600' : 'hover:bg-gray-50 text-gray-700'}`}
                style={{ fontWeight: studentId === s.id ? 600 : 400 }}>
                <span className="font-600" style={{ fontWeight: 600 }}>{s.name}</span>
                <span className="text-gray-400 ml-1.5">{classLabel(s.cls)}</span>
              </button>
            ))}
          </div>
          {studentId && (
            <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
              <input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600" />
              <span className="text-xs text-gray-700">Sabit rezervasyon (her hafta tekrar)</span>
            </label>
          )}
          {studentId && (
            <button onClick={saveEtut}
              className="mt-2 px-4 py-1.5 rounded-lg text-xs font-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
              style={{ fontWeight: 600 }}>Kaydet</button>
          )}
        </div>
      </div>
    );
  }

  const weekNav = (
    <div className="flex items-center justify-between mb-3 px-1">
      <button
        onClick={() => canPrev && setWeekKey(getAdjacentWeek(weekKey, -1))}
        disabled={!canPrev}
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <div className="text-xs text-gray-700 text-center">
        <div className="font-600" style={{ fontWeight: 600 }}>
          {(() => { const r = weekRangeLabel(weekKey); return `${r.startStr} – ${r.endStr} ${r.yearStr}`; })()}
        </div>
        {weekKey === currentWeek && <div className="text-[10px] text-indigo-500 mt-0.5">Bu hafta</div>}
        {weekKey !== currentWeek && <div className="text-[10px] text-amber-600 mt-0.5">İleri hafta — geçici değişiklikler bu haftaya uygulanır</div>}
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

  const dayHasContent = {};
  for (const day of visibleDays) {
    const dayProg = program?.[String(day.index)] || {};
    dayHasContent[day.index] = Object.values(dayProg).some(e => e && e.type);
  }
  const totalUnits = visibleDays.reduce((sum, d) => sum + (dayHasContent[d.index] ? 3 : 1), 0) || 1;
  const dayWidth = (dayIdx) => `${((dayHasContent[dayIdx] ? 3 : 1) / totalUnits) * 100}%`;

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

  if (loading) return (
    <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>
      {weekNav}
      {offDayBar}
      <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
    </Modal>
  );

  const weekdayDays = visibleDays.filter(d => !d.weekend);
  const weekendDays = visibleDays.filter(d => d.weekend);
  const hasWeekday = weekdayDays.length > 0;
  const hasWeekend = weekendDays.length > 0;

  return (
    <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>
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
                } else if (type === 'etut') {
                  if (entry.studentId) {
                    cellClass += 'bg-emerald-50 border-emerald-200 text-emerald-700';
                    cellContent = (
                      <div className="text-center leading-tight">
                        <div className="text-[9px] truncate font-600" style={{ fontWeight: 600 }}>{entry.studentName}</div>
                        <div className="text-[8px] text-violet-500">Sabit</div>
                      </div>
                    );
                  } else {
                    cellClass += 'bg-emerald-50 border-dashed border-emerald-300 text-emerald-500';
                    cellContent = <span className="text-[10px]">Etüt</span>;
                  }
                } else {
                  cellClass += 'bg-white border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/40';
                }
                const slotIsPast = isSlotPast(weekKey, day.index, slot.label);
                const blockPast = slotIsPast && type === 'etut';
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

      {activeCell && (getEntry(activeCell.dayIndex, activeCell.slotId)?.type === 'available' || getEntry(activeCell.dayIndex, activeCell.slotId)?.type === 'etut') && (
        <EtutPanel dayIndex={activeCell.dayIndex} slotId={activeCell.slotId} />
      )}

      <div className="flex gap-3 mt-4">
        <button className="btn-primary flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Kaydediliyor...' : 'Kaydet ve Uygula'}
        </button>
        <button className="btn-ghost" onClick={onClose}>İptal</button>
      </div>
    </Modal>
  );
}
