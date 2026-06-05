'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Trash2, Edit3, Clock, User, ChevronRight, ChevronLeft, ClipboardList, Compass, CalendarRange, CalendarDays, Upload, FileText, ScanLine
} from 'lucide-react';
import { useSlotTimes } from './SlotTimesContext';
import DirectorDenemeYonetimi from './rehberlik/DirectorDenemeYonetimi';
import ProgramOlusturucu from './program/ProgramOlusturucu';
import { TeacherBookingsList } from './TeacherPanel';

import { ALL_DAYS, classLabel, getWeekKey, slotsForDay, allBranches } from '@/lib/constants';
import { GROUPS, api, Modal, getAdjacentWeek, WeekNav } from './director/shared';
import { TeacherForm, StudentForm, ImportModal } from './director/Forms';
import { DirectorAttendanceView } from './director/Attendance';
import DirectorMuhasebeTab from './director/MuhasebeTab';
import HistoryModal from './director/HistoryModal';
import { StudentList } from './director/StudentList';
import VeliPanel from './director/VeliPanel';
import TeacherPresets from './director/TeacherPresets';
import ProgramEditor from './director/ProgramEditor';
import { useUrlTab } from './useUrlTab';
import { useUrlParam } from './useUrlParam';
import LoadingBox, { SkeletonList } from './Loading';
import OptikFormTab from './director/OptikFormTab';
import ResourceLibrary from './library/ResourceLibrary';
import { AnnouncementSender } from './announcements/Announcements';
import SlotTimeEditor from './director/SlotTimeEditor';
import { useSlotTimes as useSlotTimesCtx } from './SlotTimesContext';
// page.js bunu DirectorPanel'den import ediyor — yol değişmesin diye re-export.
export { DirectorSettingsModal, DirectorSettingsInline } from './director/Settings';
import { CounselorSection } from './director/Settings';

// ─── MAIN DIRECTOR PANEL ────────────────────────────────────────────────────────
export default function DirectorPanel({ session, showToast, externalTab, onExternalTabChange }) {
  // Rehber (counselor) = müdür paneli EKSİ muhasebe. Sekme listesi role göre.
  const isCounselor = session?.role === 'counselor';
  const validTabs = isCounselor
    ? ['teachers', 'students', 'veliler', 'yoklama', 'kutuphane', 'duyurular', 'ders-programi']
    : ['teachers', 'students', 'veliler', 'yoklama', 'muhasebe', 'kutuphane', 'duyurular', 'denemeler', 'ders-saatleri', 'ders-programi'];
  const [tab, setTabInternal] = useUrlTab('teachers', validTabs);

  // Sidebar'dan gelen externalTab değişince iç state'i güncelle
  useEffect(() => {
    if (externalTab && validTabs.includes(externalTab) && externalTab !== tab) {
      setTabInternal(externalTab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTab]);

  const setTab = useCallback((key) => {
    setTabInternal(key);
    onExternalTabChange?.(key);
  }, [setTabInternal, onExternalTabChange]);
  const [denemeTab, setDenemeTab] = useState('upload');
  const [slotWeekday, setSlotWeekday] = useState([]);
  const [slotWeekend, setSlotWeekend] = useState([]);
  const [slotEtutSuresi, setSlotEtutSuresi] = useState(60);
  const [slotMolaSuresi, setSlotMolaSuresi] = useState(10);
  const [slotTimesLoading, setSlotTimesLoading] = useState(false);
  const [savingSlotTimes, setSavingSlotTimes] = useState(false);
  const { updateSlotTimes } = useSlotTimesCtx();
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showCounselorForm, setShowCounselorForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTeacher, setEditTeacher] = useState(null);
  const [editStudent, setEditStudent] = useState(null);
  const [selectedTeacherForSlots, setSelectedTeacherForSlots] = useState(null);
  const [teacherSlots, setTeacherSlots] = useState(null);
  const [expandedTeacherId, setExpandedTeacherId] = useUrlParam('ogretmen'); // inline detay → URL'de görünür
  const [expandedStudentId, setExpandedStudentId] = useState(null); // StudentList onSelectChange ile beslenir → detayda liste başlığını gizle
  const [expandedTeacherTab, setExpandedTeacherTab] = useState('etutler');
  const [historyTarget, setHistoryTarget] = useState(null);
  const [pendingGuidance, setPendingGuidance] = useState({});

  const { slotTimes } = useSlotTimes();

  const loadPendingGuidance = useCallback(async () => {
    try {
      const data = await api('/api/guidance/pending');
      setPendingGuidance(data || {});
    } catch {}
  }, []);

  useEffect(() => { loadPendingGuidance(); }, [loadPendingGuidance]);

  // Ders saatleri sekmesi açılınca yükle
  useEffect(() => {
    if (tab !== 'ders-saatleri' || slotWeekday.length > 0) return;
    setSlotTimesLoading(true);
    api('/api/slot-times').then(data => {
      setSlotWeekday(data.weekday || []);
      setSlotWeekend(data.weekend || []);
      if (data.etutSuresi != null) setSlotEtutSuresi(data.etutSuresi);
      if (data.molaSuresi != null) setSlotMolaSuresi(data.molaSuresi);
    }).catch(() => {}).finally(() => setSlotTimesLoading(false));
  }, [tab]);

  const loadAll = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [teacherData, studentData, slotsData] = await Promise.all([
        api('/api/teachers'),
        api('/api/students'),
        api(`/api/slots?week=${resolvedWeek}`),
      ]);
      setTeachers([...teacherData].sort((a, b) => a.name.localeCompare(b.name, 'tr')));
      setStudents(studentData);
      setAllSlots(slotsData.slots || []);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, []);

  const loadTeacherSlots = async (teacher, wk) => {
    const data = await api(`/api/slots?teacherId=${teacher.id}&week=${wk || weekKey}`);
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

  const handleWeekChange = async (newWeek) => {
    setWeekKey(newWeek);
    const slotsData = await api(`/api/slots?week=${newWeek}`);
    setAllSlots(slotsData.slots || []);
    if (selectedTeacherForSlots) await loadTeacherSlots(selectedTeacherForSlots, newWeek);
  };

  const refreshSlots = async (teacher) => {
    const t = teacher || selectedTeacherForSlots;
    if (t) {
      const data = await api(`/api/slots?teacherId=${t.id}&week=${weekKey}`);
      setTeacherSlots(data.grid);
    }
    const slotsData = await api(`/api/slots?week=${weekKey}`);
    setAllSlots(slotsData.slots || []);
  };

  const handleBook = async (params) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      await refreshSlots();
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async (params) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      await refreshSlots();
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading) return <LoadingBox height="h-64" />;

  return (
    <div>
      {/* DERS PROGRAMI TAB — otomatik program oluşturucu (sidebar > Sistem) */}
      {tab === 'ders-programi' && (
        <ProgramOlusturucu api={api} showToast={showToast}
          activeClasses={[...new Set(students.map(s => s.cls))]} />
      )}

      {/* TEACHERS TAB — öğretmen listesi + inline detay sayfası (?ogretmen=ID) */}
      {tab === 'teachers' && (() => {
        const selT = expandedTeacherId ? teachers.find(x => x.id === expandedTeacherId) : null;

        // İnline detay sayfası — bir öğretmen seçiliyse liste yerine bunu göster.
        if (expandedTeacherId && selT) {
          const t = selT;
          const slotsReady = selectedTeacherForSlots?.id === t.id && teacherSlots;
          return (
            <div>
              <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
                <button onClick={() => setExpandedTeacherId(null)}
                  className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5">
                  <ChevronLeft size={16} /> Geri
                </button>
                <div className="flex gap-2 shrink-0">
                  <button className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5" onClick={() => { setEditTeacher(t); setShowTeacherForm(true); }}>
                    <Edit3 size={14} /> Düzenle
                  </button>
                  <button className="btn-ghost !px-3 !py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-1.5" onClick={async () => {
                    if (!confirm(`${t.name} silinsin mi?`)) return;
                    try { await api('/api/teachers',{method:'DELETE',body:JSON.stringify({id:t.id})}); showToast('Öğretmen silindi'); setExpandedTeacherId(null); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
                  }}>
                    <Trash2 size={14} /> Sil
                  </button>
                </div>
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
                    <h3 className="font-700 text-base" style={{ fontWeight:700 }}>{t.name}</h3>
                    <div className="text-caption">{(t.branches||[]).join(', ')}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(t.allowedGroups||[]).map(g => <span key={g} className="badge badge-info">{GROUPS[g]}</span>)}
                      {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'var(--bg-muted)',color:'var(--text-muted)' }}>Tüm gruplar</span>}
                    </div>
                  </div>
                </div>

                <div className="px-4 py-3" style={{ background: 'var(--bg-surface-2)' }}>
                  {/* Sekme başlığı + tarih nav (sadece Etütler sekmesinde) */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="pill-tabs">
                      {[['etutler','Etütler',CalendarRange],['gecmis','Etüt Geçmişi',Clock],['program','Program',CalendarDays]].map(([k,l,Icon]) => (
                        <button key={k} onClick={() => setExpandedTeacherTab(k)}
                          className={`pill-tab press-effect${expandedTeacherTab === k ? ' is-active' : ''}`}>
                          <Icon size={12} /> {l}
                        </button>
                      ))}
                    </div>
                    {expandedTeacherTab === 'etutler' && (
                      <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
                    )}
                  </div>

                  {/* Etütler sekmesi */}
                  {expandedTeacherTab === 'etutler' && (
                    slotsReady ? (
                      <TeacherBookingsList
                        bookedList={(() => {
                          const items = [];
                          ALL_DAYS.forEach(day => {
                            slotsForDay(day.index, slotTimes).forEach((slot, slotIdx) => {
                              const sd = teacherSlots[day.index]?.[slotIdx];
                              if (sd?.booked) items.push({
                                dayIndex: day.index, dayLabel: day.label,
                                slotId: slot.id, slotLabel: slot.label, slotIdx,
                                studentName: sd.studentName,
                                studentCls: (sd.studentCls||'').toUpperCase(),
                                studentId: sd.studentId,
                                bookedBy: sd.bookedBy || 'student',
                                fixed: !!sd.fixed,
                              });
                            });
                          });
                          return items;
                        })()}
                        listColorMap={{
                          student: { bg:'bg-indigo-50', border:'border-indigo-100', day:'text-indigo-700', time:'text-indigo-400', div:'bg-indigo-200', badge:'bg-indigo-100 text-indigo-500', label:'Öğrenci' },
                          teacher: { bg:'bg-emerald-50', border:'border-emerald-100', day:'text-emerald-700', time:'text-emerald-400', div:'bg-emerald-200', badge:'bg-emerald-100 text-emerald-600', label:'Öğretmen' },
                          director: { bg:'bg-amber-50', border:'border-amber-100', day:'text-amber-700', time:'text-amber-400', div:'bg-amber-200', badge:'bg-amber-100 text-amber-600', label:'Müdür' },
                        }}
                        onCancel={item => handleCancel({ teacherId: t.id, day: item.dayIndex, slotId: item.slotId })}
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
                        const items = [];
                        ALL_DAYS.forEach(day => {
                          slotsForDay(day.index, slotTimes).forEach((slot, slotIdx) => {
                            const sd = teacherSlots[day.index]?.[slotIdx];
                            if (sd?.booked) items.push({
                              day: day.index, dayLabel: day.label,
                              slotId: slot.id, slotLabel: slot.label,
                              studentName: sd.studentName,
                              studentCls: (sd.studentCls||'').toUpperCase(),
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

              {/* Sabit dersler (ön eşleştirme) — sekmeden bağımsız, her zaman görünür */}
              <div className="mt-4">
                <TeacherPresets
                  key={`presets-${t.id}`}
                  teacher={t}
                  showToast={showToast}
                  onSaved={(presets) => setTeachers(prev => prev.map(x => x.id === t.id ? { ...x, presets } : x))}
                />
              </div>
            </div>
          );
        }

        // Liste görünümü
        return (
          <div>
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğretmen ({teachers.length})</h3>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditTeacher(null); setShowTeacherForm(true); }}>
                  <Plus size={14} /> Öğretmen Ekle
                </button>
              </div>
            </div>
            <div className="grid gap-2">
              {teachers.map(t => (
                <div key={t.id} className="card card-interactive overflow-hidden">
                  <button className="w-full flex items-center gap-3 px-4 py-3.5 text-left" onClick={() => { setExpandedTeacherTab('etutler'); setExpandedTeacherId(t.id); }}>
                    <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
                      {t.photoUrl
                        ? <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover" />
                        : <User size={22} className="text-gray-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-600" style={{ fontWeight:600 }}>{t.name}</div>
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
              {teachers.length===0 && <div className="card p-8 text-center text-gray-400"><Users size={32} className="mx-auto mb-2 opacity-30" /><p>Henüz öğretmen eklenmemiş</p></div>}
            </div>
          </div>
        );
      })()}

      {/* STUDENTS TAB */}
      {tab === 'students' && (
        <div>
          {!expandedStudentId && (
            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğrenciler ({students.length})</h3>
              <div className="flex gap-2 flex-wrap">
                <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditStudent(null); setShowStudentForm(true); }}>
                  <Plus size={14} /> Öğrenci Ekle
                </button>
                {!isCounselor && (
                  <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => setShowCounselorForm(true)}>
                    <Compass size={14} /> Rehberlik Öğretmeni Ekle
                  </button>
                )}
              </div>
            </div>
          )}
          <StudentList students={students}
            onSelectChange={setExpandedStudentId}
            allSlots={allSlots} weekKey={weekKey}
            onCancelBooking={async ({ teacherId, day, slotId }) => {
              try {
                await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ teacherId, day, slotId, weekKey }) });
                showToast('Etüt iptal edildi');
                loadAll(weekKey);
              } catch(err) { showToast(err.message, 'error'); }
            }}
            onEdit={s => { setEditStudent(s); setShowStudentForm(true); }}
            onDelete={async s => {
              if (!confirm(`${s.name} silinsin mi?`)) return;
              try { await api('/api/students',{method:'DELETE',body:JSON.stringify({id:s.id})}); showToast('Öğrenci silindi'); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
            }}
            onDeleteClass={async (cls, clsStudents) => {
              if (!confirm(`${classLabel(cls)} sınıfındaki ${clsStudents.length} öğrenci silinsin mi?`)) return;
              try {
                await api('/api/students', { method: 'DELETE', body: JSON.stringify({ ids: clsStudents.map(s => s.id) }) });
                showToast(`${clsStudents.length} öğrenci silindi`);
                loadAll(weekKey);
              } catch(err) { showToast(err.message, 'error'); }
            }}
            onHistory={s => setHistoryTarget({ type: 'student', id: s.id, name: s.name })}
            pendingGuidance={pendingGuidance}
            onGuidanceReviewed={loadPendingGuidance} />
        </div>
      )}

      {tab === 'veliler' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Veli ({students.length})</h3>
          </div>
          <VeliPanel students={students} showToast={showToast} onChanged={() => loadAll(weekKey)} />
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

      {/* YOKLAMA TAB */}
      {tab === 'yoklama' && (
        <DirectorAttendanceView showToast={showToast} />
      )}

      {tab === 'muhasebe' && (
        <DirectorMuhasebeTab session={session} showToast={showToast} />
      )}
      {tab === 'kutuphane' && (
        <ResourceLibrary canManage userRole="director" userId="director"
          branches={allBranches()} showToast={showToast} />
      )}

      {tab === 'duyurular' && (
        <AnnouncementSender showToast={showToast} />
      )}

      {tab === 'denemeler' && (
        <div>
          <div className="pill-tabs mb-4">
            {[['upload','Deneme Yükle',Upload],['list','Yüklenen Denemeler',FileText],['optik','Optik Form',ScanLine]].map(([k,l,Icon]) => (
              <button key={k} onClick={() => setDenemeTab(k)}
                className={`pill-tab press-effect${denemeTab === k ? ' is-active' : ''}`}>
                <Icon size={13} /> {l}
              </button>
            ))}
          </div>
          {denemeTab === 'optik'
            ? <OptikFormTab showToast={showToast} />
            : <DirectorDenemeYonetimi showToast={showToast} view={denemeTab} />}
        </div>
      )}

      {/* Ders Saatleri sekmesi */}
      {tab === 'ders-saatleri' && (
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 15%, transparent)' }}>
              <Clock size={20} style={{ color: 'var(--brand,#6366f1)' }} />
            </div>
            <div>
              <h2 className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Ders Saatleri</h2>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Haftalık ders slot başlangıç ve bitiş saatlerini ayarla</p>
            </div>
          </div>
          {slotTimesLoading ? (
            <LoadingBox height="h-48" />
          ) : (
            <>
              <SlotTimeEditor
                weekday={slotWeekday}
                weekend={slotWeekend}
                etutSuresi={slotEtutSuresi}
                molaSuresi={slotMolaSuresi}
                onChange={(type, slots) => type === 'weekday' ? setSlotWeekday(slots) : setSlotWeekend(slots)}
                onMetaChange={(key, val) => key === 'etutSuresi' ? setSlotEtutSuresi(val) : setSlotMolaSuresi(val)}
              />
              <div className="flex justify-end mt-4">
                <button
                  className="btn-primary !px-6 !py-2.5"
                  disabled={savingSlotTimes || slotWeekday.length !== 12 || slotWeekend.length !== 12}
                  onClick={async () => {
                    setSavingSlotTimes(true);
                    try {
                      const payload = { weekday: slotWeekday, weekend: slotWeekend, etutSuresi: slotEtutSuresi, molaSuresi: slotMolaSuresi };
                      await api('/api/slot-times', { method: 'POST', body: JSON.stringify(payload) });
                      updateSlotTimes(payload);
                      showToast('Saatler kaydedildi ve uygulandı');
                    } catch (e) { showToast(e.message, 'error'); }
                    finally { setSavingSlotTimes(false); }
                  }}
                >
                  {savingSlotTimes ? 'Kaydediliyor…' : 'Saatleri Kaydet'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modals */}
      {showTeacherForm && (
        <TeacherForm initial={editTeacher} onClose={() => { setShowTeacherForm(false); setEditTeacher(null); }}
          onSave={async data => {
            try {
              if (editTeacher) { await api('/api/teachers',{method:'PUT',body:JSON.stringify({id:editTeacher.id,...data})}); showToast('Öğretmen güncellendi'); }
              else { await api('/api/teachers',{method:'POST',body:JSON.stringify(data)}); showToast('Öğretmen eklendi'); }
              setShowTeacherForm(false); setEditTeacher(null); loadAll(weekKey);
            } catch(err){showToast(err.message,'error');}
          }} />
      )}
      {showCounselorForm && !isCounselor && (
        <Modal title="Rehberlik Öğretmeni Ekle" onClose={() => setShowCounselorForm(false)}>
          <CounselorSection showToast={showToast} />
        </Modal>
      )}
      {showStudentForm && (
        <StudentForm initial={editStudent} onClose={() => { setShowStudentForm(false); setEditStudent(null); }}
          onSwitchToImport={() => { setShowStudentForm(false); setEditStudent(null); setShowImport(true); }}
          onSave={async data => {
            try {
              if (editStudent) { await api('/api/students',{method:'PUT',body:JSON.stringify({id:editStudent.id,...data})}); showToast('Öğrenci güncellendi'); }
              else { await api('/api/students',{method:'POST',body:JSON.stringify(data)}); showToast('Öğrenci eklendi'); }
              setShowStudentForm(false); setEditStudent(null); loadAll(weekKey);
            } catch(err){showToast(err.message,'error');}
          }} />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} showToast={showToast} onDone={() => { setShowImport(false); loadAll(weekKey); }} />
      )}
    </div>
  );
}
