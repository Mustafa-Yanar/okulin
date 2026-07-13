'use client';

import { useState, useEffect, useMemo } from 'react';
import { Calendar, Download } from 'lucide-react';
import { ALL_DAYS } from '@/lib/constants';
import { api } from './shared';
import SchedulePrint, { type ScheduleDay, type ScheduleLesson } from './program/SchedulePrint';

// Salt-okunur sınıf ders programı tablosu. Öğrenci kendi (session.cls), veli çocuğunun
// (child.cls) programını görür. Sınıf kilidi API'de (class-schedule) uygulanır; burada
// cls yalnız sorgu içindir. Müdürün ClassScheduleModal'ıyla aynı veriyi gösterir.

interface ClassLessonDTO {
  slotId: string;
  slotLabel?: string;
  teacherName?: string;
  branch?: string;
  subBranch?: string;
}

export default function ClassScheduleView({ cls }: { cls?: string }) {
  const [schedule, setSchedule] = useState<Record<number, ClassLessonDTO[]> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => {
    if (!cls) { setSchedule({}); setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const data = await api<{ schedule?: Record<number, ClassLessonDTO[]> }>(`/api/class-schedule?cls=${encodeURIComponent(cls)}`);
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
    const dayLessons: Record<number, ClassLessonDTO[]> = {};
    let maxLessons = 0;
    for (const day of visibleDays) {
      const list = [...(schedule[day.index] || [])];
      list.sort((a, b) => parseInt(a.slotId.replace(/\D/g, '')) - parseInt(b.slotId.replace(/\D/g, '')));
      dayLessons[day.index] = list;
      if (list.length > maxLessons) maxLessons = list.length;
    }
    const result: { lessonNo: number; byDay: Record<number, ClassLessonDTO | null> }[] = [];
    for (let i = 0; i < maxLessons; i++) {
      const row: { lessonNo: number; byDay: Record<number, ClassLessonDTO | null> } = { lessonNo: i + 1, byDay: {} };
      for (const day of visibleDays) row.byDay[day.index] = dayLessons[day.index][i] || null;
      result.push(row);
    }
    return result;
  }, [schedule, visibleDays]);

  if (loading) return <div className="flex items-center justify-center h-32 text-caption">Yükleniyor...</div>;

  if (visibleDays.length === 0) {
    return (
      <div className="py-10 text-center text-gray-400">
        <Calendar size={28} className="mx-auto mb-2 opacity-30" />
        <p className="text-sm">Henüz ders programı tanımlanmamış.</p>
      </div>
    );
  }

  // PDF çıktısı verisi (sınıf perspektifi: hücrede öğretmen adı).
  const classDays: ScheduleDay[] = ALL_DAYS.map(day => ({
    dayIndex: day.index, dayLabel: day.short, weekend: day.weekend,
    lessons: (schedule?.[day.index] || []).map((l): ScheduleLesson => ({ main: l.teacherName || '', sub: l.subBranch || l.branch || '', time: l.slotLabel || '', slotId: l.slotId })),
  }));

  return (
    <div>
      <div className="flex justify-end mb-3">
        <button onClick={() => setShowPrint(true)} className="btn-ghost !px-3 !py-1.5 text-sm flex items-center gap-1.5">
          <Download size={14} /> PDF İndir
        </button>
      </div>
      <div className="overflow-x-auto">
      <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th className="text-left py-2 px-2 text-gray-400 font-600 w-10" style={{ fontWeight: 600 }}>#</th>
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
                      <div className="text-[11px] font-700 text-blue-700 truncate" style={{ fontWeight: 700 }}>{lesson.subBranch || lesson.branch || 'Ders'}</div>
                      <div className="text-[9px] text-blue-400 truncate">{lesson.teacherName}</div>
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
      {showPrint && <SchedulePrint title="Ders Programı" subtitle={cls?.toUpperCase() || 'Sınıf'} days={classDays} onClose={() => setShowPrint(false)} />}
    </div>
  );
}
