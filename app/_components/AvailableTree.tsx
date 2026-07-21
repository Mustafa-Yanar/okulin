'use client';

import { useState, useMemo } from 'react';
import { Calendar, Clock, ChevronRight } from 'lucide-react';
import EmptyState from './EmptyState';
import type { BookingSlotEntry, BookEtutArgs } from './student-types';

interface AvailableTreeProps {
  available: BookingSlotEntry[];
  onBook: (args: BookEtutArgs) => void;
  selectableBranchesFor?: (s: BookingSlotEntry) => string[];
  bookingDisabled?: boolean;
}

// ─── AVAILABLE TREE ────────────────────────────────────────────────────────────
export default function AvailableTree({ available, onBook, selectableBranchesFor, bookingDisabled }: AvailableTreeProps) {
  const [openTeachers, setOpenTeachers] = useState<Record<string, boolean>>({});
  const [openDays, setOpenDays] = useState<Record<string, boolean>>({});

  const tree = useMemo(() => {
    const map: Record<string, { id: string; name: string; branches: string[]; days: Record<number, { dayIndex: number; dayLabel?: string; slots: BookingSlotEntry[] }> }> = {};
    for (const s of available) {
      if (!map[s.teacherId]) {
        map[s.teacherId] = { id: s.teacherId, name: s.teacherName || '', branches: s.branches || [], days: {} };
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

  const toggleTeacher = (id: string) => setOpenTeachers(p => ({ ...p, [id]: !p[id] }));
  const toggleDay = (key: string) => setOpenDays(p => ({ ...p, [key]: !p[key] }));

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
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))', fontWeight: 700 }}>
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
                          <Calendar size={13} className="text-brand" />
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
                              <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-100 hover:border-[color:var(--brand)] transition-colors">
                                <div className="flex items-center gap-2">
                                  <Clock size={12} className="shrink-0" style={{ color: 'var(--time-etut)' }} />
                                  <span className="text-xs font-600 text-gray-700" style={{ fontWeight: 600 }}>{s.slotLabel}</span>
                                </div>
                                {sel.length === 1 ? (
                                  <button onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, branch: sel[0], kind: s.kind, etutId: s.etutId })}
                                    disabled={bookingDisabled}
                                    title={bookingDisabled ? 'Bu hafta için rezervasyon henüz açık değil' : undefined}
                                    className={`btn-primary !px-3 !py-1 text-xs ${bookingDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                    {sel[0]} · Al
                                  </button>
                                ) : (
                                  <div className="flex gap-1 flex-wrap justify-end">
                                    {sel.map(b => (
                                      <button key={b} onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId, branch: b, kind: s.kind, etutId: s.etutId })}
                                        disabled={bookingDisabled}
                                        title={bookingDisabled ? 'Bu hafta için rezervasyon henüz açık değil' : undefined}
                                        className={`btn-primary !px-2.5 !py-1 text-[11px] ${bookingDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
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
