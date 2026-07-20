'use client';

// Müdür öğrenci-detayı "Etüt Geçmişi" sekmesi (Faz 4 T4) — kaynak EtutReservation
// (/api/etut-sablon/all efektif listesi, hafta-bazlı) + SERBEST hafta nav (Faz 3 kararı).
// Eski kaynak DirectorPanel allSlots (SlotBooking) idi — etüt oraya artık yazılmıyor,
// İrem'in rezervasyonu görünmüyordu (bu işin ilk şikayeti). İptal: hafta-tombstone
// (scope:'week'); seri yönetimi ProgramEditor'da.
import { useState, useEffect, useCallback } from 'react';
import { getWeekKey } from '@/lib/constants';
import { api, getAdjacentWeek, WeekNav } from '../shared';
import { StudentBookingsView } from '../StudentBookingsView';
import type { BookingSlotEntry, BookingCancelArgs, EtutAllDTO } from '../student-types';
import type { ShowToast } from '../types';
import LoadingBox from '../Loading';

interface StudentEtutTabProps {
  student: { id: string };
  readOnly?: boolean;
  showToast: ShowToast;
}

export default function StudentEtutTab({ student, readOnly = false, showToast }: StudentEtutTabProps) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [slots, setSlots] = useState<BookingSlotEntry[] | null>(null);

  const load = useCallback(async (wk: string) => {
    setSlots(null);
    try {
      const d = await api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${wk}&studentId=${encodeURIComponent(student.id)}`);
      setSlots((d.etutler || []).filter(e => e.studentId === student.id).map(e => ({
        kind: 'etut', etutId: e.id, teacherId: e.teacherId, teacherName: e.teacherName,
        day: e.dayIndex, dayLabel: e.dayLabel, slotId: `etut:${e.id}`, slotLabel: `${e.start}–${e.end}`,
        booked: e.booked, studentId: e.studentId, studentName: e.studentName,
        branch: e.branch ?? undefined, bookedBy: e.bookedBy ?? undefined, scope: e.scope,
      })));
    } catch (err) { showToast((err as Error).message, 'error'); setSlots([]); }
  }, [student.id, showToast]);

  useEffect(() => { load(weekKey); }, [load, weekKey]);

  const handleCancel = async ({ teacherId, etutId }: BookingCancelArgs) => {
    const isRecurring = slots?.find(s => s.etutId === etutId)?.scope === 'RECURRING';
    try {
      await api('/api/etut-sablon/rezervasyon', { method: 'DELETE', body: JSON.stringify({ teacherId, etutId, weekKey, scope: 'week' }) });
      showToast(isRecurring ? 'Bu haftanın etüdü iptal edildi (seri devam eder)' : 'Etüt iptal edildi');
      load(weekKey);
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  return (
    <div>
      <div className="flex items-center justify-end mb-3">
        <WeekNav weekKey={weekKey} onPrev={() => setWeekKey(w => getAdjacentWeek(w, -1))} onNext={() => setWeekKey(w => getAdjacentWeek(w, 1))} />
      </div>
      {slots === null
        ? <LoadingBox height="h-24" />
        : <StudentBookingsView student={student} allSlots={slots} onCancel={readOnly ? undefined : handleCancel} />}
    </div>
  );
}
