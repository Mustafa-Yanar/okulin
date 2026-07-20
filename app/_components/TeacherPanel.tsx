'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingBox from './Loading';
import EmptyState from './EmptyState';
import {
  Calendar, ClipboardList, User, ChevronRight, Users, LayoutGrid, List, GraduationCap, Clock, X, BookOpen, Megaphone
} from 'lucide-react';
import {
  ALL_DAYS,
  getWeekKey,
  classLabel,
  allowedBranchesForClass,
  daySlots as buildDaySlots
} from '@/lib/constants';
import { subjectMatchesBranch } from '@/lib/deneme/branch';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import SlotGrid, { type BookArgs } from './SlotGrid';
import ResourceLibrary from './library/ResourceLibrary';
import { AnnouncementInbox } from './announcements/Announcements';
import { OdevManager } from './odev/Odev';
import { TakvimView } from './etkinlik/Takvim';
import { FormRespond } from './form/Formlar';
import { DavranisManager } from './davranis/Davranis';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';
import { useSlotTimes } from './SlotTimesContext';
import { useClasses } from './ClassesContext';
import { subjectsForClass } from './student-logic';
import { classShortUpper, groupStudentsByClass, coursesForClass } from '@/lib/classCatalog';
import { useUrlTab } from './useUrlTab';
import PanelHero from './PanelHero';
import { api, getAdjacentWeek, isSlotPast, WeekNav } from './shared';
import type { Session } from '@/lib/auth';
import type { SlotCell as SlotCellData, ProgramEntry } from '@/lib/slots';
import type { ShowToast, StudentDTO } from './types';

// Helper API Fetcher

// Helper: haftalık gezinme hesaplayıcı

// Helper: ders saati geçip geçmediğini denetleme

// /api/slots grid + /api/program ızgara şekilleri.
type TeacherGrid = Record<number, SlotCellData[]>;
type ProgramGrid = Record<string, Record<string, ProgramEntry | null>>;

// Liste görünümündeki rezervasyon satırı (grid'den düzleştirilir).
interface BookedItem {
  dayIndex: number;
  dayLabel: string;
  slotId: string;
  slotLabel: string;
  slotIdx: number;
  studentName?: string | null;
  studentCls?: string;
  studentId?: string | null;
  bookedBy: string;
  fixed: boolean;
}

// GET /api/etut-sablon/all satırı (yoklamaya giren birebir etütler).
interface EtutAllDTO {
  id: string;
  teacherId: string;
  dayIndex: number;
  start?: string;
  end?: string;
  branch?: string;
  studentId?: string | null;
  studentName?: string | null;
  studentCls?: string | null;
}

// Lucide Chevron Icon Helpers inside WeekNav
function ChevronLeft({ size, className }: { size: number; className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m15 18-6-6 6-6"/></svg>;
}

const GROUPS: Record<string, string> = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

interface TeacherBookingsListProps {
  bookedList: BookedItem[];
  listColorMap: Record<string, { badge: string; label: string }>;
  onCancel: (item: BookedItem) => void;
  canCancelAll?: boolean;
}

export function TeacherBookingsList({ bookedList, listColorMap, onCancel, canCancelAll }: TeacherBookingsListProps) {
  const [openDays, setOpenDays] = useState<Record<string | number, boolean>>({});
  const { slotTimes } = useSlotTimes();
  const toggleDay = (key: string | number) => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  const days = useMemo(() => {
    const map: Record<number, { dayIndex: number; dayLabel: string; items: BookedItem[] }> = {};
    for (const item of bookedList) {
      if (!map[item.dayIndex]) map[item.dayIndex] = { dayIndex: item.dayIndex, dayLabel: item.dayLabel, items: [] };
      map[item.dayIndex].items.push(item);
    }
    return Object.values(map).sort((a, b) => a.dayIndex - b.dayIndex);
  }, [bookedList]);

  if (days.length === 0) {
    return (
      <EmptyState card icon={Calendar} title="Bu hafta hiç rezervasyon yok" description="Öğrenciler etüt aldıkça burada görünür." />
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
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))' }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{day.dayLabel}</div>
                  <div className="text-caption">{day.items.length} öğrenci</div>
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
                        <Clock size={13} className="text-brand shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{item.slotLabel}</div>
                          <div className="text-caption truncate">{item.studentName} · {item.studentCls}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {item.fixed && (
                          <span className="badge" style={{ background: 'color-mix(in srgb, #7c3aed 12%, transparent)', color: '#7c3aed' }}>Sabit</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${c.badge}`} style={{ fontWeight: 500 }}>{c.label}</span>
                        {canCancel && (
                          <button onClick={() => onCancel(item)} className="btn-icon btn-icon-danger" title="İptal et">
                            <X size={13} />
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

interface TeacherAttendancePanelProps {
  session: Session;
  weekKey: string;
  showToast: ShowToast;
}

function TeacherAttendancePanel({ session, weekKey, showToast }: TeacherAttendancePanelProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (görünüm)
  const [program, setProgram] = useState<ProgramGrid | null>(null);
  const [etutler, setEtutler] = useState<EtutAllDTO[]>([]); // bu öğretmenin bu hafta efektif aktif + öğrenci atanmış etütleri
  const [students, setStudents] = useState<StudentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDays, setOpenDays] = useState<Record<string | number, boolean>>({});
  const [openLessons, setOpenLessons] = useState<Record<string, boolean>>({});
  const [attendance, setAttendance] = useState<Record<string, Record<string, string>>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
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

  function dateForDay(dayIndex: number): string {
    const d = new Date(mondayYMD);
    d.setUTCDate(mondayYMD.getUTCDate() + dayIndex);
    return d.toISOString().slice(0, 10);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [progData, stuData, etutData] = await Promise.all([
          api<{ program?: ProgramGrid }>(`/api/program?teacherId=${session.id}&week=${weekKey}`),
          api<StudentDTO[]>('/api/students'),
          api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${weekKey}`).catch(() => ({ etutler: [] as EtutAllDTO[] })),
        ]);
        setProgram(progData?.program || {});
        setStudents(stuData);
        // Sadece bu öğretmenin, öğrenci atanmış (booked) etütleri yoklamaya girer.
        setEtutler((etutData.etutler || []).filter(e => e.teacherId === session.id && e.studentId));
      } catch (err) {
        showToast((err as Error).message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [session.id, weekKey]);

  const days = useMemo(() => {
    if (!program) return [];
    return ALL_DAYS.map(day => {
      const dayProg = program[String(day.index)] || {};
      const slots = buildDaySlots(day.index, slotTimes.days?.[day.index]);
      const lessons: { lessonNo: number; cls: string }[] = [];
      let lessonNo = 0;
      for (const slot of slots) {
        const entry = dayProg[slot.id];
        if (entry?.type === 'ders' && entry.cls) {
          lessonNo++;
          lessons.push({ lessonNo, cls: entry.cls });
        }
      }
      // O günün serbest etütleri (birebir) — saat sırasına göre
      const dayEtuts = etutler
        .filter(e => e.dayIndex === day.index)
        .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      if (lessons.length === 0 && dayEtuts.length === 0) return null;
      return { dayIndex: day.index, dayLabel: day.label, lessons, etuts: dayEtuts };
    }).filter((d): d is NonNullable<typeof d> => Boolean(d));
  }, [program, slotTimes, etutler]);

  const studentsForCls = useCallback((cls: string) => {
    return students.filter(s => s.cls === cls);
  }, [students]);

  async function loadAttendance(date: string, cls: string, lessonNo: number | string) {
    const key = `${date}_${cls}_${lessonNo}`;
    if (attendance[key] !== undefined) return;
    try {
      const data = await api<Record<string, string>>(`/api/attendance?date=${date}&teacherId=${session.id}&cls=${cls}&lessonNo=${lessonNo}`);
      setAttendance(prev => ({ ...prev, [key]: data }));
    } catch {
      setAttendance(prev => ({ ...prev, [key]: {} }));
    }
  }

  function toggleDay(dayIndex: number) {
    setOpenDays(p => ({ ...p, [dayIndex]: !p[dayIndex] }));
  }

  function toggleLesson(dayIndex: number, lessonNo: number | string, cls: string) {
    const key = `${dayIndex}_${lessonNo}`;
    if (!openLessons[key]) {
      const date = dateForDay(dayIndex);
      loadAttendance(date, cls, lessonNo);
    }
    setOpenLessons(p => ({ ...p, [key]: !p[key] }));
  }

  function setStatus(date: string, cls: string, lessonNo: number | string, studentId: string, status: string) {
    const key = `${date}_${cls}_${lessonNo}`;
    setAttendance(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [studentId]: status },
    }));
  }

  async function saveAttendance(dayIndex: number, cls: string, lessonNo: number | string) {
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
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }

  const STATUS_OPTS = [
    { value: 'var', label: 'Var', active: 'bg-emerald-500 text-white border-emerald-500' },
    { value: 'gec', label: 'Geç', active: 'bg-amber-500 text-white border-amber-500' },
    { value: 'yok', label: 'Yok', active: 'bg-red-500 text-white border-red-500' },
  ];

  if (loading) return <LoadingBox height="h-40" />;

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
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))' }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">
                    {lessons.length} ders{day.etuts?.length ? ` · ${day.etuts.length} etüt` : ''}
                  </div>
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
                    <div key={lessonNo} className="time-block time-ders time-block--lead rounded-xl overflow-hidden">
                      <button onClick={() => toggleLesson(day.dayIndex, lessonNo, cls)}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-black/[0.03] transition-colors">
                        <div className="flex items-center gap-2">
                          <span className="time-block__title text-sm">{lessonNo}. Ders</span>
                          <span className="text-xs text-brand font-600" style={{ fontWeight: 600 }}>({classShortUpper(classes, cls)})</span>
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
                                            aria-pressed={current === opt.value}
                                            className={`text-xs px-3 py-2 min-h-[36px] rounded-lg border font-600 transition ${current === opt.value ? opt.active : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
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
                                className="w-full py-1.5 rounded-lg bg-brand text-white text-xs font-600 transition-colors disabled:opacity-60"
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

                {day.etuts?.map((e) => {
                  const lessonNo = `e${e.id}`;
                  const cls = e.studentCls || (students.find(s => s.id === e.studentId)?.cls) || '';
                  const lk = `${day.dayIndex}_${lessonNo}`;
                  const lOpen = !!openLessons[lk];
                  const attKey = `${date}_${cls}_${lessonNo}`;
                  const att = attendance[attKey] || {};
                  const current = att[e.studentId!];
                  return (
                    <div key={lessonNo} className="time-block time-etut time-block--lead rounded-xl overflow-hidden">
                      <button onClick={() => toggleLesson(day.dayIndex, lessonNo, cls)}
                        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-black/[0.03] transition-colors">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-600 shrink-0" style={{ fontWeight: 600, background: 'color-mix(in srgb, var(--time-etut) 22%, transparent)', color: 'var(--time-etut)' }}>ETÜT</span>
                          <span className="time-block__time text-xs shrink-0">{e.start}–{e.end}</span>
                          {e.branch && <span className="text-xs font-600 shrink-0" style={{ fontWeight: 600, color: 'var(--time-etut)' }}>{e.branch}</span>}
                          <span className="text-sm text-gray-800 truncate">{e.studentName}</span>
                        </div>
                        <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform" style={{ transform: lOpen ? 'rotate(90deg)' : 'rotate(0)' }} />
                      </button>

                      {lOpen && (
                        <div className="bg-white px-3 py-2">
                          <div className="flex items-center justify-between py-1 mb-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <User size={12} className="text-gray-400 shrink-0" />
                              <span className="text-sm text-gray-800 truncate">{e.studentName}</span>
                              {cls && <span className="text-xs text-gray-400">({classShortUpper(classes, cls)})</span>}
                            </div>
                            <div className="flex gap-1 shrink-0 ml-2">
                              {STATUS_OPTS.map(opt => (
                                <button key={opt.value}
                                  onClick={() => setStatus(date, cls, lessonNo, e.studentId!, opt.value)}
                                  aria-pressed={current === opt.value}
                                  className={`text-xs px-3 py-2 min-h-[36px] rounded-lg border font-600 transition ${current === opt.value ? opt.active : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                                  style={{ fontWeight: 600 }}>
                                  {opt.label}
                                </button>
                              ))}
                            </div>
                          </div>
                          <button
                            onClick={() => saveAttendance(day.dayIndex, cls, lessonNo)}
                            disabled={saving[attKey]}
                            className="w-full py-1.5 rounded-lg text-white text-xs font-600 transition-colors disabled:opacity-60"
                            style={{ fontWeight: 600, background: 'var(--time-etut)' }}>
                            {saving[attKey] ? 'Kaydediliyor...' : 'Etüt Yoklamasını Kaydet'}
                          </button>
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

interface TeacherStudentsViewProps {
  students: StudentDTO[];
  branches?: string[];
}

function TeacherStudentsView({ students, branches = [] }: TeacherStudentsViewProps) {
  const { classes, courses } = useClasses();
  const subjectMatchesAny = (subject: string) =>
    branches.length === 0 || branches.some(b => subjectMatchesBranch(subject, b));
  const filterSubjectsAny = (subjects: string[]) =>
    branches.length === 0 ? subjects : subjects.filter(subjectMatchesAny);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [openCls, setOpenCls] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');

  const grouped = useMemo(() => {
    const q = searchQ.toLowerCase();
    const filtered = students.filter(
      (s) =>
        (s.name.toLowerCase().includes(q) ||
          s.cls.toLowerCase().includes(q) ||
          s.username?.toLowerCase().includes(q)) &&
        (!filterGroup || s.group === filterGroup)
    );
    return groupStudentsByClass(filtered, classes, classLabel);
  }, [students, classes, searchQ, filterGroup]);

  const toggle = (cls: string) => setOpenCls(prev => prev === cls ? null : cls);

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
          <EmptyState card icon={GraduationCap} title="Öğrenci bulunamadı" />
        )}
        {grouped.map((grp) => {
          const isOpen = openCls === grp.cls;
          const dotColor =
            grp.group === 'lise'
              ? 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))'
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
                        className="w-full flex items-center gap-3 px-3 py-3 text-left bg-brand-soft-hover"
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
                            subjects={filterSubjectsAny(subjectsForClass(s.cls, classes, courses))}
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

// ── Etütler sekmesi ──────────────────────────────────────────────────────────
// Öğretmenin bu hafta EFEKTİF AKTİF serbest etüt slotları (boş + dolu). Öğretmen
// buradan kendi etüdüne öğrenci atar/kaldırır. Veri: /api/etut-sablon/all (kendi
// teacherId'sine süzülür); atama /api/etut-sablon/rezervasyon (bookEtut/cancelEtutV2
// servisi, teacher rolü kendi etüdüne yazma yetkili — lib/etut/booking.ts). Ders (branch)
// = öğretmenin branşları ∩ öğrencinin sınıf dersleri; tek adaysa otomatik seçilir.
interface TeacherEtutPanelProps {
  session: Session;
  students: StudentDTO[];
  showToast: ShowToast;
}

function TeacherEtutPanel({ session, students, showToast }: TeacherEtutPanelProps) {
  const { classes } = useClasses();
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [etutler, setEtutler] = useState<EtutAllDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignFor, setAssignFor] = useState<string | null>(null); // atanmakta olan etüt id
  const [selStudent, setSelStudent] = useState('');
  const [selBranch, setSelBranch] = useState('');
  const [busy, setBusy] = useState(false);

  const teacherBranches = useMemo(() => session.branches || [], [session.branches]);
  const allowedGroups = useMemo(() => session.allowedGroups || [], [session.allowedGroups]);
  // Bir öğrenciye bu öğretmenin verebileceği ders adayları (branş ∩ sınıf dersleri).
  // Registry-öncelikli (coursesForClass): özel şube s_UUID için constants parseInt→NaN bozuk.
  const candidatesFor = useCallback(
    (cls: string) => {
      const allowed = coursesForClass(classes, cls) ?? allowedBranchesForClass(cls);
      return teacherBranches.filter(b => allowed.includes(b));
    },
    [teacherBranches, classes]
  );
  // Atanabilir öğrenciler: öğretmenin grubuna açık + en az bir ders adayı olan.
  const eligibleStudents = useMemo(() =>
    students.filter(s =>
      (allowedGroups.length === 0 || allowedGroups.includes(s.group)) &&
      candidatesFor(s.cls).length > 0
    ), [students, allowedGroups, candidatesFor]);

  const load = useCallback(async (wk: string) => {
    setLoading(true);
    try {
      const data = await api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${wk}`)
        .catch(() => ({ etutler: [] as EtutAllDTO[] }));
      setEtutler((data.etutler || []).filter(e => e.teacherId === session.id));
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [session.id, showToast]);

  useEffect(() => { load(weekKey); }, [load, weekKey]);

  function resetAssign() { setAssignFor(null); setSelStudent(''); setSelBranch(''); }

  async function submitAssign(etutId: string) {
    const stu = students.find(s => s.id === selStudent);
    if (!stu) { showToast('Öğrenci seçin', 'error'); return; }
    const cands = candidatesFor(stu.cls);
    const branch = selBranch || (cands.length === 1 ? cands[0] : '');
    if (!branch) { showToast('Ders seçin', 'error'); return; }
    setBusy(true);
    try {
      await api('/api/etut-sablon/rezervasyon', {
        method: 'POST',
        body: JSON.stringify({ teacherId: session.id, etutId, studentId: selStudent, branch, weekKey }),
      });
      showToast('Öğrenci etüde atandı', 'success');
      resetAssign();
      load(weekKey);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function removeStudent(etutId: string) {
    setBusy(true);
    try {
      await api('/api/etut-sablon/rezervasyon', {
        method: 'DELETE',
        body: JSON.stringify({ teacherId: session.id, etutId }),
      });
      showToast('Öğrenci etütten kaldırıldı', 'success');
      load(weekKey);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const days = useMemo(() => {
    return ALL_DAYS.map(day => {
      const items = etutler
        .filter(e => e.dayIndex === day.index)
        .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
      if (items.length === 0) return null;
      return { dayIndex: day.index, dayLabel: day.label, items };
    }).filter((d): d is NonNullable<typeof d> => Boolean(d));
  }, [etutler]);

  const changeWeek = (dir: number) => setWeekKey(w => getAdjacentWeek(w, dir));

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        {(() => {
          const cw = getWeekKey();
          const maxW = getAdjacentWeek(getAdjacentWeek(cw, 1), 1);
          return (
            <WeekNav weekKey={weekKey}
              canPrev={weekKey !== cw}
              canNext={weekKey !== maxW}
              onPrev={() => changeWeek(-1)}
              onNext={() => changeWeek(1)} />
          );
        })()}
      </div>

      {loading ? (
        <LoadingBox height="h-40" />
      ) : days.length === 0 ? (
        <EmptyState card icon={Clock} title="Bu hafta tanımlı etüt yok"
          description="Serbest etüt slotları müdür panelinden (Program Editörü) oluşturulur." />
      ) : (
        <div className="space-y-2">
          {days.map(day => (
            <div key={day.dayIndex} className="card overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))' }}>
                  <Calendar size={15} />
                </div>
                <div className="font-700 text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{day.dayLabel}</div>
                <span className="text-caption ml-auto">{day.items.length} etüt</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {day.items.map(e => {
                  const assigned = !!e.studentId;
                  const isAssigning = assignFor === e.id;
                  const stu = students.find(s => s.id === selStudent);
                  const cands = stu ? candidatesFor(stu.cls) : [];
                  return (
                    <div key={e.id} className="time-block time-etut rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-600 shrink-0" style={{ fontWeight: 600, background: 'color-mix(in srgb, var(--time-etut) 22%, transparent)', color: 'var(--time-etut)' }}>ETÜT</span>
                          <span className="time-block__time text-xs shrink-0">{e.start}–{e.end}</span>
                          {assigned ? (
                            <>
                              {e.branch && <span className="text-xs font-600 shrink-0" style={{ fontWeight: 600, color: 'var(--time-etut)' }}>{e.branch}</span>}
                              <span className="text-sm text-gray-800 truncate">
                                {e.studentName}{e.studentCls ? ` · ${classShortUpper(classes, e.studentCls)}` : ''}
                              </span>
                            </>
                          ) : (
                            <span className="text-sm text-gray-400">Boş</span>
                          )}
                        </div>
                        <div className="shrink-0">
                          {assigned ? (
                            <button onClick={() => removeStudent(e.id)} disabled={busy}
                              className="btn-icon btn-icon-danger" title="Öğrenciyi kaldır">
                              <X size={13} />
                            </button>
                          ) : (
                            <button onClick={() => { if (isAssigning) { resetAssign(); } else { setAssignFor(e.id); setSelStudent(''); setSelBranch(''); } }}
                              className="text-xs px-3 py-1.5 rounded-lg font-600 text-white transition-colors"
                              style={{ fontWeight: 600, background: 'var(--time-etut)' }}>
                              {isAssigning ? 'Vazgeç' : 'Öğrenci ata'}
                            </button>
                          )}
                        </div>
                      </div>

                      {isAssigning && !assigned && (
                        <div className="bg-white px-3 py-2.5 border-t border-gray-100 space-y-2">
                          <select value={selStudent}
                            onChange={ev => { setSelStudent(ev.target.value); setSelBranch(''); }}
                            className="input text-sm">
                            <option value="">Öğrenci seç...</option>
                            {eligibleStudents.map(s => (
                              <option key={s.id} value={s.id}>{s.name} ({classShortUpper(classes, s.cls)})</option>
                            ))}
                          </select>
                          {selStudent && cands.length > 1 && (
                            <select value={selBranch}
                              onChange={ev => setSelBranch(ev.target.value)}
                              className="input text-sm">
                              <option value="">Ders seç...</option>
                              {cands.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          )}
                          <button onClick={() => submitAssign(e.id)} disabled={busy || !selStudent}
                            className="w-full py-2 rounded-lg text-white text-xs font-600 transition-colors disabled:opacity-60"
                            style={{ fontWeight: 600, background: 'var(--time-etut)' }}>
                            {busy ? 'Atanıyor...' : 'Ata'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface TeacherPanelProps {
  session: Session;
  showToast: ShowToast;
  externalTab?: string | null;
  onExternalTabChange?: (key: string) => void;
}

export default function TeacherPanel({ session, showToast, externalTab, onExternalTabChange }: TeacherPanelProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (liste görünümü)
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [slots, setSlots] = useState<TeacherGrid | null | undefined>(null);
  const [program, setProgram] = useState<ProgramGrid>({});
  const [students, setStudents] = useState<StudentDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTabInternal] = useUrlTab('rezervasyon', ['rezervasyon', 'etutler', 'yoklama', 'odev', 'davranis', 'ogrenciler', 'kutuphane', 'duyurular', 'takvim', 'formlar']);
  const [viewMode, setViewMode] = useState('table');
  const { slotTimes } = useSlotTimes();

  useEffect(() => {
    if (externalTab && externalTab !== activeTab) setActiveTabInternal(externalTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTab]);

  const setActiveTab = useCallback((key: string) => {
    setActiveTabInternal(key);
    onExternalTabChange?.(key);
  }, [setActiveTabInternal, onExternalTabChange]);

  const loadData = useCallback(async (wk?: string) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [slotsData, stuData, progData] = await Promise.all([
        api<{ weekKey?: string; grid?: TeacherGrid }>(`/api/slots?teacherId=${session.id}&week=${resolvedWeek}`),
        api<StudentDTO[]>('/api/students'),
        api<{ program?: ProgramGrid }>(`/api/program?teacherId=${session.id}`),
      ]);
      setSlots(slotsData.grid);
      setStudents(stuData);
      setProgram(progData?.program || {});
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [session.id, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleWeekChange = async (newWeek: string) => {
    setWeekKey(newWeek);
    const [slotsData, progData] = await Promise.all([
      api<{ weekKey?: string; grid?: TeacherGrid }>(`/api/slots?teacherId=${session.id}&week=${newWeek}`),
      api<{ program?: ProgramGrid }>(`/api/program?teacherId=${session.id}&week=${newWeek}`),
    ]);
    setSlots(slotsData.grid);
    setProgram(progData?.program || {});
  };

  const handleBook = async (params: BookArgs) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      handleWeekChange(params.weekKey || weekKey);
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  const handleCancel = async (params: { teacherId: string; day: number; slotId: string }) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      handleWeekChange(weekKey);
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  // Yalnız badge + label render ediliyor (TeacherBookingsList); tema-uyumlu pill sınıfları.
  const listColorMap: Record<string, { badge: string; label: string }> = {
    student:  { badge: 'tag-student',  label: 'Öğrenci' },
    teacher:  { badge: 'tag-teacher',  label: 'Öğretmen' },
    director: { badge: 'tag-director', label: 'Müdür' },
  };

  const bookedList = useMemo(() => {
    if (!slots) return [];
    const items: BookedItem[] = [];
    ALL_DAYS.forEach(day => {
      const daySlots = buildDaySlots(day.index, slotTimes.days?.[day.index]);
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
            studentCls: classShortUpper(classes, slotData.studentCls || ''),
            studentId: slotData.studentId,
            bookedBy: slotData.bookedBy || 'student',
            fixed: !!slotData.fixed,
          });
        }
      });
    });
    return items;
  }, [slots, slotTimes]);

  if (loading) return <LoadingBox height="h-64" />;

  return (
    <div>
      {activeTab === 'rezervasyon' && (
        <>
          <PanelHero name={session.name} />
          <div className="flex items-center justify-between mb-4">
            <div className="pill-tabs shrink-0">
              <button
                onClick={() => setViewMode('table')}
                className={`pill-tab${viewMode === 'table' ? ' is-active' : ''}`}>
                <LayoutGrid size={13} /> <span>Tablo</span>
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`pill-tab${viewMode === 'list' ? ' is-active' : ''}`}>
                <List size={13} /> <span>Liste</span>
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
                <SlotGrid grid={slots} program={program} teacher={{ id: session.id!, name: session.name, branches: session.branches || [], allowedGroups: session.allowedGroups }} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} hideEmptyDays />
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">✕ = kapalı saat &nbsp;·&nbsp; + = rezervasyon yapılabilir</p>
            </>
          ) : (
            <TeacherBookingsList bookedList={bookedList} listColorMap={listColorMap}
              onCancel={item => handleCancel({ teacherId: session.id!, day: item.dayIndex, slotId: item.slotId })} />
          )}
        </>
      )}

      {activeTab === 'etutler' && (
        <TeacherEtutPanel session={session} students={students} showToast={showToast} />
      )}

      {activeTab === 'yoklama' && (
        <TeacherAttendancePanel session={session} weekKey={getWeekKey()} showToast={showToast} />
      )}

      {activeTab === 'odev' && (
        <OdevManager showToast={showToast} userRole="teacher" userId={session.id} />
      )}

      {activeTab === 'ogrenciler' && (
        <TeacherStudentsView students={students} branches={session.branches || []} />
      )}

      {activeTab === 'kutuphane' && (
        <ResourceLibrary canManage userRole="teacher" userId={session.id}
          branches={session.branches || []} showToast={showToast} />
      )}

      {activeTab === 'duyurular' && (
        <AnnouncementInbox showToast={showToast} />
      )}

      {activeTab === 'takvim' && (
        <TakvimView />
      )}

      {activeTab === 'formlar' && (
        <FormRespond showToast={showToast} />
      )}

      {activeTab === 'davranis' && (
        <DavranisManager showToast={showToast} userRole={session.role} userId={session.id} />
      )}
    </div>
  );
}
