'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Calendar, ClipboardList, User, ChevronRight, Users, LayoutGrid, List, GraduationCap, Clock, X
} from 'lucide-react';
import {
  ALL_DAYS,
  getWeekKey,
  classLabel,
  slotsForDay
} from '@/lib/constants';
import { subjectMatchesBranch } from '@/lib/deneme/branch';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import SlotGrid from './SlotGrid';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';
import { useSlotTimes } from './SlotTimesContext';

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
  try {
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
  } catch {
    return false;
  }
}

function WeekNav({ weekKey, onPrev, onNext, canPrev = true, canNext = true }) {
  // Simple label calculation locally
  const { startStr, endStr } = useMemo(() => {
    try {
      const [year, wStr] = weekKey.split('-W');
      const week = parseInt(wStr);
      const jan4 = new Date(parseInt(year), 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const monday = new Date(jan4);
      monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const months = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
      return {
        startStr: `${monday.getDate()} ${months[monday.getMonth()]}`,
        endStr: `${sunday.getDate()} ${months[sunday.getMonth()]}`
      };
    } catch {
      return { startStr: '', endStr: '' };
    }
  }, [weekKey]);

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

export function TeacherBookingsList({ bookedList, listColorMap, onCancel, canCancelAll }) {
  const [openDays, setOpenDays] = useState({});
  const { slotTimes } = useSlotTimes();
  const toggleDay = key => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  const days = useMemo(() => {
    const map = {};
    for (const item of bookedList) {
      if (!map[item.dayIndex]) map[item.dayIndex] = { dayIndex: item.dayIndex, dayLabel: item.dayLabel, items: [] };
      map[item.dayIndex].items.push(item);
    }
    return Object.values(map).sort((a, b) => a.dayIndex - b.dayIndex);
  }, [bookedList]);

  if (days.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">
        <Calendar size={32} className="mx-auto mb-2 opacity-30" />
        <p>Bu hafta hiç rezervasyon yok</p>
      </div>
    );
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
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">{day.items.length} öğrenci</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            </button>
            {dOpen && (
              <div className="border-t border-gray-100 px-4 py-2 space-y-1.5">
                {day.items.map((item, i) => {
                  const c = listColorMap[item.bookedBy] || listColorMap.student;
                  const canCancel = canCancelAll || item.bookedBy === 'teacher';
                  return (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                      <div className="flex items-center gap-3 min-w-0">
                        <Clock size={13} className="text-indigo-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-600 text-gray-800" style={{ fontWeight: 600 }}>{item.slotLabel}</div>
                          <div className="text-[11px] text-gray-500 truncate">{item.studentName} · {item.studentCls}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {item.fixed && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-600 bg-violet-100 text-violet-600" style={{ fontWeight: 600 }}>Sabit</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${c.badge}`} style={{ fontWeight: 500 }}>{c.label}</span>
                        {canCancel && (
                          <button onClick={() => onCancel(item)} className="p-1 rounded hover:bg-red-100 transition-colors" title="İptal et">
                            <X size={13} className="text-red-400" />
                          </button>
                        )}
                      </div>
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

function TeacherAttendancePanel({ session, weekKey, showToast }) {
  const [program, setProgram] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDays, setOpenDays] = useState({});
  const [openLessons, setOpenLessons] = useState({});
  const [attendance, setAttendance] = useState({});
  const [saving, setSaving] = useState({});
  const { slotTimes } = useSlotTimes();

  const mondayYMD = useMemo(() => {
    const [year, wStr] = weekKey.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    return mon;
  }, [weekKey]);

  function dateForDay(dayIndex) {
    const d = new Date(mondayYMD);
    d.setUTCDate(mondayYMD.getUTCDate() + dayIndex);
    return d.toISOString().slice(0, 10);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [progData, stuData] = await Promise.all([
          api(`/api/program?teacherId=${session.id}&week=${weekKey}`),
          api('/api/students'),
        ]);
        setProgram(progData?.program || {});
        setStudents(stuData);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [session.id, weekKey]);

  const days = useMemo(() => {
    if (!program) return [];
    return ALL_DAYS.map(day => {
      const dayProg = program[String(day.index)] || {};
      const slots = slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday);
      const lessons = [];
      let lessonNo = 0;
      for (const slot of slots) {
        const entry = dayProg[slot.id];
        if (entry?.type === 'ders' && entry.cls) {
          lessonNo++;
          lessons.push({ lessonNo, cls: entry.cls });
        }
      }
      if (lessons.length === 0) return null;
      return { dayIndex: day.index, dayLabel: day.label, lessons };
    }).filter(Boolean);
  }, [program, slotTimes]);

  const studentsForCls = useCallback((cls) => {
    return students.filter(s => s.cls === cls);
  }, [students]);

  async function loadAttendance(date, cls, lessonNo) {
    const key = `${date}_${cls}_${lessonNo}`;
    if (attendance[key] !== undefined) return;
    try {
      const data = await api(`/api/attendance?date=${date}&teacherId=${session.id}&cls=${cls}&lessonNo=${lessonNo}`);
      setAttendance(prev => ({ ...prev, [key]: data }));
    } catch {
      setAttendance(prev => ({ ...prev, [key]: {} }));
    }
  }

  function toggleDay(dayIndex) {
    setOpenDays(p => ({ ...p, [dayIndex]: !p[dayIndex] }));
  }

  function toggleLesson(dayIndex, lessonNo, cls) {
    const key = `${dayIndex}_${lessonNo}`;
    if (!openLessons[key]) {
      const date = dateForDay(dayIndex);
      loadAttendance(date, cls, lessonNo);
    }
    setOpenLessons(p => ({ ...p, [key]: !p[key] }));
  }

  function setStatus(date, cls, lessonNo, studentId, status) {
    const key = `${date}_${cls}_${lessonNo}`;
    setAttendance(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [studentId]: status },
    }));
  }

  async function saveAttendance(dayIndex, cls, lessonNo) {
    const date = dateForDay(dayIndex);
    const key = `${date}_${cls}_${lessonNo}`;
    setSaving(p => ({ ...p, [key]: true }));
    try {
      await api('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ date, cls, lessonNo, attendance: attendance[key] || {} }),
      });
      showToast('Yoklama kaydedildi', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }

  const STATUS_OPTS = [
    { value: 'var', label: 'Var', active: 'bg-emerald-500 text-white border-emerald-500' },
    { value: 'gec', label: 'Geç', active: 'bg-amber-500 text-white border-amber-500' },
    { value: 'yok', label: 'Yok', active: 'bg-red-500 text-white border-red-500' },
  ];

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Yükleniyor...</div>;

  if (days.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">
        <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
        <p>Bu hafta için ders programı tanımlanmamış.</p>
        <p className="text-xs mt-1">Müdür panelinden ders programı oluşturulmalı.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {days.map(day => {
        const dOpen = !!openDays[day.dayIndex];
        const lessons = day.lessons;
        const date = dateForDay(day.dayIndex);
        return (
          <div key={day.dayIndex} className="card overflow-hidden">
            <button onClick={() => toggleDay(day.dayIndex)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">{lessons.length} ders</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0)' }} />
            </button>

            {dOpen && (
              <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                {lessons.map(({ lessonNo, cls }) => {
                  const lk = `${day.dayIndex}_${lessonNo}`;
                  const lOpen = !!openLessons[lk];
                  const stuList = studentsForCls(cls);
                  const attKey = `${date}_${cls}_${lessonNo}`;
                  const att = attendance[attKey] || {};

                  return (
                    <div key={lessonNo} className="rounded-xl overflow-hidden border border-gray-100">
                      <button onClick={() => toggleLesson(day.dayIndex, lessonNo, cls)}
                        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-600 text-gray-800" style={{ fontWeight: 600 }}>{lessonNo}. Ders</span>
                          <span className="text-xs text-indigo-600 font-600" style={{ fontWeight: 600 }}>({cls.toUpperCase()})</span>
                          <span className="text-xs text-gray-400">{stuList.length} öğrenci</span>
                        </div>
                        <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform" style={{ transform: lOpen ? 'rotate(90deg)' : 'rotate(0)' }} />
                      </button>

                      {lOpen && (
                        <div className="bg-white px-3 py-2">
                          {stuList.length === 0 ? (
                            <p className="text-xs text-gray-400 py-1">Bu sınıfta kayıtlı öğrenci yok.</p>
                          ) : (
                            <>
                              <div className="space-y-1 mb-2">
                                {stuList.map(student => {
                                  const current = att[student.id];
                                  return (
                                    <div key={student.id} className="flex items-center justify-between py-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <User size={12} className="text-gray-400 shrink-0" />
                                        <span className="text-sm text-gray-800 truncate">{student.name}</span>
                                      </div>
                                      <div className="flex gap-1 shrink-0 ml-2">
                                        {STATUS_OPTS.map(opt => (
                                          <button key={opt.value}
                                            onClick={() => setStatus(date, cls, lessonNo, student.id, opt.value)}
                                            className={`text-[11px] px-2.5 py-1 rounded-lg border font-600 transition-all ${current === opt.value ? opt.active : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                                            style={{ fontWeight: 600 }}>
                                            {opt.label}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              <button
                                onClick={() => saveAttendance(day.dayIndex, cls, lessonNo)}
                                disabled={saving[attKey]}
                                className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-600 hover:bg-indigo-700 transition-colors disabled:opacity-60"
                                style={{ fontWeight: 600 }}>
                                {saving[attKey] ? 'Kaydediliyor...' : `${lessonNo}. Ders Yoklamasını Kaydet`}
                              </button>
                            </>
                          )}
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

function TeacherStudentsView({ students, branches = [] }) {
  const subjectMatchesAny = (subject) =>
    branches.length === 0 || branches.some(b => subjectMatchesBranch(subject, b));
  const filterSubjectsAny = (subjects) =>
    branches.length === 0 ? subjects : subjects.filter(subjectMatchesAny);
  const [expandedId, setExpandedId] = useState(null);
  const [openCls, setOpenCls] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');

  const grouped = useMemo(() => {
    const q = searchQ.toLowerCase();
    const groupOrder = { ortaokul: 0, lise: 1, mezun: 2 };
    const clsSort = (cls) => (cls.startsWith('m') ? parseInt(cls.slice(1)) : parseInt(cls));
    const sorted = students
      .filter(
        (s) =>
          (s.name.toLowerCase().includes(q) ||
            s.cls.toLowerCase().includes(q) ||
            s.username?.toLowerCase().includes(q)) &&
          (!filterGroup || s.group === filterGroup)
      )
      .sort((a, b) => {
        const gDiff = (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
        if (gDiff !== 0) return gDiff;
        return clsSort(a.cls) - clsSort(b.cls);
      });
    const groups = [];
    for (const s of sorted) {
      if (!groups.length || groups[groups.length - 1].cls !== s.cls) {
        groups.push({ cls: s.cls, label: classLabel(s.cls), group: s.group, students: [] });
      }
      groups[groups.length - 1].students.push(s);
    }
    return groups;
  }, [students, searchQ, filterGroup]);

  const toggle = (cls) => setOpenCls(prev => prev === cls ? null : cls);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input
          className="input text-sm"
          placeholder="İsim, sınıf..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <select
          className="input !w-auto text-sm"
          value={filterGroup}
          onChange={(e) => setFilterGroup(e.target.value)}
        >
          <option value="">Tüm Gruplar</option>
          {Object.entries(GROUPS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        {grouped.length === 0 && (
          <div className="card p-8 text-center text-gray-400">
            <GraduationCap size={32} className="mx-auto mb-2 opacity-30" />
            <p>Öğrenci bulunamadı</p>
          </div>
        )}
        {grouped.map((grp) => {
          const isOpen = openCls === grp.cls;
          const dotColor =
            grp.group === 'lise'
              ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
              : grp.group === 'ortaokul'
              ? 'linear-gradient(135deg,#22c55e,#16a34a)'
              : 'linear-gradient(135deg,#f59e0b,#d97706)';
          return (
            <div key={grp.cls}>
              <button
                onClick={() => toggle(grp.cls)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-700 bg-slate-200 text-slate-700 hover:bg-slate-300 transition-colors"
                style={{ fontWeight: 700 }}
              >
                <span>
                  {grp.label}{' '}
                  <span className="font-500 opacity-60" style={{ fontWeight: 500 }}>
                    ({grp.students.length} öğrenci)
                  </span>
                </span>
                <ChevronRight
                  size={14}
                  className="transition-transform"
                  style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                />
              </button>
              {isOpen && (
                <div className="grid gap-1.5 mt-1.5 ml-2">
                  {grp.students.map((s) => (
                    <div key={s.id} className="card overflow-hidden text-sm">
                      <button
                        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-indigo-50/30"
                        onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                      >
                        <div
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-700 shrink-0"
                          style={{ background: dotColor, fontWeight: 700 }}
                        >
                          {s.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-600 truncate" style={{ fontWeight: 600 }}>
                          {s.name}
                        </span>
                        <ChevronRight
                          size={14}
                          className="text-gray-400 shrink-0 transition-transform ml-auto"
                          style={{ transform: expandedId === s.id ? 'rotate(90deg)' : 'rotate(0deg)' }}
                        />
                      </button>
                      {expandedId === s.id && (
                        <div className="border-t border-gray-100 bg-gray-50 px-3 py-3">
                          <RehberlikAccordion
                            subjects={filterSubjectsAny(guidanceSubjectsFor(s.cls))}
                            editable={false}
                            studentId={s.id}
                            solvedContent={
                              <StudentGuidanceView
                                studentId={s.id}
                                readOnly
                                branchFilter={subjectMatchesAny}
                              />
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TeacherPanel({ session, showToast }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [slots, setSlots] = useState(null);
  const [program, setProgram] = useState({});
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('rezervasyon');
  const [viewMode, setViewMode] = useState('table');
  const { slotTimes } = useSlotTimes();

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [slotsData, stuData, progData] = await Promise.all([
        api(`/api/slots?teacherId=${session.id}&week=${resolvedWeek}`),
        api('/api/students'),
        api(`/api/program?teacherId=${session.id}`),
      ]);
      setSlots(slotsData.grid);
      setStudents(stuData);
      setProgram(progData?.program || {});
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [session.id, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleWeekChange = async (newWeek) => {
    setWeekKey(newWeek);
    const [slotsData, progData] = await Promise.all([
      api(`/api/slots?teacherId=${session.id}&week=${newWeek}`),
      api(`/api/program?teacherId=${session.id}&week=${newWeek}`),
    ]);
    setSlots(slotsData.grid);
    setProgram(progData?.program || {});
  };

  const handleBook = async (params) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      handleWeekChange(params.weekKey || weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async (params) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      handleWeekChange(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const listColorMap = {
    student: { bg: 'bg-indigo-50', border: 'border-indigo-100', day: 'text-indigo-700', time: 'text-indigo-400', div: 'bg-indigo-200', badge: 'bg-indigo-100 text-indigo-500', label: 'Öğrenci' },
    teacher: { bg: 'bg-emerald-50', border: 'border-emerald-100', day: 'text-emerald-700', time: 'text-emerald-400', div: 'bg-emerald-200', badge: 'bg-emerald-100 text-emerald-600', label: 'Öğretmen' },
    director: { bg: 'bg-amber-50', border: 'border-amber-100', day: 'text-amber-700', time: 'text-amber-400', div: 'bg-amber-200', badge: 'bg-amber-100 text-amber-600', label: 'Müdür' },
  };

  const bookedList = useMemo(() => {
    if (!slots) return [];
    const items = [];
    ALL_DAYS.forEach(day => {
      const daySlots = slotsForDay(day.index, day.index >= 5 ? slotTimes.weekend : slotTimes.weekday);
      daySlots.forEach((slot, slotIdx) => {
        const slotData = slots[day.index]?.[slotIdx];
        if (slotData?.booked) {
          items.push({
            dayIndex: day.index,
            dayLabel: day.label,
            slotId: slot.id,
            slotLabel: slot.label,
            slotIdx,
            studentName: slotData.studentName,
            studentCls: (slotData.studentCls || '').toUpperCase(),
            studentId: slotData.studentId,
            bookedBy: slotData.bookedBy || 'student',
            fixed: !!slotData.fixed,
          });
        }
      });
    });
    return items;
  }, [slots, slotTimes]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-4 w-fit">
        <button
          onClick={() => setActiveTab('rezervasyon')}
          className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors font-600 ${activeTab === 'rezervasyon' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          style={{ fontWeight: 600 }}>
          <Calendar size={13} /> Program
        </button>
        <button
          onClick={() => setActiveTab('yoklama')}
          className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors font-600 ${activeTab === 'yoklama' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          style={{ fontWeight: 600 }}>
          <ClipboardList size={13} /> Yoklama
        </button>
        <button
          onClick={() => setActiveTab('ogrenciler')}
          className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors font-600 ${activeTab === 'ogrenciler' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          style={{ fontWeight: 600 }}>
          <Users size={13} /> Öğrenciler
        </button>
      </div>

      {activeTab === 'rezervasyon' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                <LayoutGrid size={13} /> Tablo
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                <List size={13} /> Liste
              </button>
            </div>
            {(() => {
              const cw = getWeekKey();
              const maxW = getAdjacentWeek(getAdjacentWeek(cw, 1), 1);
              return (
                <WeekNav weekKey={weekKey}
                  canPrev={weekKey !== cw}
                  canNext={weekKey !== maxW}
                  onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))}
                  onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
              );
            })()}
          </div>
          {viewMode === 'table' ? (
            <>
              <div className="card p-4">
                <SlotGrid grid={slots} program={program} teacher={{ id: session.id, name: session.name, branches: session.branches || [], allowedGroups: session.allowedGroups }} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} hideEmptyDays />
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">✕ = kapalı saat &nbsp;·&nbsp; + = rezervasyon yapılabilir</p>
            </>
          ) : (
            <TeacherBookingsList bookedList={bookedList} listColorMap={listColorMap}
              onCancel={item => handleCancel({ teacherId: session.id, day: item.dayIndex, slotId: item.slotId })} />
          )}
        </>
      )}

      {activeTab === 'yoklama' && (
        <TeacherAttendancePanel session={session} weekKey={getWeekKey()} showToast={showToast} />
      )}

      {activeTab === 'ogrenciler' && (
        <TeacherStudentsView students={students} branches={session.branches || []} />
      )}
    </div>
  );
}
