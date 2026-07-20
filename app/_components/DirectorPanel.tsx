'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Eye } from 'lucide-react';
import ProgramOlusturucu from './program/ProgramOlusturucu';

import { getWeekKey, allBranches } from '@/lib/constants';
import { api, Modal, SectionHeader } from './director/shared';
import { TeacherForm, StudentForm, ImportModal, type TeacherFormPayload, type StudentFormPayload } from './director/Forms';
import DirectorMuhasebeTab from './director/MuhasebeTab';
import HistoryModal from './director/HistoryModal';
import SinifOgrenci from './director/SinifOgrenci';
import TeachersTab from './director/TeachersTab';
import RehberlikHub from './rehberlik/RehberlikHub';
import VeliPanel from './director/VeliPanel';
import { useUrlTab } from './useUrlTab';
import { useUrlParam } from './useUrlParam';
import LoadingBox, { SkeletonList } from './Loading';
import EmptyState from './EmptyState';
import { useConfirm } from './ConfirmProvider';
import ResourceLibrary from './library/ResourceLibrary';
import { AnnouncementSender } from './announcements/Announcements';
import { TakvimManager } from './etkinlik/Takvim';
import { FormManager } from './form/Formlar';
import { OnKayitManager } from './crm/OnKayit';
import SlotTimeEditor from './director/SlotTimeEditor';
import HolidayPicker from './director/HolidayPicker';
import { useSlotTimes as useSlotTimesCtx } from './SlotTimesContext';
import type { Session } from '@/lib/auth';
import type { Branding } from '@/lib/branding';
import type { ClassRecord } from '@/lib/classes';
import type { DaySlotConfig, SlotCell as SlotCellData } from '@/lib/slots';
import type { ShowToast, SlotEntryDTO, StudentDTO, TeacherDTO } from './types';
// page.js bunu DirectorPanel'den import ediyor — yol değişmesin diye re-export.
export { DirectorSettingsModal, DirectorSettingsInline } from './director/Settings';
import { CounselorSection, AssistantDirectorSection } from './director/Settings';

// /api/slots öğretmen grid'i: gün → slotIdx → hücre.
type TeacherGrid = Record<number, SlotCellData[]>;

interface DirectorPanelProps {
  session: Session;
  showToast: ShowToast;
  externalTab?: string | null;
  onExternalTabChange?: (key: string) => void;
  branding?: Branding | null;
  readOnly?: boolean;
}

// ─── MAIN DIRECTOR PANEL ────────────────────────────────────────────────────────
export default function DirectorPanel({ session, showToast, externalTab, onExternalTabChange, branding, readOnly = false }: DirectorPanelProps) {
  // Rehber (counselor) = müdür paneli EKSİ muhasebe. Sekme listesi role göre.
  // readOnly: salt-okunur rehber (kurum config.permissions.counselor.readOnly). true ise
  // yönetimsel write butonları gizlenir. İSTİSNA açık kalır: rehberlik notu, deneme, davranış,
  // ödev, duyuru, takvim, hedef, konu — bunların butonları readOnly'de DE görünür.
  const isCounselor = session?.role === 'counselor';
  const validTabs = isCounselor
    ? ['teachers', 'students', 'rehberlik', 'veliler', 'onkayit', 'kutuphane', 'duyurular', 'takvim', 'formlar', 'ders-programi']
    : ['teachers', 'students', 'rehberlik', 'veliler', 'onkayit', 'muhasebe', 'kutuphane', 'duyurular', 'takvim', 'formlar', 'ders-saatleri', 'ders-programi'];
  const [tab, setTabInternal] = useUrlTab('teachers', validTabs);

  // Sidebar'dan gelen externalTab değişince iç state'i güncelle
  useEffect(() => {
    if (externalTab && validTabs.includes(externalTab) && externalTab !== tab) {
      setTabInternal(externalTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTab]);

  const setTab = useCallback((key: string) => {
    setTabInternal(key);
    onExternalTabChange?.(key);
  }, [setTabInternal, onExternalTabChange]);
  const [slotDays, setSlotDays] = useState<Record<number, DaySlotConfig> | null>(null); // { 0:{count,times}, ..., 6:{...} } — 7-gün model
  const [slotEtutSuresi, setSlotEtutSuresi] = useState(60);
  const [slotMolaSuresi, setSlotMolaSuresi] = useState(10);
  const [slotTimesLoading, setSlotTimesLoading] = useState(false);
  const [savingSlotTimes, setSavingSlotTimes] = useState(false);
  const { updateSlotTimes } = useSlotTimesCtx();
  const [teachers, setTeachers] = useState<TeacherDTO[]>([]);
  const [students, setStudents] = useState<StudentDTO[]>([]);
  const [classes, setClasses] = useState<ClassRecord[]>([]); // registry şubeler (/api/classes) — form+liste etiketleri
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState<SlotEntryDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showCounselorForm, setShowCounselorForm] = useState(false);
  const [showAssistantForm, setShowAssistantForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTeacher, setEditTeacher] = useState<TeacherDTO | null>(null);
  const [editStudent, setEditStudent] = useState<StudentDTO | null>(null);
  // Ön Kayıt köprüsü: "kayıt oldu" adayından öğrenci formu önceden dolu açılır (id yok → yeni kayıt).
  const [studentPrefill, setStudentPrefill] = useState<Partial<StudentDTO> | null>(null);
  const [selectedTeacherForSlots, setSelectedTeacherForSlots] = useState<TeacherDTO | null>(null);
  const [teacherSlots, setTeacherSlots] = useState<TeacherGrid | null | undefined>(null);
  const [expandedTeacherId, setExpandedTeacherId] = useUrlParam('ogretmen'); // inline detay → URL'de görünür
  const [expandedTeacherTab, setExpandedTeacherTab] = useState('etutler');
  const [teacherView, setTeacherView] = useState('list'); // 'list' | 'grid' — öğretmen listesi görünüm modu
  useEffect(() => {
    try { const v = localStorage.getItem('okulin:teacherView'); if (v === 'grid' || v === 'list') setTeacherView(v); } catch {}
  }, []);
  const changeTeacherView = useCallback((v: string) => {
    setTeacherView(v);
    try { localStorage.setItem('okulin:teacherView', v); } catch {}
  }, []);
  const [historyTarget, setHistoryTarget] = useState<{ type: string; id: string; name: string } | null>(null);
  const [pendingGuidance, setPendingGuidance] = useState<Record<string, number>>({});

  const confirm = useConfirm();

  const loadPendingGuidance = useCallback(async () => {
    try {
      const data = await api<Record<string, number>>('/api/guidance/pending');
      setPendingGuidance(data || {});
    } catch (e) {
      // Rozet boş kalır — davranış AYNI (sessizce yutuluyordu), artık teşhis edilebilir (Faz 4 T6).
      console.warn('[director] rehberlik bekleyen sayısı yüklenemedi:', e);
    }
  }, []);

  useEffect(() => { loadPendingGuidance(); }, [loadPendingGuidance]);

  // Ders saatleri sekmesi açılınca yükle (7-gün days modeli)
  useEffect(() => {
    if (tab !== 'ders-saatleri' || slotDays) return;
    setSlotTimesLoading(true);
    api<{ days?: Record<number, DaySlotConfig>; etutSuresi?: number; molaSuresi?: number }>('/api/slot-times').then(data => {
      setSlotDays(data.days || {});
      if (data.etutSuresi != null) setSlotEtutSuresi(data.etutSuresi);
      if (data.molaSuresi != null) setSlotMolaSuresi(data.molaSuresi);
    }).catch(e => {
      console.warn('[director] slot-times yüklenemedi:', e);
      showToast('Ders saatleri yüklenemedi', 'error');
    }).finally(() => setSlotTimesLoading(false));
  }, [tab, slotDays]);

  const loadAll = useCallback(async (wk?: string) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [teacherData, studentData, slotsData, classData] = await Promise.all([
        api<TeacherDTO[]>('/api/teachers'),
        api<StudentDTO[]>('/api/students'),
        api<{ weekKey?: string; slots?: SlotEntryDTO[] }>(`/api/slots?week=${resolvedWeek}`),
        api<{ classes?: ClassRecord[] }>('/api/classes'),
      ]);
      setTeachers([...teacherData].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      setStudents(studentData);
      setAllSlots(slotsData.slots || []);
      setClasses(classData.classes || []);
    } catch (err) { showToast((err as Error).message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, []);

  const loadTeacherSlots = async (teacher: TeacherDTO, wk?: string) => {
    const data = await api<{ weekKey?: string; grid?: TeacherGrid }>(`/api/slots?teacherId=${teacher.id}&week=${wk || weekKey}`);
    setTeacherSlots(data.grid);
    setSelectedTeacherForSlots(teacher);
  };

  // URL'den (yenileme / geri-ileri) gelen öğretmen detayı için slotları yükle.
  useEffect(() => {
    if (!expandedTeacherId || !teachers.length) return;
    if (selectedTeacherForSlots?.id === expandedTeacherId && teacherSlots) return;
    const t = teachers.find(x => x.id === expandedTeacherId);
    if (t) loadTeacherSlots(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedTeacherId, teachers]);

  const handleWeekChange = async (newWeek: string) => {
    setWeekKey(newWeek);
    const slotsData = await api<{ weekKey?: string; slots?: SlotEntryDTO[] }>(`/api/slots?week=${newWeek}`);
    setAllSlots(slotsData.slots || []);
    if (selectedTeacherForSlots) await loadTeacherSlots(selectedTeacherForSlots, newWeek);
  };

  const refreshSlots = async (teacher?: TeacherDTO) => {
    const t = teacher || selectedTeacherForSlots;
    if (t) {
      const data = await api<{ weekKey?: string; grid?: TeacherGrid }>(`/api/slots?teacherId=${t.id}&week=${weekKey}`);
      setTeacherSlots(data.grid);
    }
    const slotsData = await api<{ weekKey?: string; slots?: SlotEntryDTO[] }>(`/api/slots?week=${weekKey}`);
    setAllSlots(slotsData.slots || []);
  };

  const handleBook = async (params: Record<string, unknown>) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      await refreshSlots();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  const handleCancel = async (params: { teacherId: string; day: number; slotId: string }) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      await refreshSlots();
    } catch (err) { showToast((err as Error).message, 'error'); }
  };

  if (loading) return <LoadingBox height="h-64" />;

  return (
    <div>
      {readOnly && (
        <div className="mb-4 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm"
          style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}>
          <Eye size={16} className="shrink-0" />
          <span>Salt-okunur mod — yönetici size yalnız görüntüleme yetkisi verdi. Kayıtları görebilir, değiştiremezsiniz.</span>
        </div>
      )}
      {/* DERS PROGRAMI TAB — otomatik program oluşturucu (sidebar > Sistem) */}
      {tab === 'ders-programi' && (
        <ProgramOlusturucu api={api} showToast={showToast}
          activeClasses={[...new Set(students.map(s => s.cls))]} branding={branding} />
      )}

      {/* TEACHERS TAB — öğretmen listesi + inline detay sayfası (?ogretmen=ID) */}
      {tab === 'teachers' && (
        <TeachersTab
          teachers={teachers}
          students={students}
          weekKey={weekKey}
          readOnly={readOnly}
          teacherSlots={teacherSlots}
          selectedTeacherForSlots={selectedTeacherForSlots}
          expandedTeacherId={expandedTeacherId}
          expandedTeacherTab={expandedTeacherTab}
          setExpandedTeacherTab={setExpandedTeacherTab}
          teacherView={teacherView}
          onChangeView={changeTeacherView}
          showToast={showToast}
          onBack={() => setExpandedTeacherId(null)}
          onSelectTeacher={id => { setExpandedTeacherTab('etutler'); setExpandedTeacherId(id); }}
          onEditTeacher={t => { setEditTeacher(t); setShowTeacherForm(true); }}
          onAddTeacher={() => { setEditTeacher(null); setShowTeacherForm(true); }}
          onDeleteTeacher={async t => {
            if (!(await confirm(`${t.name} silinsin mi?`))) return;
            try { await api('/api/teachers',{method:'DELETE',body:JSON.stringify({id:t.id})}); showToast('Öğretmen silindi'); setExpandedTeacherId(null); loadAll(weekKey); } catch(err){showToast((err as Error).message,'error');}
          }}
          onWeekChange={handleWeekChange}
          onCancelBooking={(teacherId, day, slotId) => handleCancel({ teacherId, day, slotId })}
        />
      )}

      {/* SINIF / ÖĞRENCİ TAB — eski Sınıflar + Rehberlik birleşik */}
      {tab === 'students' && (
        <SinifOgrenci
          students={students}
          classes={classes}
          weekKey={weekKey}
          isCounselor={isCounselor}
          readOnly={readOnly}
          onAddStudent={() => { setEditStudent(null); setShowStudentForm(true); }}
          onAddCounselor={() => setShowCounselorForm(true)}
          onAddAssistant={() => setShowAssistantForm(true)}
          onEditStudent={s => { setEditStudent(s); setShowStudentForm(true); }}
          onDeleteStudent={async s => {
            if (!(await confirm(`${s.name} silinsin mi?`))) return;
            try { await api('/api/students',{method:'DELETE',body:JSON.stringify({id:s.id})}); showToast('Öğrenci silindi'); loadAll(weekKey); } catch(err){showToast((err as Error).message,'error');}
          }}
          onHistory={s => setHistoryTarget({ type: 'student', id: s.id, name: s.name })}
          onClassesChanged={() => loadAll(weekKey)}
          pendingGuidance={pendingGuidance}
          onGuidanceReviewed={loadPendingGuidance}
          showToast={showToast}
        />
      )}

      {tab === 'veliler' && (
        <div>
          <SectionHeader title="Veli" count={students.length} />
          <VeliPanel students={students} classes={classes} showToast={showToast} onChanged={() => loadAll(weekKey)} />
        </div>
      )}

      {historyTarget && (
        <HistoryModal target={historyTarget} onClose={() => setHistoryTarget(null)}
          currentWeekKey={weekKey}
          currentEntries={allSlots.filter(s => s.booked && (
            historyTarget.type === 'teacher' ? s.teacherId === historyTarget.id : s.studentId === historyTarget.id
          )).map(s => ({
            day: s.day, dayLabel: s.dayLabel, slotId: s.slotId, slotLabel: s.slotLabel,
            studentId: s.studentId, studentName: s.studentName, studentCls: s.studentCls,
            teacherId: s.teacherId, teacherName: s.teacherName, branch: s.branch,
            bookedBy: s.bookedBy, fixed: !!s.fixed,
          }))} />
      )}

      {/* REHBERLİK TAB — yoklama/ödev/davranış/denemeler hub'ı */}
      {tab === 'rehberlik' && (
        <RehberlikHub session={session} showToast={showToast} />
      )}

      {tab === 'muhasebe' && (
        <DirectorMuhasebeTab session={session} showToast={showToast} />
      )}
      {tab === 'kutuphane' && (
        <ResourceLibrary canManage={!readOnly} userRole="director" userId="director"
          branches={allBranches()} showToast={showToast} />
      )}

      {tab === 'duyurular' && (
        <AnnouncementSender showToast={showToast} />
      )}

      {tab === 'takvim' && (
        <TakvimManager showToast={showToast} />
      )}

      {tab === 'formlar' && (
        <FormManager showToast={showToast} />
      )}

      {tab === 'onkayit' && (
        <OnKayitManager showToast={showToast}
          onCreateStudent={lead => {
            setEditStudent(null);
            setStudentPrefill({ name: lead.studentName || '', parentName: lead.parentName || '', parentPhone: lead.phone || '' });
            setShowStudentForm(true);
          }} />
      )}

      {/* Ders Saatleri sekmesi */}
      {tab === 'ders-saatleri' && (
        <div className="max-w-2xl">
          <SectionHeader icon={Clock} title="Ders Saatleri" subtitle="Haftalık ders slot başlangıç ve bitiş saatlerini ayarla" />
          {slotTimesLoading || !slotDays ? (
            <LoadingBox height="h-48" />
          ) : (
            <>
              <SlotTimeEditor
                days={slotDays}
                etutSuresi={slotEtutSuresi}
                molaSuresi={slotMolaSuresi}
                onDaysChange={setSlotDays}
                onMetaChange={(key, val) => key === 'etutSuresi' ? setSlotEtutSuresi(val) : setSlotMolaSuresi(val)}
              />
              <div className="flex justify-end mt-4">
                <button
                  className="btn-primary !px-6 !py-2.5"
                  disabled={savingSlotTimes}
                  onClick={async () => {
                    setSavingSlotTimes(true);
                    try {
                      const payload = { days: slotDays!, etutSuresi: slotEtutSuresi, molaSuresi: slotMolaSuresi };
                      await api('/api/slot-times', { method: 'POST', body: JSON.stringify(payload) });
                      updateSlotTimes(payload);
                      showToast('Saatler kaydedildi ve uygulandı');
                    } catch (e) { showToast((e as Error).message, 'error'); }
                    finally { setSavingSlotTimes(false); }
                  }}
                >
                  {savingSlotTimes ? 'Kaydediliyor…' : 'Saatleri Kaydet'}
                </button>
              </div>
              <HolidayPicker showToast={showToast} />
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showTeacherForm && (
        <TeacherForm initial={editTeacher} onClose={() => { setShowTeacherForm(false); setEditTeacher(null); }}
          onSave={async (data: TeacherFormPayload) => {
            try {
              if (editTeacher) { await api('/api/teachers',{method:'PUT',body:JSON.stringify({id:editTeacher.id,...data})}); showToast('Öğretmen güncellendi'); }
              else { await api('/api/teachers',{method:'POST',body:JSON.stringify(data)}); showToast('Öğretmen eklendi'); }
              setShowTeacherForm(false); setEditTeacher(null); loadAll(weekKey);
            } catch(err){showToast((err as Error).message,'error');}
          }} />
      )}
      {showCounselorForm && !isCounselor && (
        <Modal title="Rehberlik Öğretmeni Ekle" onClose={() => setShowCounselorForm(false)}>
          <CounselorSection showToast={showToast} />
        </Modal>
      )}
      {showAssistantForm && !isCounselor && (
        <Modal title="Müdür Yardımcısı Ekle" onClose={() => setShowAssistantForm(false)}>
          <AssistantDirectorSection showToast={showToast} />
        </Modal>
      )}
      {showStudentForm && (
        <StudentForm initial={editStudent || studentPrefill} classes={classes} onClose={() => { setShowStudentForm(false); setEditStudent(null); setStudentPrefill(null); }}
          onSwitchToImport={() => { setShowStudentForm(false); setEditStudent(null); setStudentPrefill(null); setShowImport(true); }}
          onSave={async (data: StudentFormPayload) => {
            try {
              if (editStudent) { await api('/api/students',{method:'PUT',body:JSON.stringify({id:editStudent.id,...data})}); showToast('Öğrenci güncellendi'); }
              else { await api('/api/students',{method:'POST',body:JSON.stringify(data)}); showToast('Öğrenci eklendi'); }
              setShowStudentForm(false); setEditStudent(null); setStudentPrefill(null); loadAll(weekKey);
            } catch(err){showToast((err as Error).message,'error');}
          }} />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} showToast={showToast} onDone={() => { setShowImport(false); loadAll(weekKey); }} />
      )}
    </div>
  );
}
