'use client';

// Öğrenci listesi (gruplu) + öğrenci detay görünümü (StudentExpandedView) +
// sınıf ders programı modalı (ClassScheduleModal).
import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, ClipboardList, Clock, Calendar, ChevronRight, Edit3, GraduationCap, Trash2, X } from 'lucide-react';
import { classLabel, ALL_DAYS } from '@/lib/constants';
import { GROUPS, api, Modal, guidanceSubjectsFor } from './shared';
import { StudentAttendanceView } from './Attendance';
import { StudentBookingsView } from '../StudentPanel';
import RehberlikAccordion from '../rehberlik/RehberlikAccordion';
import StudentGuidanceView from '../rehberlik/StudentGuidanceView';

function StudentExpandedView({ student, allSlots, onCancelBooking, onGuidanceReviewed }) {
  const [tab, setTab] = useState('rehberlik');
  return (
    <div className="px-3 py-2">
      <div className="flex gap-1 mb-3 p-1 bg-white rounded-full w-fit border border-gray-200 shadow-sm">
        {[
          ['rehberlik', 'Rehberlik', BookOpen],
          ['devamsizlik', 'Devamsızlık Bilgisi', ClipboardList],
          ['etut', 'Etüt Geçmişi', Clock],
        ].map(([key, label, Icon]) => {
          const active = tab === key;
          return (
            <button key={key} onClick={() => setTab(key)}
              className={`px-3.5 py-1.5 rounded-full text-xs flex items-center gap-1.5 transition-all ${active ? 'text-white shadow-md' : 'text-gray-500 hover:text-gray-700'}`}
              style={{
                fontWeight: 600,
                background: active ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : undefined,
              }}>
              <Icon size={12} /> {label}
            </button>
          );
        })}
      </div>
      {tab === 'etut' && (
        <StudentBookingsView student={student} allSlots={allSlots} onCancel={onCancelBooking} />
      )}
      {tab === 'devamsizlik' && (
        <StudentAttendanceView studentId={student.id} />
      )}
      {tab === 'rehberlik' && (
        <RehberlikAccordion
          subjects={guidanceSubjectsFor(student.cls)}
          editable={true}
          studentId={student.id}
          solvedContent={<StudentGuidanceView studentId={student.id} onReviewed={onGuidanceReviewed} />}
        />
      )}
    </div>
  );
}

export function StudentList({ students, allSlots, weekKey, onCancelBooking, onEdit, onDelete, onDeleteClass, onHistory, pendingGuidance, onGuidanceReviewed }) {
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [openCls, setOpenCls] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [scheduleCls, setScheduleCls] = useState(null);

  const grouped = useMemo(() => {
    const q = searchQ.toLowerCase();
    const groupOrder = { ortaokul: 0, lise: 1, mezun: 2 };
    const clsSort = cls => cls.startsWith('m') ? parseInt(cls.slice(1)) : parseInt(cls);
    const sorted = students
      .filter(s =>
        (s.name.toLowerCase().includes(q)||s.cls.toLowerCase().includes(q)||s.username?.toLowerCase().includes(q)) &&
        (!filterGroup||s.group===filterGroup)
      )
      .sort((a, b) => {
        const gDiff = (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
        if (gDiff !== 0) return gDiff;
        return clsSort(a.cls) - clsSort(b.cls);
      });
    const groups = [];
    for (const s of sorted) {
      if (!groups.length || groups[groups.length-1].cls !== s.cls) {
        groups.push({ cls: s.cls, label: classLabel(s.cls), group: s.group, students: [] });
      }
      groups[groups.length-1].students.push(s);
    }
    return groups;
  }, [students, searchQ, filterGroup]);

  const toggle = cls => setOpenCls(prev => prev === cls ? null : cls);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input text-sm" placeholder="İsim, sınıf..." aria-label="Öğrenci ara" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <select className="input !w-auto text-sm" aria-label="Gruba göre filtrele" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">Tüm Gruplar</option>
          {Object.entries(GROUPS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        {grouped.length === 0 && <div className="card p-8 text-center text-gray-400"><GraduationCap size={32} className="mx-auto mb-2 opacity-30" /><p className="text-caption">Arama kriterinizle eşleşen öğrenci yok</p></div>}
        {grouped.map(grp => {
          const isOpen = openCls === grp.cls;
          const dotColor = grp.group==='lise'
            ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
            : grp.group==='ortaokul'
            ? 'linear-gradient(135deg,#22c55e,#16a34a)'
            : 'linear-gradient(135deg,#f59e0b,#d97706)';
          const colors = { dot: dotColor };
          return (
            <div key={grp.cls}>
              <div className="flex items-center justify-between px-3 py-2 rounded-lg text-xs font-700 transition-colors hover:brightness-95" style={{ fontWeight:700, background:'var(--bg-muted)', color:'var(--text-secondary)' }}>
                <button onClick={() => toggle(grp.cls)} className="flex items-center gap-2 flex-1 text-left">
                  <span>{grp.label} <span className="font-500 opacity-60" style={{ fontWeight:500 }}>({grp.students.length} öğrenci)</span></span>
                  <ChevronRight size={14} className="transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                </button>
                <div className="flex items-center gap-1 ml-2">
                  <button onClick={() => setScheduleCls(grp.cls)}
                    className="p-1 rounded hover:bg-indigo-100 text-slate-600 hover:text-indigo-600 transition-colors"
                    title="Sınıfın ders programı">
                    <Calendar size={12} />
                  </button>
                  {onDeleteClass && (
                    <button onClick={() => onDeleteClass(grp.cls, grp.students)}
                      className="p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                      title="Sınıfı sil">
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
              {isOpen && (
                <div className="grid gap-1.5 mt-1.5 ml-2">
                  {grp.students.map(s => (
                    <div key={s.id} className={`card overflow-hidden text-sm ${expandedId === s.id ? '' : 'card-interactive'}`}>
                      <div className="flex items-center justify-between px-3 py-3">
                        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                          <div className="relative shrink-0">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-700"
                              style={{ background: colors.dot, fontWeight:700 }}>
                              {s.name.slice(0,2).toUpperCase()}
                            </div>
                            {pendingGuidance?.[s.id] > 0 && (
                              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-700 flex items-center justify-center" style={{ fontWeight: 700 }}>
                                {pendingGuidance[s.id]}
                              </span>
                            )}
                          </div>
                          <span className="font-600 truncate" style={{ fontWeight:600 }}>{s.name}</span>
                          <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform ml-auto"
                            style={{ transform: expandedId === s.id ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                        </button>
                        <div className="flex gap-2 shrink-0 ml-2">
                          <button className="btn-ghost !px-2 !py-1.5" onClick={() => onEdit(s)}><Edit3 size={12} /></button>
                          <button className="btn-ghost !px-2 !py-1.5 text-red-400 hover:bg-red-50" onClick={() => onDelete(s)}><Trash2 size={12} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {scheduleCls && (
        <ClassScheduleModal cls={scheduleCls} onClose={() => setScheduleCls(null)} />
      )}
      {expandedId && (() => {
        const st = students.find(x => x.id === expandedId);
        if (!st) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div role="dialog" aria-modal="true" aria-label="Öğrenci detayı" className="modal w-full max-w-2xl max-h-[90vh] flex flex-col animate-modal-in">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
                <h3 className="font-700 text-base truncate" style={{ fontWeight: 700 }}>
                  {st.name} <span className="font-500 text-sm" style={{ fontWeight: 500, color: 'var(--text-muted)' }}>· {classLabel(st.cls)}</span>
                </h3>
                <button onClick={() => setExpandedId(null)} className="p-2 rounded-lg hover:bg-gray-100 shrink-0" title="Kapat"><X size={18} /></button>
              </div>
              <div className="overflow-y-auto">
                <StudentExpandedView student={st} allSlots={allSlots} onCancelBooking={onCancelBooking} onGuidanceReviewed={onGuidanceReviewed} />
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function ClassScheduleModal({ cls, onClose }) {
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api(`/api/class-schedule?cls=${encodeURIComponent(cls)}`);
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
    const dayLessons = {};
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
    const result = [];
    for (let i = 0; i < maxLessons; i++) {
      const row = { lessonNo: i + 1, byDay: {} };
      for (const day of visibleDays) {
        row.byDay[day.index] = dayLessons[day.index][i] || null;
      }
      result.push(row);
    }
    return result;
  }, [schedule, visibleDays]);

  return (
    <Modal title={`${cls.toUpperCase()} – Ders Programı`} onClose={onClose} wide>
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
                          <div className="text-[11px] font-700 text-blue-700 truncate" style={{ fontWeight: 700 }}>{lesson.teacherName}</div>
                          <div className="text-[9px] text-blue-400 truncate">{lesson.subBranch || lesson.branch}</div>
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
      )}
    </Modal>
  );
}

