'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingBox from './Loading';
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
  ALL_DAYS,
} from '@/lib/constants';
import { api, getAdjacentWeek, isSlotPast, WeekNav } from './shared';
import AvailableTree from './AvailableTree';
import ClassScheduleView from './ClassScheduleView';
import { StudentBookingsView } from './StudentBookingsView';
import StudentGuidancePanel from './StudentGuidancePanel';
import { guidanceSubjectsFor, GROUPS } from './student-logic';
import type { Session } from '@/lib/auth';
import type { ShowToast } from './types';
import type { BookingSlotEntry, EtutAllDTO, BookEtutArgs, BookingCancelArgs } from './student-types';

interface StudentPanelProps {
  session: Session;
  showToast: ShowToast;
  externalTab?: string | null;
  onExternalTabChange?: (key: string) => void;
  selfBookingAllowed?: boolean;
}

// ─── MAIN STUDENT PANEL ────────────────────────────────────────────────────────
export default function StudentPanel({ session, showToast, externalTab, onExternalTabChange, selfBookingAllowed = true }: StudentPanelProps) {
  const { classes } = useClasses();
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState<BookingSlotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [tab, setTabInternal] = useUrlTab('available', ['available', 'myBookings', 'dersprogramim', 'odev', 'davranis', 'rehberlik', 'kutuphane', 'duyurular', 'takvim', 'formlar']);

  useEffect(() => {
    if (externalTab && externalTab !== tab) setTabInternal(externalTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTab]);

  const setTab = useCallback((key: string) => {
    setTabInternal(key);
    onExternalTabChange?.(key);
  }, [setTabInternal, onExternalTabChange]);

  const loadData = useCallback(async (wk?: string) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      // Sadece yeni serbest etüt şablonları (eski slot-etüt /api/slots emekli edildi — Faz 7c-3).
      const etutData = await api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${resolvedWeek}`);
      // Yeni etütleri slot-benzeri şekle çevir (AvailableTree/BookingsView aynı bileşeni kullanır).
      const etutList: BookingSlotEntry[] = (etutData.etutler || []).map(e => ({
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
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const teachers = useMemo(() => {
    const seen = new Set<string>();
    return allSlots.filter(s => { if (seen.has(s.teacherId)) return false; seen.add(s.teacherId); return true; })
      .map(s => ({ id: s.teacherId, name: s.teacherName }));
  }, [allSlots]);

  const myBookings = useMemo(() => allSlots.filter(s => s.booked && s.studentId === session.id), [allSlots, session.id]);
  // Registry'de şubenin ders listesi varsa onu kullan (özel şube/özel ders), yoksa constants fallback.
  const studentAllowedBranches = useMemo(
    () => coursesForClass(classes, session.cls || '') ?? allowedBranchesForClass(session.cls),
    [classes, session.cls]
  );
  const bookedBranches = useMemo(() => new Set(myBookings.map(b => b.branch).filter(Boolean)), [myBookings]);
  const mathTaken = useMemo(() => myBookings.some(b => MATH_FAMILY.includes(b.branch || '')), [myBookings]);

  const selectableBranchesFor = useCallback((s: BookingSlotEntry) => {
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
      if (!s.allowedGroups.includes(session.group || '')) return false;
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

  const handleBook = async ({ teacherId, branch, etutId }: BookEtutArgs) => {
    try {
      await api('/api/etut-sablon/rezervasyon', { method: 'POST', body: JSON.stringify({ teacherId, etutId, branch, weekKey }) });
      showToast('Etüde kaydoldunuz!');
      loadData(weekKey);
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  const handleCancel = async ({ teacherId, etutId }: BookingCancelArgs) => {
    try {
      await api('/api/etut-sablon/rezervasyon', { method: 'DELETE', body: JSON.stringify({ teacherId, etutId }) });
      showToast('Rezervasyon iptal edildi');
      loadData(weekKey);
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  if (loading) return <LoadingBox height="h-64" />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{classLabelFrom(classes, session.cls || '', classLabel)} · {GROUPS[session.group || '']}</p>
        <WeekNav weekKey={weekKey} onPrev={() => { const w = getAdjacentWeek(weekKey,-1); setWeekKey(w); loadData(w); }} onNext={() => { const w = getAdjacentWeek(weekKey,1); setWeekKey(w); loadData(w); }} />
      </div>

      {tab === 'rehberlik' ? (
        <RehberlikAccordion
          subjects={guidanceSubjectsFor(session.cls)}
          editable={true}
          studentId={undefined}
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
      ) : tab === 'dersprogramim' ? (
        <ClassScheduleView cls={session.cls} />
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
