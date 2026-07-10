'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingBox from './Loading';
import EmptyState from './EmptyState';
import {
  BookOpen, Calendar, Clock, Save, X, ClipboardList
} from 'lucide-react';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import ResourceLibrary from './library/ResourceLibrary';
import { AnnouncementInbox } from './announcements/Announcements';
import { OdevStudent } from './odev/Odev';
import { TakvimView } from './etkinlik/Takvim';
import { FormRespond } from './form/Formlar';
import { DavranisView } from './davranis/Davranis';
import { useUrlTab } from './useUrlTab';
import { useClasses } from './ClassesContext';
import { classLabelFrom, coursesForClass } from '@/lib/classCatalog';
import {
  allowedBranchesForClass,
  MATH_FAMILY,
  classLabel,
  getWeekKey,
  weekRangeLabel,
  ALL_DAYS
} from '@/lib/constants';
import { api, getAdjacentWeek, isSlotPast, WeekNav } from './shared';

// Helper API Fetcher

// Helper: haftalık gezinme hesaplayıcı

// Helper: ders saati geçip geçmediğini denetleme


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
    return <EmptyState card icon={Calendar} title="Uygun etüt bulunamadı" description="Bu hafta için seçebileceğin etüt yok." />;
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
                  <div className="font-700 text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{teacher.name}</div>
                  <div className="text-caption">{teacher.branches.join(', ')} · {totalSlots} boş saat</div>
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
                                  <button onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, branch: sel[0], kind: s.kind, etutId: s.etutId })}
                                    className="btn-primary !px-3 !py-1 text-xs">
                                    {sel[0]} · Al
                                  </button>
                                ) : (
                                  <div className="flex gap-1 flex-wrap justify-end">
                                    {sel.map(b => (
                                      <button key={b} onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, branch: b, kind: s.kind, etutId: s.etutId })}
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

  const bookedByLabel = { student: 'Öğrenci', teacher: 'Öğretmen', director: 'Müdür', counselor: 'Rehber' };
  const bookedByColor = {
    student: 'bg-indigo-100 text-indigo-600',
    teacher: 'bg-emerald-100 text-emerald-600',
    director: 'bg-amber-100 text-amber-600',
    counselor: 'bg-amber-100 text-amber-600',
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
    return <EmptyState compact icon={BookOpen} title="Bu hafta hiç etüt yok" />;
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
                  <div className="font-700 text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{day.dayLabel}</div>
                  <div className="text-caption">{day.slots.length} etüt</div>
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
                        <div className="text-xs font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.slotLabel}</div>
                        <div className="text-caption truncate">{s.teacherName} · {s.branch}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {s.fixed && (
                        <span className="badge" style={{ background: 'color-mix(in srgb, #7c3aed 12%, transparent)', color: '#7c3aed' }}>Sabit</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${bookedByColor[s.bookedBy] || bookedByColor.student}`} style={{ fontWeight: 500 }}>
                        {bookedByLabel[s.bookedBy] || 'Öğrenci'}
                      </span>
                      {onCancel && (
                        <button onClick={() => onCancel({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, kind: s.kind, etutId: s.etutId })}
                          className="btn-icon btn-icon-danger" title="İptal et">
                          <X size={13} />
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

  if (loading) return <LoadingBox height="h-48" />;

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
export default function StudentPanel({ session, showToast, externalTab, onExternalTabChange, selfBookingAllowed = true }) {
  const { classes } = useClasses();
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [tab, setTabInternal] = useUrlTab('available', ['available', 'myBookings', 'odev', 'davranis', 'rehberlik', 'kutuphane', 'duyurular', 'takvim', 'formlar']);

  useEffect(() => {
    if (externalTab && externalTab !== tab) setTabInternal(externalTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTab]);

  const setTab = useCallback((key) => {
    setTabInternal(key);
    onExternalTabChange?.(key);
  }, [setTabInternal, onExternalTabChange]);

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      // Sadece yeni serbest etüt şablonları (eski slot-etüt /api/slots emekli edildi — Faz 7c-3).
      const etutData = await api(`/api/etut-sablon/all?week=${resolvedWeek}`);
      // Yeni etütleri slot-benzeri şekle çevir (AvailableTree/BookingsView aynı bileşeni kullanır).
      const etutList = (etutData.etutler || []).map(e => ({
        kind: 'etut',
        etutId: e.id,
        teacherId: e.teacherId,
        teacherName: e.teacherName,
        branches: e.branches || [],
        allowedGroups: e.allowedGroups || [],
        day: e.dayIndex,
        dayLabel: e.dayLabel,
        start: e.start,
        end: e.end,
        slotId: `etut:${e.id}`,
        slotLabel: `${e.start}–${e.end}`,
        booked: e.booked,
        disabled: false,
        studentId: e.studentId,
        studentName: e.studentName,
        branch: e.branch,
        bookedBy: e.bookedBy || (e.studentId ? 'student' : undefined),
      }));
      setAllSlots(etutList);
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
  // Registry'de şubenin ders listesi varsa onu kullan (özel şube/özel ders), yoksa constants fallback.
  const studentAllowedBranches = useMemo(
    () => coursesForClass(classes, session.cls) ?? allowedBranchesForClass(session.cls),
    [classes, session.cls]
  );
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

  const handleBook = async ({ teacherId, branch, etutId }) => {
    try {
      await api('/api/etut-sablon/rezervasyon', { method: 'POST', body: JSON.stringify({ teacherId, etutId, branch, weekKey }) });
      showToast('Etüde kaydoldunuz!');
      loadData(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async ({ teacherId, etutId }) => {
    try {
      await api('/api/etut-sablon/rezervasyon', { method: 'DELETE', body: JSON.stringify({ teacherId, etutId }) });
      showToast('Rezervasyon iptal edildi');
      loadData(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading) return <LoadingBox height="h-64" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{classLabelFrom(classes, session.cls, classLabel)} · {GROUPS[session.group]}</p>
        <WeekNav weekKey={weekKey} onPrev={() => { const w = getAdjacentWeek(weekKey,-1); setWeekKey(w); loadData(w); }} onNext={() => { const w = getAdjacentWeek(weekKey,1); setWeekKey(w); loadData(w); }} />
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
      ) : tab === 'odev' ? (
        <OdevStudent showToast={showToast} />
      ) : tab === 'kutuphane' ? (
        <ResourceLibrary canManage={false} userRole="student" userId={session.id} showToast={showToast} />
      ) : tab === 'duyurular' ? (
        <AnnouncementInbox showToast={showToast} />
      ) : tab === 'takvim' ? (
        <TakvimView />
      ) : tab === 'formlar' ? (
        <FormRespond showToast={showToast} />
      ) : tab === 'davranis' ? (
        <DavranisView />
      ) : !selfBookingAllowed ? (
        <div className="card p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Etüt rezervasyonu kurumunuz tarafından kapatılmıştır. Etütleriniz öğretmen veya rehberiniz tarafından planlanır.
          </p>
          <p className="text-caption mt-2">Planlanan etütlerinizi <b>"Etütlerim"</b> sekmesinden görebilirsiniz.</p>
        </div>
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
