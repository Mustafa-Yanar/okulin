'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Users, Plus, Trash2, Edit3, Save, X, Search, Calendar, Clock, User, Check,
  BookMarked, GraduationCap, Shield, ChevronLeft, ChevronRight, Settings, Lock, LayoutGrid,
  List, ClipboardList, Phone, Wallet
} from 'lucide-react';
import { useSlotTimes } from './SlotTimesContext';
import { isValidTurkishMobile, formatTurkishMobile } from '@/lib/phone';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import DirectorDenemeYonetimi from './rehberlik/DirectorDenemeYonetimi';
import ProgramOlusturucu from './program/ProgramOlusturucu';
import FinancePanel from './finance/FinancePanel';
import { StudentBookingsView } from './StudentPanel';
import { TeacherBookingsList } from './TeacherPanel';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';

import {
  STUDENT_GROUPS,
  ALL_DAYS,
  WEEKDAY_SLOT_IDS,
  WEEKEND_SLOT_IDS,
  classLabel,
  getWeekKey,
  weekRangeLabel,
  slotsForDay,
  branchesForGroups,
  makeSlots
} from '@/lib/constants';
import {
  GROUPS, api, Modal, Label, FormField,
  getAdjacentWeek, WeekNav, isSlotPast, guidanceSubjectsFor,
} from './director/shared';
import { TeacherForm, StudentForm, ImportModal } from './director/Forms';
import { DirectorAttendanceView, StudentAttendanceView } from './director/Attendance';
import DirectorMuhasebeTab from './director/MuhasebeTab';
import HistoryModal from './director/HistoryModal';
// page.js bunu DirectorPanel'den import ediyor — yol değişmesin diye re-export.
export { DirectorSettingsModal } from './director/Settings';

// ─── STUDENT LIST & RELATED ─────────────────────────────────────────────────────
function StudentExpandedView({ student, allSlots, onCancelBooking, onGuidanceReviewed }) {
  const [tab, setTab] = useState('rehberlik');
  return (
    <div className="px-3 py-2">
      <div className="flex gap-1 mb-3 p-1 bg-white rounded-full w-fit border border-gray-200 shadow-sm">
        {[
          ['rehberlik', 'Rehberlik', BookOpen],
          ['devamsizlik', 'Devamsızlık Bilgisi', ClipboardList],
          ['etut', 'Etüt Geçmişi', Clock],
        ].map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3.5 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-all ${active ? 'text-white shadow-md' : 'text-gray-500 hover:text-gray-700'}`}
              style={{
                fontWeight: 600,
                background: active ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : undefined,
              }}>
              <Icon size={12} /> {label}
            </button>
          );
        })}
      </div>
      {tab === 'etut' && (
        <StudentBookingsView student={student} allSlots={allSlots} onCancel={onCancelBooking} />
      )}
      {tab === 'devamsizlik' && (
        <StudentAttendanceView studentId={student.id} />
      )}
      {tab === 'rehberlik' && (
        <RehberlikAccordion
          subjects={guidanceSubjectsFor(student.cls)}
          editable={true}
          studentId={student.id}
          solvedContent={<StudentGuidanceView studentId={student.id} onReviewed={onGuidanceReviewed} />}
        />
      )}
    </div>
  );
}

function StudentList({ students, allSlots, weekKey, onCancelBooking, onEdit, onDelete, onDeleteClass, onHistory, pendingGuidance, onGuidanceReviewed }) {
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [openCls, setOpenCls] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [scheduleCls, setScheduleCls] = useState(null);

  const grouped = useMemo(() => {
    const q = searchQ.toLowerCase();
    const groupOrder = { ortaokul: 0, lise: 1, mezun: 2 };
    const clsSort = cls => cls.startsWith('m') ? parseInt(cls.slice(1)) : parseInt(cls);
    const sorted = students
      .filter(s =>
        (s.name.toLowerCase().includes(q)||s.cls.toLowerCase().includes(q)||s.username?.toLowerCase().includes(q)) &&
        (!filterGroup||s.group===filterGroup)
      )
      .sort((a, b) => {
        const gDiff = (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
        if (gDiff !== 0) return gDiff;
        return clsSort(a.cls) - clsSort(b.cls);
      });
    const groups = [];
    for (const s of sorted) {
      if (!groups.length || groups[groups.length-1].cls !== s.cls) {
        groups.push({ cls: s.cls, label: classLabel(s.cls), group: s.group, students: [] });
      }
      groups[groups.length-1].students.push(s);
    }
    return groups;
  }, [students, searchQ, filterGroup]);

  const toggle = cls => setOpenCls(prev => prev === cls ? null : cls);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input text-sm" placeholder="İsim, sınıf..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <select className="input !w-auto text-sm" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">Tüm Gruplar</option>
          {Object.entries(GROUPS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        {grouped.length === 0 && <div className="card p-8 text-center text-gray-400"><GraduationCap size={32} className="mx-auto mb-2 opacity-30" /><p>Öğrenci bulunamadı</p></div>}
        {grouped.map(grp => {
          const isOpen = openCls === grp.cls;
          const dotColor = grp.group==='lise'
            ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
            : grp.group==='ortaokul'
            ? 'linear-gradient(135deg,#22c55e,#16a34a)'
            : 'linear-gradient(135deg,#f59e0b,#d97706)';
          const colors = { header:'bg-slate-200 text-slate-700 hover:bg-slate-300', dot: dotColor };
          return (
            <div key={grp.cls}>
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-700 transition-colors ${colors.header}`} style={{ fontWeight:700 }}>
                <button onClick={() => toggle(grp.cls)} className="flex items-center gap-2 flex-1 text-left">
                  <span>{grp.label} <span className="font-500 opacity-60" style={{ fontWeight:500 }}>({grp.students.length} öğrenci)</span></span>
                  <ChevronRight size={14} className="transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                </button>
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => setScheduleCls(grp.cls)}
                    className="p-1 rounded hover:bg-indigo-100 text-slate-600 hover:text-indigo-600 transition-colors"
                    title="Sınıfın ders programı">
                    <Calendar size={12} />
                  </button>
                  {onDeleteClass && (
                    <button onClick={() => onDeleteClass(grp.cls, grp.students)}
                      className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                      title="Sınıfı sil">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="grid gap-1.5 mt-1.5 ml-2">
                  {grp.students.map(s => (
                    <div key={s.id} className={`card overflow-hidden text-sm transition-all duration-200 ${expandedId === s.id ? '' : 'hover:shadow-lg hover:border-indigo-400 hover:-translate-y-px hover:bg-indigo-50/30'}`}>
                      <div className="flex items-center justify-between px-3 py-3">
                        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                          <div className="relative shrink-0">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-700"
                              style={{ background: colors.dot, fontWeight:700 }}>
                              {s.name.slice(0,2).toUpperCase()}
                            </div>
                            {pendingGuidance?.[s.id] > 0 && (
                              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-700 flex items-center justify-center" style={{ fontWeight: 700 }}>
                                {pendingGuidance[s.id]}
                              </span>
                            )}
                          </div>
                          <span className="font-600 truncate" style={{ fontWeight:600 }}>{s.name}</span>
                          <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform ml-auto"
                            style={{ transform: expandedId === s.id ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                        </button>
                        <div className="flex gap-2 shrink-0 ml-2">
                          <button className="btn-ghost !px-2 !py-1.5" onClick={() => onEdit(s)}><Edit3 size={12} /></button>
                          <button className="btn-ghost !px-2 !py-1.5 text-red-400 hover:bg-red-50" onClick={() => onDelete(s)}><Trash2 size={12} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {scheduleCls && (
        <ClassScheduleModal cls={scheduleCls} onClose={() => setScheduleCls(null)} />
      )}
      {expandedId && (() => {
        const st = students.find(x => x.id === expandedId);
        if (!st) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-slide-in">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
                <h3 className="font-700 text-base truncate" style={{ fontWeight: 700 }}>
                  {st.name} <span className="font-500 text-gray-400 text-sm" style={{ fontWeight: 500 }}>· {classLabel(st.cls)}</span>
                </h3>
                <button onClick={() => setExpandedId(null)} className="p-2 rounded-lg hover:bg-gray-100 shrink-0" title="Kapat"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto">
                <StudentExpandedView student={st} allSlots={allSlots} onCancelBooking={onCancelBooking} onGuidanceReviewed={onGuidanceReviewed} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ClassScheduleModal({ cls, onClose }) {
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api(`/api/class-schedule?cls=${encodeURIComponent(cls)}`);
        setSchedule(data.schedule || {});
      } catch {
        setSchedule({});
      } finally {
        setLoading(false);
      }
    })();
  }, [cls]);

  const visibleDays = useMemo(() => {
    if (!schedule) return [];
    return ALL_DAYS.filter(day => (schedule[day.index] || []).length > 0);
  }, [schedule]);

  const rows = useMemo(() => {
    if (!schedule) return [];
    const dayLessons = {};
    let maxLessons = 0;
    for (const day of visibleDays) {
      const list = [...(schedule[day.index] || [])];
      list.sort((a, b) => {
        const an = parseInt(a.slotId.replace(/\D/g, ''));
        const bn = parseInt(b.slotId.replace(/\D/g, ''));
        return an - bn;
      });
      dayLessons[day.index] = list;
      if (list.length > maxLessons) maxLessons = list.length;
    }
    const result = [];
    for (let i = 0; i < maxLessons; i++) {
      const row = { lessonNo: i + 1, byDay: {} };
      for (const day of visibleDays) {
        row.byDay[day.index] = dayLessons[day.index][i] || null;
      }
      result.push(row);
    }
    return result;
  }, [schedule, visibleDays]);

  return (
    <Modal title={`${cls.toUpperCase()} – Ders Programı`} onClose={onClose} wide>
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Yükleniyor...</div>
      ) : visibleDays.length === 0 ? (
        <div className="py-8 text-center text-gray-400">
          <Calendar size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Bu sınıf için tanımlı ders bulunmuyor.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="text-left py-2 px-2 text-gray-400 font-600 w-12" style={{ fontWeight: 600 }}>#</th>
                {visibleDays.map(day => (
                  <th key={day.index} className={`text-center py-2 px-2 font-600 ${day.weekend ? 'text-indigo-500' : 'text-gray-600'}`} style={{ fontWeight: 600 }}>
                    {day.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.lessonNo} className="border-t border-gray-50">
                  <td className="py-2 px-2 text-gray-400 font-500" style={{ fontWeight: 500 }}>{row.lessonNo}.</td>
                  {visibleDays.map(day => {
                    const lesson = row.byDay[day.index];
                    if (!lesson) return <td key={day.index} className="py-2 px-1"><div className="rounded py-2 text-center text-gray-200 bg-gray-50 text-[10px]">—</div></td>;
                    return (
                      <td key={day.index} className="py-1 px-1">
                        <div className="rounded-lg py-1.5 px-2 bg-blue-50 border border-blue-100 text-center">
                          <div className="text-[11px] font-700 text-blue-700 truncate" style={{ fontWeight: 700 }}>{lesson.teacherName}</div>
                          <div className="text-[9px] text-blue-400 truncate">{lesson.subBranch || lesson.branch}</div>
                          <div className="text-[9px] text-gray-400 truncate">{lesson.slotLabel}</div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function ProgramEditor({ teacher, onClose, showToast, students }) {
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

// ─── MAIN DIRECTOR PANEL ────────────────────────────────────────────────────────
export default function DirectorPanel({ session, showToast }) {
  const [tab, setTab] = useState('teachers');
  const [showProgramOlusturucuModal, setShowProgramOlusturucuModal] = useState(false);
  const [showDenemelerModal, setShowDenemelerModal] = useState(false);
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTeacher, setEditTeacher] = useState(null);
  const [editStudent, setEditStudent] = useState(null);
  const [selectedTeacherForSlots, setSelectedTeacherForSlots] = useState(null);
  const [teacherSlots, setTeacherSlots] = useState(null);
  const [programTeacher, setProgramTeacher] = useState(null);
  const [expandedTeacherId, setExpandedTeacherId] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null);
  const [pendingGuidance, setPendingGuidance] = useState({});

  const { slotTimes } = useSlotTimes();

  const loadPendingGuidance = useCallback(async () => {
    try {
      const data = await api('/api/guidance/pending');
      setPendingGuidance(data || {});
    } catch {}
  }, []);

  useEffect(() => { loadPendingGuidance(); }, [loadPendingGuidance]);

  const loadAll = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [teacherData, studentData, slotsData] = await Promise.all([
        api('/api/teachers'),
        api('/api/students'),
        api(`/api/slots?week=${resolvedWeek}`),
      ]);
      setTeachers([...teacherData].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      setStudents(studentData);
      setAllSlots(slotsData.slots || []);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, []);

  const loadTeacherSlots = async (teacher, wk) => {
    const data = await api(`/api/slots?teacherId=${teacher.id}&week=${wk || weekKey}`);
    setTeacherSlots(data.grid);
    setSelectedTeacherForSlots(teacher);
  };

  const handleWeekChange = async (newWeek) => {
    setWeekKey(newWeek);
    const slotsData = await api(`/api/slots?week=${newWeek}`);
    setAllSlots(slotsData.slots || []);
    if (selectedTeacherForSlots) await loadTeacherSlots(selectedTeacherForSlots, newWeek);
  };

  const refreshSlots = async (teacher) => {
    const t = teacher || selectedTeacherForSlots;
    if (t) {
      const data = await api(`/api/slots?teacherId=${t.id}&week=${weekKey}`);
      setTeacherSlots(data.grid);
    }
    const slotsData = await api(`/api/slots?week=${weekKey}`);
    setAllSlots(slotsData.slots || []);
  };

  const handleBook = async (params) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      await refreshSlots();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async (params) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      await refreshSlots();
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-xl w-fit flex-wrap">
        {[['teachers','Öğretmenler'],['students','Rehberlik'],['yoklama','Yoklama'],['muhasebe','💰 Muhasebe']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab===key?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight:600 }}>{label}</button>
        ))}
      </div>

      {/* TEACHERS TAB */}
      {tab === 'teachers' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğretmenler ({teachers.length})</h3>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditTeacher(null); setShowTeacherForm(true); }}>
                <Plus size={14} /> Öğretmen Ekle
              </button>
              <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => setShowProgramOlusturucuModal(true)}>
                <LayoutGrid size={14} /> Ders Programı
              </button>
            </div>
          </div>
          <div className="grid gap-2">
            {teachers.map(t => {
              const isOpen = expandedTeacherId === t.id;
              return (
                <div key={t.id} className={`card overflow-hidden transition-all duration-200 ${isOpen ? '' : 'hover:shadow-lg hover:border-indigo-400 hover:-translate-y-px hover:bg-indigo-50/30'}`}>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <button className="flex items-center gap-3 text-left flex-1 min-w-0" onClick={async () => {
                      if (isOpen) { setExpandedTeacherId(null); return; }
                      setExpandedTeacherId(t.id);
                      await loadTeacherSlots(t);
                    }}>
                      <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
                        {t.photoUrl
                          ? <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover" />
                          : <User size={22} className="text-gray-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-600" style={{ fontWeight:600 }}>{t.name}</div>
                        <div className="text-xs text-gray-500">{(t.branches||[]).join(', ')}</div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(t.allowedGroups||[]).map(g => <span key={g} className="badge" style={{ background:'#e0e7ff',color:'#4338ca' }}>{GROUPS[g]}</span>)}
                          {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'#f3f4f6',color:'#9ca3af' }}>Tüm gruplar</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform mx-2" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                    </button>
                    <div className="flex gap-2 shrink-0">
                      <button className="btn-ghost !px-3 !py-2" onClick={() => { setEditTeacher(t); setShowTeacherForm(true); }}><Edit3 size={14} /></button>
                      <button className="btn-ghost !px-3 !py-2 text-red-400 hover:bg-red-50" onClick={async () => {
                        if (!confirm(`${t.name} silinsin mi?`)) return;
                        try { await api('/api/teachers',{method:'DELETE',body:JSON.stringify({id:t.id})}); showToast('Öğretmen silindi'); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
                      }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
                        <div className="flex gap-2 shrink-0">
                          <button className="btn-ghost !px-2.5 !py-1.5 text-gray-600" onClick={() => setHistoryTarget({ type: 'teacher', id: t.id, name: t.name })} title="Geçmiş etütler">
                            <Clock size={14} />
                          </button>
                          <button className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-sm" onClick={() => setProgramTeacher(t)}>
                            <LayoutGrid size={13} /> Program
                          </button>
                        </div>
                      </div>
                      {selectedTeacherForSlots?.id === t.id && teacherSlots ? (
                        <TeacherBookingsList
                          bookedList={(() => {
                            const items = [];
                            ALL_DAYS.forEach(day => {
                              slotsForDay(day.index, slotTimes).forEach((slot, slotIdx) => {
                                const sd = teacherSlots[day.index]?.[slotIdx];
                                if (sd?.booked) items.push({
                                  dayIndex: day.index, dayLabel: day.label,
                                  slotId: slot.id, slotLabel: slot.label, slotIdx,
                                  studentName: sd.studentName,
                                  studentCls: (sd.studentCls||'').toUpperCase(),
                                  studentId: sd.studentId,
                                  bookedBy: sd.bookedBy || 'student',
                                  fixed: !!sd.fixed,
                                });
                              });
                            });
                            return items;
                          })()}
                          listColorMap={{
                            student: { bg:'bg-indigo-50', border:'border-indigo-100', day:'text-indigo-700', time:'text-indigo-400', div:'bg-indigo-200', badge:'bg-indigo-100 text-indigo-500', label:'Öğrenci' },
                            teacher: { bg:'bg-emerald-50', border:'border-emerald-100', day:'text-emerald-700', time:'text-emerald-400', div:'bg-emerald-200', badge:'bg-emerald-100 text-emerald-600', label:'Öğretmen' },
                            director: { bg:'bg-amber-50', border:'border-amber-100', day:'text-amber-700', time:'text-amber-400', div:'bg-amber-200', badge:'bg-amber-100 text-amber-600', label:'Müdür' },
                          }}
                          onCancel={item => handleCancel({ teacherId: t.id, day: item.dayIndex, slotId: item.slotId })}
                          canCancelAll
                        />
                      ) : (
                        <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {teachers.length===0 && <div className="card p-8 text-center text-gray-400"><Users size={32} className="mx-auto mb-2 opacity-30" /><p>Henüz öğretmen eklenmemiş</p></div>}
          </div>
        </div>
      )}

      {/* STUDENTS TAB */}
      {tab === 'students' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğrenciler ({students.length})</h3>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditStudent(null); setShowStudentForm(true); }}>
                <Plus size={14} /> Öğrenci Ekle
              </button>
              <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => setShowDenemelerModal(true)}>
                <ClipboardList size={14} /> Denemeler
              </button>
            </div>
          </div>
          <StudentList students={students}
            allSlots={allSlots} weekKey={weekKey}
            onCancelBooking={async ({ teacherId, day, slotId }) => {
              try {
                await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ teacherId, day, slotId, weekKey }) });
                showToast('Etüt iptal edildi');
                loadAll(weekKey);
              } catch(err) { showToast(err.message, 'error'); }
            }}
            onEdit={s => { setEditStudent(s); setShowStudentForm(true); }}
            onDelete={async s => {
              if (!confirm(`${s.name} silinsin mi?`)) return;
              try { await api('/api/students',{method:'DELETE',body:JSON.stringify({id:s.id})}); showToast('Öğrenci silindi'); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
            }}
            onDeleteClass={async (cls, clsStudents) => {
              if (!confirm(`${classLabel(cls)} sınıfındaki ${clsStudents.length} öğrenci silinsin mi?`)) return;
              try {
                await api('/api/students', { method: 'DELETE', body: JSON.stringify({ ids: clsStudents.map(s => s.id) }) });
                showToast(`${clsStudents.length} öğrenci silindi`);
                loadAll(weekKey);
              } catch(err) { showToast(err.message, 'error'); }
            }}
            onHistory={s => setHistoryTarget({ type: 'student', id: s.id, name: s.name })}
            pendingGuidance={pendingGuidance}
            onGuidanceReviewed={loadPendingGuidance} />
        </div>
      )}

      {historyTarget && (
        <HistoryModal target={historyTarget} onClose={() => setHistoryTarget(null)}
          currentWeekKey={weekKey}
          currentEntries={allSlots.filter(s => s.booked && (
            historyTarget.type === 'teacher' ? s.teacherId === historyTarget.id : s.studentId === historyTarget.id
          )).map(s => ({
            day: s.day, dayLabel: s.dayLabel, slotId: s.slotId, slotLabel: s.slotLabel,
            studentId: s.studentId, studentName: s.studentName, studentCls: s.studentCls,
            teacherId: s.teacherId, teacherName: s.teacherName, branch: s.branch,
            bookedBy: s.bookedBy, fixed: !!s.fixed,
          }))} />
      )}

      {/* YOKLAMA TAB */}
      {tab === 'yoklama' && (
        <DirectorAttendanceView showToast={showToast} />
      )}

      {tab === 'muhasebe' && (
        <DirectorMuhasebeTab session={session} showToast={showToast} />
      )}

      {/* Modals */}
      {showTeacherForm && (
        <TeacherForm initial={editTeacher} onClose={() => { setShowTeacherForm(false); setEditTeacher(null); }}
          onSave={async data => {
            try {
              if (editTeacher) { await api('/api/teachers',{method:'PUT',body:JSON.stringify({id:editTeacher.id,...data})}); showToast('Öğretmen güncellendi'); }
              else { await api('/api/teachers',{method:'POST',body:JSON.stringify(data)}); showToast('Öğretmen eklendi'); }
              setShowTeacherForm(false); setEditTeacher(null); loadAll(weekKey);
            } catch(err){showToast(err.message,'error');}
          }} />
      )}
      {showStudentForm && (
        <StudentForm initial={editStudent} onClose={() => { setShowStudentForm(false); setEditStudent(null); }}
          onSwitchToImport={() => { setShowStudentForm(false); setEditStudent(null); setShowImport(true); }}
          onSave={async data => {
            try {
              if (editStudent) { await api('/api/students',{method:'PUT',body:JSON.stringify({id:editStudent.id,...data})}); showToast('Öğrenci güncellendi'); }
              else { await api('/api/students',{method:'POST',body:JSON.stringify(data)}); showToast('Öğrenci eklendi'); }
              setShowStudentForm(false); setEditStudent(null); loadAll(weekKey);
            } catch(err){showToast(err.message,'error');}
          }} />
      )}
      {programTeacher && (
        <ProgramEditor teacher={programTeacher} students={students} showToast={showToast}
          onClose={() => { setProgramTeacher(null); loadAll(weekKey); }} />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} showToast={showToast} onDone={() => { setShowImport(false); loadAll(weekKey); }} />
      )}
      {showProgramOlusturucuModal && (
        <Modal title="Ders Programı Oluştur" onClose={() => setShowProgramOlusturucuModal(false)} xwide lockClose>
          <ProgramOlusturucu api={api} showToast={showToast}
            activeClasses={[...new Set(students.map(s => s.cls))]} />
        </Modal>
      )}
      {showDenemelerModal && (
        <Modal title="Denemeler" onClose={() => setShowDenemelerModal(false)} xwide lockClose>
          <DirectorDenemeYonetimi showToast={showToast} />
        </Modal>
      )}
    </div>
  );
}
