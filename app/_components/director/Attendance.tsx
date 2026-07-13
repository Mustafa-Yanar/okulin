'use client';

// Müdür yoklama bileşenleri: günlük sınıf özeti (DirectorAttendanceView),
// sınıf-gün detay modalı (AttendanceSummaryModal) ve öğrenci devamsızlık
// geçmişi (StudentAttendanceView).
import React, { useState, useEffect, useMemo } from 'react';
import { Phone, ClipboardList, GraduationCap } from 'lucide-react';
import { getWeekKey, ALL_DAYS } from '@/lib/constants';
import { api, Modal } from './shared';
import { useClasses } from '../ClassesContext';
import { classShort } from '@/lib/classCatalog';
import LoadingBox from '../Loading';
import type { ShowToast } from '../types';

// GET /api/attendance/summary — sınıf → ders → yok/geç listeleri.
interface AttSummaryStudent {
  id: string;
  name: string;
  parentPhone?: string;
  phone?: string;
}
interface AttLesson {
  lessonNo: number;   // öğretmen ders sırası (attendance anahtarı)
  slotNo?: number;    // sınıfın gerçek ders saati (görünüm) — özette bu gösterilir
  teacherName?: string;
  attendanceTaken?: boolean;
  absent: AttSummaryStudent[];
  late: AttSummaryStudent[];
}
interface ClsSummary {
  lessons: AttLesson[];
}
type AttendanceSummary = Record<string, ClsSummary>;

// GET /api/attendance/student satırı.
interface StudentAttEntry {
  date: string;
  dayLabel?: string;
  status: string;
  lessonNo?: number;
  slotLabel?: string;
  teacherName?: string;
  branch?: string;
  subBranch?: string;
}
interface StudentAttData {
  entries: StudentAttEntry[];
  summary: { yok: number; gec: number };
}

function AttendanceStudentRow({ student, variant }: { student: AttSummaryStudent; variant: string }) {
  const colors = variant === 'absent'
    ? { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-700', btn: 'bg-red-100 hover:bg-red-200 text-red-700' }
    : { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700', btn: 'bg-amber-100 hover:bg-amber-200 text-amber-700' };
  const telNumber = (student.parentPhone || student.phone || '').replace(/\s+/g, '');
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${colors.bg} border ${colors.border}`}>
      <span className={`text-sm font-500 ${colors.text}`} style={{ fontWeight: 500 }}>{student.name}</span>
      {telNumber ? (
        <a href={`tel:${telNumber}`} title={`Veliyi ara: ${telNumber}`}
          className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full ${colors.btn} transition-colors`}>
          <Phone size={14} />
        </a>
      ) : (
        <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-300" title="Telefon kayıtlı değil">
          <Phone size={14} />
        </span>
      )}
    </div>
  );
}

function AttendanceSummaryModal({ cls, label, date, onClose }: { cls: string; label: string; date: string; onClose: () => void }) {
  const [summary, setSummary] = useState<ClsSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api<AttendanceSummary>(`/api/attendance/summary?date=${date}`);
        setSummary(data[cls] || null);
      } catch {
        setSummary(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [cls, date]);

  const dayName = (() => {
    const d = new Date(date);
    const names = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    return names[d.getDay()];
  })();

  return (
    <Modal title={`${label} – ${dayName} Yoklama Özeti`} onClose={onClose}>
      {loading ? (
        <LoadingBox height="h-32" />
      ) : !summary || summary.lessons.length === 0 ? (
        <div className="py-8 text-center text-gray-400">
          <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Bu gün için yoklama kaydı yok.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {summary.lessons.map((lesson, i) => {
            const hasAbsent = lesson.absent.length > 0;
            const hasLate = lesson.late.length > 0;
            const dersNo = lesson.slotNo ?? lesson.lessonNo;
            if (!lesson.attendanceTaken) return (
              <div key={i} className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                <div className="text-xs font-600 text-amber-700 mb-1" style={{ fontWeight: 600 }}>{dersNo}. Ders <span className="font-400 text-amber-500">· {lesson.teacherName}</span></div>
                <p className="text-xs text-amber-600">Yoklama henüz alınmamış.</p>
              </div>
            );
            if (!hasAbsent && !hasLate) return (
              <div key={i} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="text-xs font-600 mb-1" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{dersNo}. Ders <span className="font-400" style={{ color: 'var(--text-muted)' }}>· {lesson.teacherName}</span></div>
                <p className="text-xs text-emerald-600">Tüm öğrenciler mevcut.</p>
              </div>
            );
            return (
              <div key={i} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="text-xs font-600 text-gray-600 mb-2" style={{ fontWeight: 600 }}>{dersNo}. Ders <span className="text-gray-400 font-400">· {lesson.teacherName}</span></div>
                {hasAbsent && (
                  <div className="mb-2">
                    <span className="text-[10px] font-600 text-red-500 uppercase tracking-wide" style={{ fontWeight: 600 }}>Yok ({lesson.absent.length})</span>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {lesson.absent.map(s => (
                        <AttendanceStudentRow key={s.id} student={s} variant="absent" />
                      ))}
                    </div>
                  </div>
                )}
                {hasLate && (
                  <div>
                    <span className="text-[10px] font-600 text-amber-500 uppercase tracking-wide" style={{ fontWeight: 600 }}>Geç ({lesson.late.length})</span>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {lesson.late.map(s => (
                        <AttendanceStudentRow key={s.id} student={s} variant="late" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

export function DirectorAttendanceView({ showToast }: { showToast?: ShowToast }) {
  const { classes } = useClasses();
  const today = new Date();
  const jsDay = today.getDay();
  const todayIndex = jsDay === 0 ? 6 : jsDay - 1;

  const [selectedDay, setSelectedDay] = useState(todayIndex);
  const [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedCls, setSelectedCls] = useState<string | null>(null);

  // Bu haftanın pazartesisi (gün kutucuklarının tarih sayısı buradan türer).
  const weekMonday = useMemo(() => {
    const wk = getWeekKey();
    const [year, wStr] = wk.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    return mon;
  }, []);

  const dayDate = (idx: number) => {
    const d = new Date(weekMonday);
    d.setUTCDate(weekMonday.getUTCDate() + idx);
    return d;
  };

  const dateForSelectedDay = useMemo(
    () => dayDate(selectedDay).toISOString().slice(0, 10),
    [selectedDay, weekMonday]
  );

  useEffect(() => {
    (async () => {
      setLoading(true);
      setSummary(null);
      try {
        const data = await api<AttendanceSummary>(`/api/attendance/summary?date=${dateForSelectedDay}`);
        setSummary(data);
      } catch (err) {
        showToast?.((err as Error).message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [dateForSelectedDay]);

  const clsList = summary ? Object.keys(summary).sort() : [];

  return (
    <div>
      {/* Haftalık gün şeridi (Figma Date & Time ilhamı): gün adı + tarih kutucuğu. */}
      <div className="flex gap-1.5 mb-5">
        {ALL_DAYS.map(day => {
          const active = selectedDay === day.index;
          const isToday = day.index === todayIndex;
          return (
            <button key={day.index} onClick={() => setSelectedDay(day.index)}
              className="flex-1 min-w-0 rounded-xl px-1 py-2 flex flex-col items-center gap-0.5 transition border"
              style={{
                background: active ? 'var(--brand, #6366f1)' : 'var(--bg-surface)',
                borderColor: active ? 'var(--brand, #6366f1)'
                  : isToday ? 'color-mix(in srgb, var(--brand, #6366f1) 45%, transparent)'
                  : 'var(--border-light)',
                color: active ? '#fff' : 'var(--text-secondary)',
                boxShadow: active ? '0 2px 8px color-mix(in srgb, var(--brand,#6366f1) 30%, transparent)' : 'none',
              }}>
              <span className="text-[10px] font-600 uppercase tracking-wide opacity-80" style={{ fontWeight: 600 }}>
                {day.short}
              </span>
              <span className="text-base font-700 leading-none" style={{ fontWeight: 700 }}>
                {dayDate(day.index).getUTCDate()}
              </span>
              <span className="text-[9px] leading-none h-2.5" style={{ color: active ? 'rgba(255,255,255,0.85)' : 'var(--text-muted)' }}>
                {isToday ? 'Bugün' : ''}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <LoadingBox height="h-40" />
      ) : clsList.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          <p>Bu gün için tanımlı ders bulunmuyor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {clsList.map(cls => {
            const data = summary![cls];
            const totalAbsent = data.lessons.reduce((n, l) => n + l.absent.length, 0);
            const totalLate = data.lessons.reduce((n, l) => n + l.late.length, 0);
            const takenCount = data.lessons.filter(l => l.attendanceTaken).length;
            const totalCount = data.lessons.length;
            const allTaken = takenCount === totalCount;
            return (
              <button key={cls} onClick={() => setSelectedCls(cls)}
                className="card card-interactive aspect-square flex flex-col items-center justify-center gap-1.5 cursor-pointer p-3">
                <GraduationCap size={20} className="text-brand" />
                <span className="text-sm font-700 text-gray-900" style={{ fontWeight: 700 }}>{classShort(classes, cls)}</span>
                <div className="flex flex-wrap gap-1 justify-center">
                  {totalAbsent > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-600" style={{ fontWeight: 600 }}>{totalAbsent} yok</span>
                  )}
                  {totalLate > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-600" style={{ fontWeight: 600 }}>{totalLate} geç</span>
                  )}
                  {totalAbsent === 0 && totalLate === 0 && allTaken && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-600" style={{ fontWeight: 600 }}>Tam</span>
                  )}
                  {!allTaken && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-600" style={{ fontWeight: 600 }}>{takenCount}/{totalCount}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedCls && (
        <AttendanceSummaryModal cls={selectedCls} label={classShort(classes, selectedCls)} date={dateForSelectedDay} onClose={() => setSelectedCls(null)} />
      )}
    </div>
  );
}

export function StudentAttendanceView({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentAttData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<StudentAttData>(`/api/attendance/student?studentId=${studentId}`);
        setData(d);
      } catch {
        setData({ entries: [], summary: { yok: 0, gec: 0 } });
      }
      setLoading(false);
    })();
  }, [studentId]);

  if (loading) return <LoadingBox height="h-32" />;
  if (!data || data.entries.length === 0) return (
    <div className="py-8 text-center text-gray-400">
      <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
      <p className="text-sm">Devamsızlık kaydı yok</p>
    </div>
  );

  const byDate: Record<string, StudentAttEntry[]> = {};
  for (const e of data.entries) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        {data.summary.yok > 0 && (
          <span className="badge badge-danger">
            {data.summary.yok} Yok
          </span>
        )}
        {data.summary.gec > 0 && (
          <span className="badge badge-warning">
            {data.summary.gec} Geç
          </span>
        )}
        <span className="text-caption ml-1">Toplam {data.entries.length} kayıt</span>
      </div>
      <div className="space-y-1.5">
        {Object.entries(byDate).map(([date, items]) => {
          const d = new Date(date);
          const fmtDate = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
          return (
            <div key={date} className="card overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <span className="font-700 text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fmtDate}</span>
                <span className="text-caption ml-2">{items[0].dayLabel}</span>
              </div>
              <div className="p-2 space-y-1">
                {items.map((e, i) => {
                  const statusClass = e.status === 'yok'
                    ? 'bg-red-50 border-red-100 text-red-700'
                    : 'bg-amber-50 border-amber-100 text-amber-700';
                  return (
                    <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${statusClass}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-700 shrink-0 ${e.status === 'yok' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`} style={{ fontWeight: 700 }}>
                          {e.status === 'yok' ? 'YOK' : 'GEÇ'}
                        </span>
                        <span className="text-xs font-600 shrink-0" style={{ fontWeight: 600 }}>{e.lessonNo}. Ders</span>
                        {e.slotLabel && <span className="text-xs opacity-70 shrink-0">({e.slotLabel})</span>}
                      </div>
                      <span className="text-xs opacity-70 text-right truncate ml-2">
                        {e.teacherName}{(e.subBranch || e.branch) ? ` · ${e.subBranch || e.branch}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
