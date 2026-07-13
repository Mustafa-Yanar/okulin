'use client';

import { useState, useMemo } from 'react';
import { BookOpen, Calendar, Clock, X, ChevronRight } from 'lucide-react';
import EmptyState from './EmptyState';
import type { BookingSlotEntry, BookingCancelArgs } from './student-types';

interface StudentBookingsViewProps {
  student: { id?: string };
  allSlots: BookingSlotEntry[];
  onCancel?: (args: BookingCancelArgs) => void;
}

// ─── STUDENT BOOKINGS VIEW ─────────────────────────────────────────────────────
export function StudentBookingsView({ student, allSlots, onCancel }: StudentBookingsViewProps) {
  const [openDays, setOpenDays] = useState<Record<string | number, boolean>>({});

  const bookedByLabel: Record<string, string> = { student: 'Öğrenci', teacher: 'Öğretmen', director: 'Müdür', counselor: 'Rehber' };
  const bookedByColor: Record<string, string> = {
    student: 'bg-indigo-100 text-indigo-600',
    teacher: 'bg-emerald-100 text-emerald-600',
    director: 'bg-amber-100 text-amber-600',
    counselor: 'bg-amber-100 text-amber-600',
  };

  const days = useMemo(() => {
    const bookedSlots = allSlots.filter(s => s.booked && s.studentId === student.id);
    const map: Record<number, { dayIndex: number; dayLabel?: string; slots: BookingSlotEntry[] }> = {};
    for (const s of bookedSlots) {
      if (!map[s.day]) map[s.day] = { dayIndex: s.day, dayLabel: s.dayLabel, slots: [] };
      map[s.day].slots.push(s);
    }
    return Object.values(map)
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map(d => ({ ...d, slots: d.slots.sort((a, b) => a.slotId.localeCompare(b.slotId)) }));
  }, [allSlots, student.id]);

  const toggleDay = (key: string | number) => setOpenDays(p => ({ ...p, [key]: !p[key] }));

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
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))', fontWeight: 700 }}>
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
                      <Clock size={13} className="text-brand shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.slotLabel}</div>
                        <div className="text-caption truncate">{s.teacherName} · {s.branch}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {s.fixed && (
                        <span className="badge" style={{ background: 'color-mix(in srgb, #7c3aed 12%, transparent)', color: '#7c3aed' }}>Sabit</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${bookedByColor[s.bookedBy || ''] || bookedByColor.student}`} style={{ fontWeight: 500 }}>
                        {bookedByLabel[s.bookedBy || ''] || 'Öğrenci'}
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
