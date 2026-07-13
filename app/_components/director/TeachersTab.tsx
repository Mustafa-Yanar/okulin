'use client';

import {
  Users, Plus, Trash2, Edit3, Clock, User, ChevronRight, ChevronLeft, CalendarRange, CalendarDays, LayoutGrid, List
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ALL_DAYS, daySlots as buildDaySlots } from '@/lib/constants';
import { GROUPS, getAdjacentWeek, WeekNav, SectionHeader } from './shared';
import { TeacherBookingsList } from '../TeacherPanel';
import HistoryModal from './HistoryModal';
import ProgramEditor from './ProgramEditor';
import LoadingBox from '../Loading';
import EmptyState from '../EmptyState';
import { useSlotTimes } from '../SlotTimesContext';
import { useClasses } from '../ClassesContext';
import { classShortUpper } from '@/lib/classCatalog';
import type { SlotCell as SlotCellData } from '@/lib/slots';
import type { ShowToast, StudentDTO, TeacherDTO } from '../types';

// /api/slots öğretmen grid'i: gün → slotIdx → hücre.
type TeacherGrid = Record<number, SlotCellData[]>;

interface TeachersTabProps {
  teachers: TeacherDTO[];
  students: StudentDTO[];
  weekKey: string;
  readOnly: boolean;
  teacherSlots: TeacherGrid | null | undefined;
  selectedTeacherForSlots: TeacherDTO | null;
  expandedTeacherId: string | null;
  expandedTeacherTab: string;
  setExpandedTeacherTab: (k: string) => void;
  teacherView: string;
  onChangeView: (v: string) => void;
  showToast: ShowToast;
  onBack: () => void;
  onSelectTeacher: (id: string) => void;
  onEditTeacher: (t: TeacherDTO) => void;
  onAddTeacher: () => void;
  onDeleteTeacher: (t: TeacherDTO) => void;
  onWeekChange: (wk: string) => void;
  onCancelBooking: (teacherId: string, dayIndex: number, slotId: string) => void;
}

// ─── TEACHERS TAB — öğretmen listesi + inline detay sayfası (?ogretmen=ID) ──────
export default function TeachersTab({
  teachers, students, weekKey, readOnly, teacherSlots, selectedTeacherForSlots,
  expandedTeacherId, expandedTeacherTab, setExpandedTeacherTab, teacherView, onChangeView,
  showToast, onBack, onSelectTeacher, onEditTeacher, onAddTeacher, onDeleteTeacher,
  onWeekChange, onCancelBooking,
}: TeachersTabProps) {
  const { slotTimes } = useSlotTimes();
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (liste görünümleri)
  const selT = expandedTeacherId ? teachers.find(x => x.id === expandedTeacherId) : null;

  // İnline detay sayfası — bir öğretmen seçiliyse liste yerine bunu göster.
  if (expandedTeacherId && selT) {
    const t = selT;
    const slotsReady = selectedTeacherForSlots?.id === t.id && teacherSlots;
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <button onClick={onBack}
            className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5">
            <ChevronLeft size={16} /> Geri
          </button>
          {!readOnly && (
          <div className="flex gap-2 shrink-0">
            <button className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5" onClick={() => onEditTeacher(t)}>
              <Edit3 size={14} /> Düzenle
            </button>
            <button className="btn-ghost btn-ghost-danger !px-3 !py-2 text-sm flex items-center gap-1.5" onClick={() => onDeleteTeacher(t)}>
              <Trash2 size={14} /> Sil
            </button>
          </div>
          )}
        </div>
        <div className="card overflow-hidden">
          {/* Başlık kartı */}
          <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <div className="w-12 h-12 rounded-full overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
              {t.photoUrl
                ? <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover" />
                : <User size={24} className="text-gray-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-subheading">{t.name}</h3>
              <div className="text-caption">{(t.branches||[]).join(', ')}</div>
              <div className="flex gap-1 mt-1 flex-wrap">
                {(t.allowedGroups||[]).map(g => <span key={g} className="badge badge-info">{GROUPS[g]}</span>)}
                {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'var(--bg-muted)',color:'var(--text-muted)' }}>Tüm gruplar</span>}
              </div>
            </div>
          </div>

          <div className="px-4 py-3" style={{ background: 'var(--bg-surface-2)' }}>
            {/* Sekme başlığı + tarih nav (sadece Etütler sekmesinde) */}
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <div className="pill-tabs grow sm:grow-0">
                {([['etutler','Etütler',CalendarRange],['gecmis','Etüt Geçmişi',Clock],['program','Program',CalendarDays]] as [string, string, LucideIcon][]).map(([k,l,Icon]) => (
                  <button key={k} onClick={() => setExpandedTeacherTab(k)}
                    className={`pill-tab press-effect${expandedTeacherTab === k ? ' is-active' : ''}`}>
                    <Icon size={12} /> <span>{l}</span>
                  </button>
                ))}
              </div>
              {expandedTeacherTab === 'etutler' && (
                <WeekNav weekKey={weekKey} onPrev={() => onWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => onWeekChange(getAdjacentWeek(weekKey,1))} />
              )}
            </div>

            {/* Etütler sekmesi */}
            {expandedTeacherTab === 'etutler' && (
              slotsReady ? (
                <TeacherBookingsList
                  bookedList={(() => {
                    const items: {
                      dayIndex: number; dayLabel: string; slotId: string; slotLabel: string; slotIdx: number;
                      studentName?: string | null; studentCls?: string; studentId?: string | null; bookedBy: string; fixed: boolean;
                    }[] = [];
                    ALL_DAYS.forEach(day => {
                      buildDaySlots(day.index, slotTimes.days?.[day.index]).forEach((slot, slotIdx) => {
                        const sd = teacherSlots?.[day.index]?.[slotIdx];
                        if (sd?.booked) items.push({
                          dayIndex: day.index, dayLabel: day.label,
                          slotId: slot.id, slotLabel: slot.label, slotIdx,
                          studentName: sd.studentName,
                          studentCls: classShortUpper(classes, sd.studentCls||''),
                          studentId: sd.studentId,
                          bookedBy: sd.bookedBy || 'student',
                          fixed: !!sd.fixed,
                        });
                      });
                    });
                    return items;
                  })()}
                  listColorMap={{
                    student:  { badge: 'tag-student',  label: 'Öğrenci' },
                    teacher:  { badge: 'tag-teacher',  label: 'Öğretmen' },
                    director: { badge: 'tag-director', label: 'Müdür' },
                  }}
                  onCancel={item => onCancelBooking(t.id, item.dayIndex, item.slotId)}
                  canCancelAll
                />
              ) : (
                <LoadingBox height="h-24" />
              )
            )}

            {/* Etüt Geçmişi sekmesi — inline */}
            {expandedTeacherTab === 'gecmis' && (
              <HistoryModal
                inline
                target={{ type: 'teacher', id: t.id, name: t.name }}
                onClose={() => setExpandedTeacherTab('etutler')}
                currentWeekKey={weekKey}
                currentEntries={(() => {
                  if (selectedTeacherForSlots?.id !== t.id || !teacherSlots) return [];
                  const items: {
                    day: number; dayLabel: string; slotId: string; slotLabel: string;
                    studentName?: string | null; studentCls?: string | null;
                  }[] = [];
                  ALL_DAYS.forEach(day => {
                    buildDaySlots(day.index, slotTimes.days?.[day.index]).forEach((slot, slotIdx) => {
                      const sd = teacherSlots[day.index]?.[slotIdx];
                      if (sd?.booked) items.push({
                        day: day.index, dayLabel: day.label,
                        slotId: slot.id, slotLabel: slot.label,
                        studentName: sd.studentName,
                        studentCls: classShortUpper(classes, sd.studentCls||''),
                      });
                    });
                  });
                  return items;
                })()}
              />
            )}

            {/* Program sekmesi — inline */}
            {expandedTeacherTab === 'program' && (
              <ProgramEditor
                key={`prog-${t.id}`}
                inline
                teacher={t}
                students={students}
                showToast={showToast}
                onClose={() => setExpandedTeacherTab('etutler')}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  // Liste / kart görünümü
  return (
    <div>
      <SectionHeader title="Öğretmen" count={teachers.length}>
        <div className="pill-tabs shrink-0" role="group" aria-label="Görünüm modu" style={{ width:'fit-content' }}>
          <button
            type="button"
            className={`pill-tab !px-2.5 !flex-none ${teacherView === 'list' ? 'is-active' : ''}`}
            aria-pressed={teacherView === 'list'}
            title="Liste görünümü"
            onClick={() => onChangeView('list')}
          >
            <List size={15} />
          </button>
          <button
            type="button"
            className={`pill-tab !px-2.5 !flex-none ${teacherView === 'grid' ? 'is-active' : ''}`}
            aria-pressed={teacherView === 'grid'}
            title="Kart görünümü"
            onClick={() => onChangeView('grid')}
          >
            <LayoutGrid size={15} />
          </button>
        </div>
        {!readOnly && (
        <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm shrink-0" onClick={onAddTeacher}>
          <Plus size={14} /> Öğretmen Ekle
        </button>
        )}
      </SectionHeader>
      {teachers.length === 0 ? (
        <EmptyState card icon={Users} title="Henüz öğretmen eklenmemiş" description="Yeni öğretmen ekleyerek başlayın." />
      ) : teacherView === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {teachers.map(t => (
            <button
              key={t.id}
              className="card card-interactive press-effect flex flex-col items-center text-center gap-2 p-4"
              onClick={() => onSelectTeacher(t.id)}
            >
              <div className="w-16 h-16 rounded-full overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
                {t.photoUrl
                  ? <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover" />
                  : <User size={30} className="text-gray-400" />}
              </div>
              <div className="min-w-0 w-full">
                <div className="font-semibold truncate">{t.name}</div>
                <div className="text-caption truncate">{(t.branches||[]).join(', ')}</div>
              </div>
              <div className="flex gap-1 flex-wrap justify-center">
                {(t.allowedGroups||[]).map(g => <span key={g} className="badge badge-info">{GROUPS[g]}</span>)}
                {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'var(--bg-muted)',color:'var(--text-muted)' }}>Tüm gruplar</span>}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid gap-2">
          {teachers.map(t => (
            <div key={t.id} className="card card-interactive overflow-hidden">
              <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left" onClick={() => onSelectTeacher(t.id)}>
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
                  {t.photoUrl
                    ? <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover" />
                    : <User size={22} className="text-gray-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-caption">{(t.branches||[]).join(', ')}</div>
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {(t.allowedGroups||[]).map(g => <span key={g} className="badge badge-info">{GROUPS[g]}</span>)}
                    {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'var(--bg-muted)',color:'var(--text-muted)' }}>Tüm gruplar</span>}
                  </div>
                </div>
                <ChevronRight size={16} className="text-gray-400 shrink-0 ml-2" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
