'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, Trash2, Edit3, Clock, User, ChevronRight, LayoutGrid, ClipboardList
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
import ProgramEditor from './director/ProgramEditor';
import { useUrlTab } from './useUrlTab';
import OptikFormTab from './director/OptikFormTab';
import ResourceLibrary from './library/ResourceLibrary';
// page.js bunu DirectorPanel'den import ediyor — yol değişmesin diye re-export.
export { DirectorSettingsModal } from './director/Settings';

// ─── MAIN DIRECTOR PANEL ────────────────────────────────────────────────────────
export default function DirectorPanel({ session, showToast }) {
  // Rehber (counselor) = müdür paneli EKSİ muhasebe. Sekme listesi role göre.
  const isCounselor = session?.role === 'counselor';
  const validTabs = isCounselor
    ? ['teachers', 'students', 'yoklama', 'kutuphane']
    : ['teachers', 'students', 'yoklama', 'muhasebe', 'kutuphane'];
  const [tab, setTab] = useUrlTab('teachers', validTabs);
  const [showProgramOlusturucuModal, setShowProgramOlusturucuModal] = useState(false);
  const [showDenemelerModal, setShowDenemelerModal] = useState(false);
  const [denemeTab, setDenemeTab] = useState('denemeler'); // modal içi: 'denemeler' | 'optik'
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editTeacher, setEditTeacher] = useState(null);
  const [editStudent, setEditStudent] = useState(null);
  const [selectedTeacherForSlots, setSelectedTeacherForSlots] = useState(null);
  const [teacherSlots, setTeacherSlots] = useState(null);
  const [programTeacher, setProgramTeacher] = useState(null);
  const [expandedTeacherId, setExpandedTeacherId] = useState(null);
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-xl w-fit flex-wrap">
        {[['teachers','Öğretmenler'],['students','Rehberlik'],['yoklama','Yoklama'],...(isCounselor ? [] : [['muhasebe','💰 Muhasebe']]),['kutuphane','Kütüphane']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab===key?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight:600 }}>{label}</button>
        ))}
      </div>

      {/* TEACHERS TAB */}
      {tab === 'teachers' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğretmenler ({teachers.length})</h3>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditTeacher(null); setShowTeacherForm(true); }}>
                <Plus size={14} /> Öğretmen Ekle
              </button>
              <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => setShowProgramOlusturucuModal(true)}>
                <LayoutGrid size={14} /> Ders Programı
              </button>
            </div>
          </div>
          <div className="grid gap-2">
            {teachers.map(t => {
              const isOpen = expandedTeacherId === t.id;
              return (
                <div key={t.id} className={`card overflow-hidden transition-all duration-200 ${isOpen ? '' : 'hover:shadow-lg hover:border-indigo-400 hover:-translate-y-px hover:bg-indigo-50/30'}`}>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <button className="flex items-center gap-3 text-left flex-1 min-w-0" onClick={async () => {
                      if (isOpen) { setExpandedTeacherId(null); return; }
                      setExpandedTeacherId(t.id);
                      await loadTeacherSlots(t);
                    }}>
                      <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-gray-100 flex items-center justify-center">
                        {t.photoUrl
                          ? <img src={t.photoUrl} alt={t.name} className="w-full h-full object-cover" />
                          : <User size={22} className="text-gray-400" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-600" style={{ fontWeight:600 }}>{t.name}</div>
                        <div className="text-xs text-gray-500">{(t.branches||[]).join(', ')}</div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(t.allowedGroups||[]).map(g => <span key={g} className="badge" style={{ background:'#e0e7ff',color:'#4338ca' }}>{GROUPS[g]}</span>)}
                          {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'#f3f4f6',color:'#9ca3af' }}>Tüm gruplar</span>}
                        </div>
                      </div>
                      <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform mx-2" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                    </button>
                    <div className="flex gap-2 shrink-0">
                      <button className="btn-ghost !px-3 !py-2" onClick={() => { setEditTeacher(t); setShowTeacherForm(true); }}><Edit3 size={14} /></button>
                      <button className="btn-ghost !px-3 !py-2 text-red-400 hover:bg-red-50" onClick={async () => {
                        if (!confirm(`${t.name} silinsin mi?`)) return;
                        try { await api('/api/teachers',{method:'DELETE',body:JSON.stringify({id:t.id})}); showToast('Öğretmen silindi'); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
                      }}><Trash2 size={14} /></button>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="border-t border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
                        <div className="flex gap-2 shrink-0">
                          <button className="btn-ghost !px-2.5 !py-1.5 text-gray-600" onClick={() => setHistoryTarget({ type: 'teacher', id: t.id, name: t.name })} title="Geçmiş etütler">
                            <Clock size={14} />
                          </button>
                          <button className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-sm" onClick={() => setProgramTeacher(t)}>
                            <LayoutGrid size={13} /> Program
                          </button>
                        </div>
                      </div>
                      {selectedTeacherForSlots?.id === t.id && teacherSlots ? (
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
                        <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {teachers.length===0 && <div className="card p-8 text-center text-gray-400"><Users size={32} className="mx-auto mb-2 opacity-30" /><p>Henüz öğretmen eklenmemiş</p></div>}
          </div>
        </div>
      )}

      {/* STUDENTS TAB */}
      {tab === 'students' && (
        <div>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğrenciler ({students.length})</h3>
            <div className="flex gap-2 flex-wrap">
              <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditStudent(null); setShowStudentForm(true); }}>
                <Plus size={14} /> Öğrenci Ekle
              </button>
              <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => setShowDenemelerModal(true)}>
                <ClipboardList size={14} /> Denemeler
              </button>
            </div>
          </div>
          <StudentList students={students}
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
      {programTeacher && (
        <ProgramEditor teacher={programTeacher} students={students} showToast={showToast}
          onClose={() => { setProgramTeacher(null); loadAll(weekKey); }} />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} showToast={showToast} onDone={() => { setShowImport(false); loadAll(weekKey); }} />
      )}
      {showProgramOlusturucuModal && (
        <Modal title="Ders Programı Oluştur" onClose={() => setShowProgramOlusturucuModal(false)} xwide lockClose>
          <ProgramOlusturucu api={api} showToast={showToast}
            activeClasses={[...new Set(students.map(s => s.cls))]} />
        </Modal>
      )}
      {showDenemelerModal && (
        <Modal title="Denemeler" onClose={() => setShowDenemelerModal(false)} xwide lockClose>
          <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-xl w-fit">
            {[['denemeler','📊 Denemeler'],['optik','🖊️ Optik Form']].map(([k,l]) => (
              <button key={k} onClick={() => setDenemeTab(k)}
                className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${denemeTab===k?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
                style={{ fontWeight: 600 }}>{l}</button>
            ))}
          </div>
          {denemeTab === 'denemeler'
            ? <DirectorDenemeYonetimi showToast={showToast} />
            : <OptikFormTab showToast={showToast} />}
        </Modal>
      )}
    </div>
  );
}
