'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Calendar, Clock, Save, X, ClipboardList
} from 'lucide-react';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import {
  allowedBranchesForClass,
  MATH_FAMILY,
  classLabel,
  getWeekKey,
  weekRangeLabel,
  ALL_DAYS
} from '@/lib/constants';

// Helper API Fetcher
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

// Helper: haftalık gezinme hesaplayıcı
function getAdjacentWeek(weekKey, delta) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const date = new Date(parseInt(year), 0, 1 + (week - 1) * 7);
  date.setDate(date.getDate() + delta * 7);
  const d = new Date(date);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const w = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

// Helper: ders saati geçip geçmediğini denetleme
function isSlotPast(weekKey, dayIndex, slotLabel) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const jan4 = new Date(parseInt(year), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const mon = new Date(jan4);
  mon.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  const startStr = (slotLabel || '').split('–')[0]?.split(':') || ['0','0'];
  const hh = parseInt(startStr[0] || '0');
  const mm = parseInt(startStr[1] || '0');
  const slotStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + dayIndex, hh, mm);
  return slotStart.getTime() <= Date.now();
}

function WeekNav({ weekKey, onPrev, onNext, canPrev = true, canNext = true }) {
  const { startStr, endStr } = weekRangeLabel(weekKey);
  return (
    <div className="flex items-center gap-1">
      <button onClick={onPrev} disabled={!canPrev} aria-label="Önceki hafta"
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs text-gray-700 text-center whitespace-nowrap">
        {startStr} – {endStr}
      </span>
      <button onClick={onNext} disabled={!canNext} aria-label="Sonraki hafta"
        className={`btn-ghost !p-2 ${!canNext ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

// Lucide Chevron Icon Helpers inside WeekNav
function ChevronLeft({ size, className }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6"/></svg>;
}
function ChevronRight({ size, className }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>;
}

// Rehberlik ders listesi seçimi
function guidanceSubjectsFor(cls) {
  if (!cls) return [];
  if (cls.startsWith('7')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  }
  if (cls.startsWith('8')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  }
  let isSayisal = false;
  let isEA = false;
  let grade = 0;
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    isSayisal = n <= 5;
    isEA = n > 5;
    grade = 12;
  } else {
    grade = Math.floor(parseInt(cls) / 100);
    const sec = parseInt(cls.slice(1));
    if (grade === 3) { isSayisal = sec <= 3; isEA = sec > 3; }
    if (grade === 4) { isSayisal = sec <= 5; isEA = sec > 5; }
  }
  if (grade === 1 || grade === 2) {
    return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (grade === 3) {
    if (isSayisal) return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji'];
    return ['Türkçe', 'Matematik', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (isSayisal) {
    return [
      'Türkçe',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik', 'AYT Fizik',
      'TYT Kimya', 'AYT Kimya',
      'TYT Biyoloji', 'AYT Biyoloji',
      'TYT Tarih',
      'TYT Coğrafya',
      'TYT Felsefe',
      'Din Kültürü',
    ];
  }
  if (isEA) {
    return [
      'Türkçe', 'Edebiyat',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik',
      'TYT Kimya',
      'TYT Biyoloji',
      'TYT Tarih', 'AYT Tarih',
      'TYT Coğrafya', 'AYT Coğrafya',
      'TYT Felsefe', 'AYT Felsefe',
      'Din Kültürü',
    ];
  }
  return [];
}

const GROUPS = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

// ─── AVAILABLE TREE ────────────────────────────────────────────────────────────
function AvailableTree({ available, onBook, selectableBranchesFor }) {
  const [openTeachers, setOpenTeachers] = useState({});
  const [openDays, setOpenDays] = useState({});

  const tree = useMemo(() => {
    const map = {};
    for (const s of available) {
      if (!map[s.teacherId]) {
        map[s.teacherId] = { id: s.teacherId, name: s.teacherName, branches: s.branches || [], days: {} };
      }
      const dayKey = s.day;
      if (!map[s.teacherId].days[dayKey]) {
        map[s.teacherId].days[dayKey] = { dayIndex: s.day, dayLabel: s.dayLabel, slots: [] };
      }
      map[s.teacherId].days[dayKey].slots.push(s);
    }
    return Object.values(map)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(t => ({
        ...t,
        days: Object.values(t.days).sort((a, b) => a.dayIndex - b.dayIndex),
      }));
  }, [available]);

  const toggleTeacher = id => setOpenTeachers(p => ({ ...p, [id]: !p[id] }));
  const toggleDay = key => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  if (tree.length === 0) {
    return <div className="card p-8 text-center text-gray-400"><Calendar size={32} className="mx-auto mb-2 opacity-30" /><p>Uygun etüt bulunamadı</p></div>;
  }

  return (
    <div className="space-y-2">
      {tree.map(teacher => {
        const tOpen = !!openTeachers[teacher.id];
        const totalSlots = teacher.days.reduce((n, d) => n + d.slots.length, 0);
        return (
          <div key={teacher.id} className="card overflow-hidden">
            <button onClick={() => toggleTeacher(teacher.id)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-700 shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', fontWeight: 700 }}>
                  {(teacher.branches[0] || '?').slice(0, 2)}
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{teacher.name}</div>
                  <div className="text-xs text-gray-500">{teacher.branches.join(', ')} · {totalSlots} boş saat</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: tOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            </button>

            {tOpen && (
              <div className="border-t border-gray-100">
                {teacher.days.map(day => {
                  const dayKey = `${teacher.id}-${day.dayIndex}`;
                  const dOpen = !!openDays[dayKey];
                  return (
                    <div key={day.dayIndex} className="border-b border-gray-50 last:border-0">
                      <button onClick={() => toggleDay(dayKey)}
                        className="w-full flex items-center justify-between px-5 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-indigo-400" />
                          <span className="text-sm font-600 text-gray-700" style={{ fontWeight: 600 }}>{day.dayLabel}</span>
                          <span className="text-xs text-gray-400">{day.slots.length} saat</span>
                        </div>
                        <ChevronRight size={13} className="text-gray-400 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                      </button>

                      {dOpen && (
                        <div className="px-5 py-1.5 space-y-1.5">
                          {day.slots.map((s, i) => {
                            const sel = selectableBranchesFor ? selectableBranchesFor(s) : (s.branches || []);
                            return (
                              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-100 hover:border-indigo-200 transition-colors">
                                <div className="flex items-center gap-2">
                                  <Clock size={12} className="text-indigo-400 shrink-0" />
                                  <span className="text-xs font-600 text-gray-700" style={{ fontWeight: 600 }}>{s.slotLabel}</span>
                                </div>
                                {sel.length === 1 ? (
                                  <button onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, branch: sel[0] })}
                                    className="btn-primary !px-3 !py-1 text-xs">
                                    {sel[0]} · Al
                                  </button>
                                ) : (
                                  <div className="flex gap-1 flex-wrap justify-end">
                                    {sel.map(b => (
                                      <button key={b} onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, branch: b })}
                                        className="btn-primary !px-2.5 !py-1 text-[11px]">
                                        {b}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── STUDENT BOOKINGS VIEW ─────────────────────────────────────────────────────
export function StudentBookingsView({ student, allSlots, onCancel }) {
  const [openDays, setOpenDays] = useState({});

  const bookedByLabel = { student: 'Öğrenci', teacher: 'Öğretmen', director: 'Müdür' };
  const bookedByColor = {
    student: 'bg-indigo-100 text-indigo-600',
    teacher: 'bg-emerald-100 text-emerald-600',
    director: 'bg-amber-100 text-amber-600',
  };

  const days = useMemo(() => {
    const bookedSlots = allSlots.filter(s => s.booked && s.studentId === student.id);
    const map = {};
    for (const s of bookedSlots) {
      if (!map[s.day]) map[s.day] = { dayIndex: s.day, dayLabel: s.dayLabel, slots: [] };
      map[s.day].slots.push(s);
    }
    return Object.values(map)
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map(d => ({ ...d, slots: d.slots.sort((a, b) => a.slotId.localeCompare(b.slotId)) }));
  }, [allSlots, student.id]);

  const toggleDay = key => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  if (days.length === 0) {
    return <div className="text-center py-8 text-gray-400"><BookOpen size={28} className="mx-auto mb-2 opacity-30" /><p>Bu hafta hiç etüt yok</p></div>;
  }

  return (
    <div className="space-y-2">
      {days.map(day => {
        const dOpen = !!openDays[day.dayIndex];
        return (
          <div key={day.dayIndex} className="card overflow-hidden">
            <button onClick={() => toggleDay(day.dayIndex)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-700 shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', fontWeight: 700 }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">{day.slots.length} etüt</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            </button>

            {dOpen && (
              <div className="border-t border-gray-100 px-4 py-2 space-y-1.5">
                {day.slots.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-3 min-w-0">
                      <Clock size={13} className="text-indigo-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-600 text-gray-800" style={{ fontWeight: 600 }}>{s.slotLabel}</div>
                        <div className="text-[11px] text-gray-500 truncate">{s.teacherName} · {s.branch}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {s.fixed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-600 bg-violet-100 text-violet-600" style={{ fontWeight: 600 }}>Sabit</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${bookedByColor[s.bookedBy] || bookedByColor.student}`} style={{ fontWeight: 500 }}>
                        {bookedByLabel[s.bookedBy] || 'Öğrenci'}
                      </span>
                      {onCancel && (
                        <button onClick={() => onCancel({ teacherId: s.teacherId, day: s.day, slotId: s.slotId })}
                          className="p-1 rounded hover:bg-red-100 transition-colors" title="İptal et">
                          <X size={13} className="text-red-400" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── STUDENT GUIDANCE PANEL ────────────────────────────────────────────────────
function StudentGuidancePanel({ session, showToast }) {
  const subjects = useMemo(() => guidanceSubjectsFor(session.cls), [session.cls]);
  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [submittedAt, setSubmittedAt] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/guidance');
        setEntries(data.entries || {});
        setReviewed(!!data.reviewed);
        setSubmittedAt(data.submittedAt || null);
      } catch (e) { showToast(e.message, 'error'); }
      setLoading(false);
    })();
  }, []);

  function setVal(subject, field, value) {
    const v = value === '' ? '' : Math.max(0, parseInt(value) || 0);
    setEntries(prev => ({
      ...prev,
      [subject]: { ...(prev[subject] || { correct: '', wrong: '', empty: '' }), [field]: v },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload = {};
      for (const [subject, val] of Object.entries(entries)) {
        if (!val) continue;
        const c = parseInt(val.correct) || 0;
        const w = parseInt(val.wrong) || 0;
        const em = parseInt(val.empty) || 0;
        if (c === 0 && w === 0 && em === 0) continue;
        payload[subject] = { correct: c, wrong: w, empty: em };
      }
      await api('/api/guidance', { method: 'POST', body: JSON.stringify({ entries: payload }) });
      setReviewed(false);
      setSubmittedAt(new Date().toISOString());
      showToast('Rehberlik bilgileri kaydedildi');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">Yükleniyor...</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-700 text-gray-800" style={{ fontWeight: 700 }}>Bu Haftaki Soru Sayıları</h3>
          <p className="text-xs text-gray-400 mt-0.5">Her ders için çözdüğün soru sayılarını gir, hafta sonunda müdür inceleyecek.</p>
        </div>
        {submittedAt && (
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-600 ${reviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`} style={{ fontWeight: 600 }}>
            {reviewed ? 'İncelendi' : 'İnceleme bekliyor'}
          </span>
        )}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs text-gray-500 font-600 py-2.5 px-3" style={{ fontWeight: 600 }}>Ders</th>
              <th className="text-center text-xs text-emerald-600 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Doğru</th>
              <th className="text-center text-xs text-red-600 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Yanlış</th>
              <th className="text-center text-xs text-gray-500 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Boş</th>
              <th className="text-center text-xs text-indigo-600 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Toplam</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map(subject => {
              const val = entries[subject] || { correct: '', wrong: '', empty: '' };
              const total = (parseInt(val.correct) || 0) + (parseInt(val.wrong) || 0) + (parseInt(val.empty) || 0);
              return (
                <tr key={subject} className="border-t border-gray-50">
                  <td className="px-3 py-2 text-sm text-gray-700 font-500" style={{ fontWeight: 500 }}>{subject}</td>
                  <td className="px-2 py-2"><input type="number" min="0" inputMode="numeric" value={val.correct} onChange={e => setVal(subject, 'correct', e.target.value)}
                    className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1.5 focus:border-emerald-400 focus:outline-none" /></td>
                  <td className="px-2 py-2"><input type="number" min="0" inputMode="numeric" value={val.wrong} onChange={e => setVal(subject, 'wrong', e.target.value)}
                    className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1.5 focus:border-red-400 focus:outline-none" /></td>
                  <td className="px-2 py-2"><input type="number" min="0" inputMode="numeric" value={val.empty} onChange={e => setVal(subject, 'empty', e.target.value)}
                    className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1.5 focus:border-gray-400 focus:outline-none" /></td>
                  <td className="px-2 py-2 text-center text-sm font-700 text-indigo-700" style={{ fontWeight: 700 }}>{total > 0 ? total : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <button onClick={handleSave} disabled={saving}
          className="btn-primary w-full sm:w-auto !px-6 !py-2.5 flex items-center justify-center gap-1.5">
          <Save size={14} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}

// ─── STUDENT EXPANDED VIEW (Rehberlik Details) ──────────────────────────────────
export function StudentGuidancePanelWrapper({ session, showToast }) {
  return <StudentGuidancePanel session={session} showToast={showToast} />;
}

// ─── MAIN STUDENT PANEL ────────────────────────────────────────────────────────
export default function StudentPanel({ session, showToast }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [tab, setTab] = useState('available');

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const slotsData = await api(`/api/slots?week=${resolvedWeek}`);
      setAllSlots(slotsData.slots || []);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const teachers = useMemo(() => {
    const seen = new Set();
    return allSlots.filter(s => { if (seen.has(s.teacherId)) return false; seen.add(s.teacherId); return true; })
      .map(s => ({ id: s.teacherId, name: s.teacherName }));
  }, [allSlots]);

  const myBookings = useMemo(() => allSlots.filter(s => s.booked && s.studentId === session.id), [allSlots, session.id]);
  const studentAllowedBranches = useMemo(() => allowedBranchesForClass(session.cls), [session.cls]);
  const bookedBranches = useMemo(() => new Set(myBookings.map(b => b.branch).filter(Boolean)), [myBookings]);
  const mathTaken = useMemo(() => myBookings.some(b => MATH_FAMILY.includes(b.branch)), [myBookings]);

  const selectableBranchesFor = useCallback((s) => {
    return (s.branches || []).filter(b => {
      if (!studentAllowedBranches.includes(b)) return false;
      if (bookedBranches.has(b)) return false;
      if (MATH_FAMILY.includes(b) && mathTaken) return false;
      return true;
    });
  }, [studentAllowedBranches, bookedBranches, mathTaken]);

  const available = useMemo(() => {
    return allSlots.filter(s => {
      if (s.booked || s.disabled) return false;
      if (!s.allowedGroups || s.allowedGroups.length === 0) return false;
      if (!s.allowedGroups.includes(session.group)) return false;
      if (isSlotPast(weekKey, s.day, s.slotLabel)) return false;
      if (myBookings.some(b => b.day === s.day && b.slotId === s.slotId)) return false;
      const sel = selectableBranchesFor(s);
      if (sel.length === 0) return false;
      if (filterBranch && !sel.includes(filterBranch)) return false;
      if (filterTeacher && s.teacherId !== filterTeacher) return false;
      if (filterDay !== '' && s.day !== parseInt(filterDay)) return false;
      return true;
    });
  }, [allSlots, myBookings, session, selectableBranchesFor, filterBranch, filterTeacher, filterDay, weekKey]);

  const handleBook = async ({ teacherId, day, slotId, branch }) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify({ teacherId, day, slotId, weekKey, branch }) });
      showToast('Etüde kaydoldunuz!');
      loadData(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async ({ teacherId, day, slotId }) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ teacherId, day, slotId, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      loadData(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{classLabel(session.cls)} · {GROUPS[session.group]}</p>
        <WeekNav weekKey={weekKey} onPrev={() => { const w = getAdjacentWeek(weekKey,-1); setWeekKey(w); loadData(w); }} onNext={() => { const w = getAdjacentWeek(weekKey,1); setWeekKey(w); loadData(w); }} />
      </div>

      <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-xl w-fit">
        {[['available','Müsait Etütler'],['myBookings','Etütlerim'],['rehberlik','Rehberlik']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab===key?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight: 600 }}>
            {label}
            {key==='myBookings' && myBookings.length>0 && <span className="ml-1.5 badge" style={{ background:'#6366f1',color:'white' }}>{myBookings.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'rehberlik' ? (
        <RehberlikAccordion
          subjects={guidanceSubjectsFor(session.cls)}
          editable={true}
          studentId={null}
          solvedContent={<StudentGuidancePanel session={session} showToast={showToast} />}
        />
      ) : tab === 'myBookings' ? (
        <StudentBookingsView student={{ id: session.id }} allSlots={allSlots} onCancel={handleCancel} />
      ) : (
        <div>
          {/* Filters Bar */}
          <div className="grid grid-cols-3 gap-2.5 mb-4">
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className="w-full text-xs border border-gray-200 rounded-xl px-2 py-2 bg-white">
              <option value="">Ders Seç...</option>
              {studentAllowedBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)} className="w-full text-xs border border-gray-200 rounded-xl px-2 py-2 bg-white">
              <option value="">Öğretmen...</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select value={filterDay} onChange={e => setFilterDay(e.target.value)} className="w-full text-xs border border-gray-200 rounded-xl px-2 py-2 bg-white">
              <option value="">Gün Seç...</option>
              {ALL_DAYS.map(d => <option key={d.index} value={d.index}>{d.label}</option>)}
            </select>
          </div>
          <AvailableTree available={available} onBook={handleBook} selectableBranchesFor={selectableBranchesFor} />
        </div>
      )}
    </div>
  );
}
