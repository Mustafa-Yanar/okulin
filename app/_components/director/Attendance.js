'use client';

// Müdür yoklama bileşenleri: günlük sınıf özeti (DirectorAttendanceView),
// sınıf-gün detay modalı (AttendanceSummaryModal) ve öğrenci devamsızlık
// geçmişi (StudentAttendanceView).
import React, { useState, useEffect, useMemo } from 'react';
import { Phone, ClipboardList, GraduationCap } from 'lucide-react';
import { getWeekKey, ALL_DAYS } from '@/lib/constants';
import { api, Modal } from './shared';

function AttendanceStudentRow({ student, variant }) {
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

function AttendanceSummaryModal({ cls, date, onClose }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api(`/api/attendance/summary?date=${date}`);
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
    <Modal title={`${cls.toUpperCase()} – ${dayName} Yoklama Özeti`} onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Yükleniyor...</div>
      ) : !summary || summary.lessons.length === 0 ? (
        <div className="py-8 text-center text-gray-400">
          <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Bu gün için yoklama kaydı yok.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {summary.lessons.map(lesson => {
            const hasAbsent = lesson.absent.length > 0;
            const hasLate = lesson.late.length > 0;
            if (!lesson.attendanceTaken) return (
              <div key={lesson.lessonNo} className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                <div className="text-xs font-600 text-amber-700 mb-1" style={{ fontWeight: 600 }}>{lesson.lessonNo}. Ders <span className="text-amber-500 font-400">· {lesson.teacherName}</span></div>
                <p className="text-xs text-amber-600">Yoklama henüz alınmamış.</p>
              </div>
            );
            if (!hasAbsent && !hasLate) return (
              <div key={lesson.lessonNo} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="text-xs font-600 text-gray-600 mb-1" style={{ fontWeight: 600 }}>{lesson.lessonNo}. Ders <span className="text-gray-400 font-400">· {lesson.teacherName}</span></div>
                <p className="text-xs text-emerald-600">Tüm öğrenciler mevcut.</p>
              </div>
            );
            return (
              <div key={lesson.lessonNo} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="text-xs font-600 text-gray-600 mb-2" style={{ fontWeight: 600 }}>{lesson.lessonNo}. Ders <span className="text-gray-400 font-400">· {lesson.teacherName}</span></div>
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

export function DirectorAttendanceView({ showToast }) {
  const today = new Date();
  const jsDay = today.getDay();
  const todayIndex = jsDay === 0 ? 6 : jsDay - 1;

  const [selectedDay, setSelectedDay] = useState(todayIndex);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedCls, setSelectedCls] = useState(null);

  const dateForSelectedDay = useMemo(() => {
    const wk = getWeekKey();
    const [year, wStr] = wk.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    mon.setUTCDate(mon.getUTCDate() + selectedDay);
    return mon.toISOString().slice(0, 10);
  }, [selectedDay]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setSummary(null);
      try {
        const data = await api(`/api/attendance/summary?date=${dateForSelectedDay}`);
        setSummary(data);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [dateForSelectedDay]);

  const clsList = summary ? Object.keys(summary).sort() : [];

  return (
    <div>
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {ALL_DAYS.map(day => (
          <button key={day.index} onClick={() => setSelectedDay(day.index)}
            className={`px-3 py-1.5 rounded-lg text-xs font-600 transition-all border ${selectedDay === day.index ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
            style={{ fontWeight: 600 }}>
            {day.label}
            {day.index === todayIndex && <span className="ml-1 text-[10px] opacity-70">Bugün</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400">Yükleniyor...</div>
      ) : clsList.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          <p>Bu gün için tanımlı ders bulunmuyor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {clsList.map(cls => {
            const data = summary[cls];
            const totalAbsent = data.lessons.reduce((n, l) => n + l.absent.length, 0);
            const totalLate = data.lessons.reduce((n, l) => n + l.late.length, 0);
            const takenCount = data.lessons.filter(l => l.attendanceTaken).length;
            const totalCount = data.lessons.length;
            const allTaken = takenCount === totalCount;
            return (
              <button key={cls} onClick={() => setSelectedCls(cls)}
                className="card aspect-square flex flex-col items-center justify-center gap-1.5 hover:shadow-lg hover:border-indigo-400 hover:-translate-y-px hover:bg-indigo-50/30 transition-all duration-200 cursor-pointer p-3">
                <GraduationCap size={20} className="text-indigo-400" />
                <span className="text-sm font-700 text-gray-900" style={{ fontWeight: 700 }}>{cls.toUpperCase()}</span>
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
        <AttendanceSummaryModal cls={selectedCls} date={dateForSelectedDay} onClose={() => setSelectedCls(null)} />
      )}
    </div>
  );
}

export function StudentAttendanceView({ studentId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api(`/api/attendance/student?studentId=${studentId}`);
        setData(d);
      } catch {
        setData({ entries: [], summary: { yok: 0, gec: 0 } });
      }
      setLoading(false);
    })();
  }, [studentId]);

  if (loading) return <div className="py-8 text-center text-gray-400 text-sm">Yükleniyor...</div>;
  if (!data || data.entries.length === 0) return (
    <div className="py-8 text-center text-gray-400">
      <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
      <p className="text-sm">Devamsızlık kaydı yok</p>
    </div>
  );

  const byDate = {};
  for (const e of data.entries) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        {data.summary.yok > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-600" style={{ fontWeight: 600 }}>
            {data.summary.yok} Yok
          </span>
        )}
        {data.summary.gec > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-600" style={{ fontWeight: 600 }}>
            {data.summary.gec} Geç
          </span>
        )}
        <span className="text-xs text-gray-400 ml-1">Toplam {data.entries.length} kayıt</span>
      </div>
      <div className="space-y-1.5">
        {Object.entries(byDate).map(([date, items]) => {
          const d = new Date(date);
          const fmtDate = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
          return (
            <div key={date} className="card overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <span className="font-700 text-sm text-gray-800" style={{ fontWeight: 700 }}>{fmtDate}</span>
                <span className="text-xs text-gray-400 ml-2">{items[0].dayLabel}</span>
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
