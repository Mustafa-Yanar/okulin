'use client';

// Öğrenci detay görünümü (StudentExpandedView) + sınıf ders programı modalı
// (ClassScheduleModal). İkisi de SinifOgrenci tarafından kullanılır.
import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, ClipboardList, Clock, Calendar, Download } from 'lucide-react';
import SchedulePrint, { type ScheduleDay, type ScheduleLesson } from '../program/SchedulePrint';
import type { LucideIcon } from 'lucide-react';
import { ALL_DAYS } from '@/lib/constants';
import { classShortUpper } from '@/lib/classCatalog';
import { useClasses } from '../ClassesContext';
import { api, Modal } from './shared';
import { subjectsForClass } from '../student-logic';
import { StudentAttendanceView } from './Attendance';
import StudentEtutTab from './StudentEtutTab';
import RehberlikAccordion from '../rehberlik/RehberlikAccordion';
import StudentGuidanceView from '../rehberlik/StudentGuidanceView';
import type { ShowToast, StudentDTO } from '../types';

// Panel öğrencisi: DTO + loadAll'un eklediği group alanı.
type ListStudent = StudentDTO & { group?: string };

// GET /api/class-schedule ders hücresi.
interface ClassLessonDTO {
  slotId: string;
  slotLabel?: string;
  teacherName?: string;
  branch?: string;
  subBranch?: string;
}

interface StudentExpandedViewProps {
  student: ListStudent;
  readOnly?: boolean;
  showToast: ShowToast;
  onGuidanceReviewed?: () => void;
}

export function StudentExpandedView({ student, readOnly, showToast, onGuidanceReviewed }: StudentExpandedViewProps) {
  const [tab, setTab] = useState('rehberlik');
  const { classes, courses } = useClasses();
  return (
    <div className="px-3 py-2">
      <div className="pill-tabs mb-3">
        {([
          ['rehberlik', 'Rehberlik', BookOpen],
          ['devamsizlik', 'Devamsızlık Bilgisi', ClipboardList],
          ['etut', 'Etüt Geçmişi', Clock],
        ] as [string, string, LucideIcon][]).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`pill-tab${tab === key ? ' is-active' : ''}`}>
            <Icon size={12} /> <span>{label}</span>
          </button>
        ))}
      </div>
      {tab === 'etut' && (
        <StudentEtutTab student={student} readOnly={readOnly} showToast={showToast} />
      )}
      {tab === 'devamsizlik' && (
        <StudentAttendanceView studentId={student.id} />
      )}
      {tab === 'rehberlik' && (
        <RehberlikAccordion
          subjects={subjectsForClass(student.cls, classes, courses)}
          editable={true}
          studentId={student.id}
          solvedContent={<StudentGuidanceView studentId={student.id} onReviewed={onGuidanceReviewed} />}
        />
      )}
    </div>
  );
}

interface ClassScheduleModalProps {
  cls: string;
  label?: string;
  onClose: () => void;
}

export function ClassScheduleModal({ cls, label, onClose }: ClassScheduleModalProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (başlık fallback)
  const [schedule, setSchedule] = useState<Record<number, ClassLessonDTO[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPrint, setShowPrint] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api<{ schedule?: Record<number, ClassLessonDTO[]> }>(`/api/class-schedule?cls=${encodeURIComponent(cls)}`);
        setSchedule(data.schedule || {});
      } catch (e) {
        setSchedule({});
        setLoadError('Ders programı yüklenemedi: ' + (e as Error).message);
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
    const dayLessons: Record<number, ClassLessonDTO[]> = {};
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
    const result: { lessonNo: number; byDay: Record<number, ClassLessonDTO | null> }[] = [];
    for (let i = 0; i < maxLessons; i++) {
      const row: { lessonNo: number; byDay: Record<number, ClassLessonDTO | null> } = { lessonNo: i + 1, byDay: {} };
      for (const day of visibleDays) {
        row.byDay[day.index] = dayLessons[day.index][i] || null;
      }
      result.push(row);
    }
    return result;
  }, [schedule, visibleDays]);

  // PDF çıktısı verisi (sınıf perspektifi: hücrede öğretmen adı).
  const classDays: ScheduleDay[] = ALL_DAYS.map(day => ({
    dayIndex: day.index, dayLabel: day.short, weekend: day.weekend,
    lessons: (schedule?.[day.index] || []).map((l): ScheduleLesson => ({ main: l.subBranch || l.branch || 'Ders', sub: l.teacherName || '', time: l.slotLabel || '', slotId: l.slotId })),
  }));

  return (
    <Modal title={`${label || classShortUpper(classes, cls)} – Ders Programı`} onClose={onClose} wide>
      {loadError && (
        <div className="card p-3 mb-3 text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{loadError}</div>
      )}
      {!loading && visibleDays.length > 0 && (
        <div className="flex justify-end mb-3">
          <button onClick={() => setShowPrint(true)} className="btn-ghost !px-3 !py-1.5 text-sm flex items-center gap-1.5">
            <Download size={14} /> PDF İndir
          </button>
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-caption">Yükleniyor...</div>
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
                  <th key={day.index} className={`text-center py-2 px-2 font-600 ${day.weekend ? 'text-brand' : 'text-gray-600'}`} style={{ fontWeight: 600 }}>
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
                        <div className="time-block time-ders rounded-lg py-1.5 px-2 text-center">
                          <div className="time-block__title text-[11px] truncate">{lesson.subBranch || lesson.branch}</div>
                          <div className="time-block__sub text-[9px] truncate">{lesson.teacherName}</div>
                          <div className="time-block__time text-[9px] truncate">{lesson.slotLabel}</div>
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
      {showPrint && (
        <SchedulePrint title="Ders Programı" subtitle={label || classShortUpper(classes, cls)} days={classDays} onClose={() => setShowPrint(false)} />
      )}
    </Modal>
  );
}

