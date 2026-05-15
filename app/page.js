'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Users, LogOut, Plus, Trash2, Edit3, Save, X,
  Search, Calendar, Clock, User, Check,
  BookMarked, GraduationCap, Shield, ChevronLeft, ChevronRight,
  RefreshCw, Settings, Lock, LayoutGrid, List, ClipboardList, Phone
} from 'lucide-react';

const BRANCHES = ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İnkılap Tarihi', 'İngilizce'];

function allowedBranchesForClass(cls) {
  const grade = Math.floor(parseInt(cls) / 100);
  if (grade === 7) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  if (grade === 8) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya'];
}

const WEEKDAY_SLOTS = [
  { id: 'w1',  label: '09:45–10:20' },
  { id: 'w2',  label: '10:30–11:05' },
  { id: 'w3',  label: '11:15–11:50' },
  { id: 'w4',  label: '12:00–12:35' },
  { id: 'w5',  label: '13:30–14:05' },
  { id: 'w6',  label: '14:15–14:50' },
  { id: 'w7',  label: '15:00–15:35' },
  { id: 'w8',  label: '15:45–16:20' },
  { id: 'w9',  label: '16:30–17:05' },
  { id: 'w10', label: '17:15–17:50' },
  { id: 'w11', label: '18:00–18:35' },
];
const WEEKEND_SLOTS = [
  { id: 'e1',  label: '09:30–10:05' },
  { id: 'e2',  label: '10:15–10:50' },
  { id: 'e3',  label: '11:00–11:35' },
  { id: 'e4',  label: '11:45–12:20' },
  { id: 'e5',  label: '12:30–13:05' },
  { id: 'e6',  label: '13:15–13:50' },
  { id: 'e7',  label: '14:30–15:05' },
  { id: 'e8',  label: '15:15–15:50' },
  { id: 'e9',  label: '16:00–16:35' },
  { id: 'e10', label: '16:45–17:20' },
];
const ALL_DAYS = [
  { index: 0, label: 'Pazartesi', short: 'Pzt', weekend: false },
  { index: 1, label: 'Salı',      short: 'Sal', weekend: false },
  { index: 2, label: 'Çarşamba',  short: 'Çar', weekend: false },
  { index: 3, label: 'Perşembe',  short: 'Per', weekend: false },
  { index: 4, label: 'Cuma',      short: 'Cum', weekend: false },
  { index: 5, label: 'Cumartesi', short: 'Cmt', weekend: true  },
  { index: 6, label: 'Pazar',     short: 'Paz', weekend: true  },
];

function slotsForDay(dayIndex) {
  return dayIndex >= 5 ? WEEKEND_SLOTS : WEEKDAY_SLOTS;
}
const GROUPS = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };
const MEZUN_ONLY_LESSON_SLOTS = ['w1','w2','w3','w4','w5','w6'];
const MEZUN_FORBIDDEN_ETUT_SLOT = 'w9';
const STUDENT_GROUPS = {
  ortaokul: { label: 'Ortaokul', classes: ['701','702','801','802'] },
  lise: { label: 'Lise', classes: ['101','102','201','202','301','302','303','304','305','306','401','402','403','404','405','406','407','408','409','410'] },
  mezun: { label: 'Mezun', classes: ['m1','m2','m3','m4','m5','m6','m7','m8','m9','m10'] },
};

function classLabel(cls) {
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    return `Mezun ${n <= 5 ? 'Sayısal' : 'EA'} (${cls.toUpperCase()})`;
  }
  const g = Math.floor(parseInt(cls) / 100);
  const sec = parseInt(cls.slice(1));
  const gNames = { 7:'7.Sınıf', 8:'8.Sınıf', 1:'9.Sınıf', 2:'10.Sınıf', 3:'11.Sınıf', 4:'12.Sınıf' };
  let type = '';
  if (g === 3) type = sec <= 3 ? ' Sayısal' : ' EA';
  if (g === 4) type = sec <= 5 ? ' Sayısal' : ' EA';
  return `${gNames[g] || g+'.Sınıf'}${type} (${cls})`;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

function Toast({ toast }) {
  if (!toast) return null;
  const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-indigo-500' };
  return (
    <div className={`fixed bottom-6 left-1/2 z-50 animate-fade-up px-5 py-3 rounded-xl text-white text-sm font-medium shadow-xl ${colors[toast.type] || colors.success}`}>
      {toast.msg}
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`card-elevated w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} animate-slide-in max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>{children}</label>;
}
function FormField({ label, children }) {
  return <div className="mb-4"><Label>{label}</Label>{children}</div>;
}

function getWeekKey(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function weekRangeLabel(weekKey) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const jan4 = new Date(parseInt(year), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const months = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
  const startStr = `${monday.getDate()} ${months[monday.getMonth()]}`;
  const endStr = `${sunday.getDate()} ${months[sunday.getMonth()]}`;
  const yearStr = sunday.getFullYear();
  return { startStr, endStr, yearStr };
}

function WeekNav({ weekKey, onPrev, onNext }) {
  const { startStr, endStr, yearStr } = weekRangeLabel(weekKey);
  return (
    <div className="flex items-center gap-1">
      <button onClick={onPrev} className="btn-ghost !p-2"><ChevronLeft size={16} /></button>
      <span className="text-xs text-gray-700 text-center whitespace-nowrap">
        {startStr} – {endStr} <strong style={{ fontWeight:700 }}>{yearStr}</strong>
      </span>
      <button onClick={onNext} className="btn-ghost !p-2"><ChevronRight size={16} /></button>
    </div>
  );
}

function getAdjacentWeek(weekKey, delta) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const date = new Date(parseInt(year), 0, 1 + (week - 1) * 7);
  date.setDate(date.getDate() + delta * 7);
  const d = new Date(date);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const w = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

// ─── SLOT GRID ─────────────────────────────────────────────────────────────────
function SlotGrid({ grid, program, teacher, weekKey, session, students, onBook, onCancel, hideEmptyDays }) {
  const [bookingSlot, setBookingSlot] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [fixedBooking, setFixedBooking] = useState(false);

  const filteredStudents = useMemo(() => {
    if (!students) return [];
    const q = searchQ.toLowerCase();
    const allowedGroups = teacher.allowedGroups || [];
    return students.filter(s => {
      if (allowedGroups.length === 0 || !allowedGroups.includes(s.group)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) ||
        s.cls.toLowerCase().includes(q) ||
        classLabel(s.cls).toLowerCase().includes(q);
    }).slice(0, 20);
  }, [students, searchQ, teacher.allowedGroups]);

  // hideEmptyDays=true ise müdürün hiç slot tanımlamamış olduğu günleri gizle
  const visibleDays = useMemo(() => {
    if (!hideEmptyDays) return ALL_DAYS;
    // program varsa: o gün herhangi bir slot tipi tanımlıysa göster
    if (program && Object.keys(program).length > 0) {
      return ALL_DAYS.filter(day => {
        const dayProg = program[String(day.index)] || {};
        return Object.values(dayProg).some(entry => entry && entry.type);
      });
    }
    // program yoksa grid'e bak: en az bir disabled olmayan slot varsa göster
    if (!grid) return ALL_DAYS;
    return ALL_DAYS.filter(day => {
      const daySlots = slotsForDay(day.index);
      return daySlots.some((_, slotIdx) => {
        const sd = grid[day.index]?.[slotIdx];
        return sd && !sd.disabled;
      });
    });
  }, [grid, program, hideEmptyDays]);

  const handleCellClick = (dayIndex, slotIdx, slotData, isForceOpen = false) => {
    if (slotData.booked) return;
    if (slotData.disabled && !isForceOpen) return;
    const slot = slotsForDay(dayIndex)[slotIdx];
    const day = ALL_DAYS.find(d => d.index === dayIndex);
    setBookingSlot({ dayIndex, slotIdx, slotId: slot.id, slotLabel: slot.label, dayLabel: day.label, forceOpen: isForceOpen });
    setSearchQ('');
    setSelectedStudent(null);
    setFixedBooking(false);
  };

  const confirmBook = async () => {
    if (!bookingSlot) return;
    let studentId = session.role === 'student' ? session.id : selectedStudent?.id;
    if (!studentId) return;
    await onBook({ teacherId: teacher.id, day: bookingSlot.dayIndex, slotId: bookingSlot.slotId, studentId, weekKey, forceOpen: bookingSlot.forceOpen, fixed: fixedBooking });
    setBookingSlot(null);
  };

  const colCount = visibleDays.length;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-xs text-gray-400 font-600 w-24" style={{ fontWeight: 600 }}>Saat</th>
              {visibleDays.map(day => (
                <th key={day.index} className={`text-center py-2 px-1 text-xs font-600 ${day.weekend ? 'text-indigo-400' : 'text-gray-500'}`} style={{ fontWeight: 600, width: `calc((100% - 6rem) / ${colCount})` }}>
                  {day.short}
                  {day.weekend && <span className="block text-[9px] text-indigo-300">H.sonu</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const hasWeekday = visibleDays.some(d => !d.weekend);
              const hasWeekend = visibleDays.some(d => d.weekend);
              const maxRows = Math.max(
                hasWeekday ? WEEKDAY_SLOTS.length : 0,
                hasWeekend ? WEEKEND_SLOTS.length : 0,
              );
              return Array.from({ length: maxRows }, (_, rowIdx) => {
                const wdSlot = WEEKDAY_SLOTS[rowIdx];
                const weSlot = WEEKEND_SLOTS[rowIdx];
                const labelSlot = hasWeekday ? wdSlot : weSlot;
                if (!labelSlot) return null;
                return (
                  <tr key={rowIdx} className="border-t border-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-500 font-500 whitespace-nowrap" style={{ fontWeight: 500 }}>
                      {hasWeekday && wdSlot ? wdSlot.label : ''}
                      {hasWeekday && hasWeekend && weSlot ? <span className="block text-[10px] text-indigo-400">{weSlot.label}</span> : ''}
                      {!hasWeekday && weSlot ? weSlot.label : ''}
                    </td>
                    {visibleDays.map(day => {
                      const slots = slotsForDay(day.index);
                      const slot = slots[rowIdx];
                      if (!slot) return <td key={day.index} className="py-1 px-1"><div className="rounded-lg py-2 bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs">—</div></td>;
                      const slotData = (grid && grid[day.index] && grid[day.index][rowIdx]) || { booked: false, disabled: true };
                      const progEntry = program?.[String(day.index)]?.[slot.id];
                      return <SlotCell key={day.index} slotData={slotData} progEntry={progEntry} slot={slot} dayIndex={day.index} slotIdx={rowIdx} session={session} teacher={teacher} onCellClick={handleCellClick} onCancel={onCancel} weekKey={weekKey} />;
                    })}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {bookingSlot && (
        <Modal title={`Rezervasyon: ${bookingSlot.dayLabel} ${bookingSlot.slotLabel}`} onClose={() => setBookingSlot(null)}>
          {bookingSlot.forceOpen && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              Bu saat şablonda kapalıdır. Yalnızca bu hafta için açılıp rezerve edilecek — şablon değişmez.
            </div>
          )}
          {session.role === 'student' ? (
            <div>
              <p className="text-sm text-gray-600 mb-4"><strong>{teacher.name}</strong> – {teacher.branch} dersine kayıt oluyorsunuz.</p>
              <div className="flex gap-3">
                <button className="btn-primary flex-1" onClick={confirmBook}>Onayla</button>
                <button className="btn-ghost" onClick={() => setBookingSlot(null)}>İptal</button>
              </div>
            </div>
          ) : (
            <div>
              <FormField label="Öğrenci Ara">
                <input className="input" placeholder="İsim, sınıf kodu (701) veya sınıf adı..." value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSelectedStudent(null); }} autoFocus />
              </FormField>
              <div className="max-h-52 overflow-y-auto space-y-1 mb-4">
                {filteredStudents.map(s => (
                  <button key={s.id} onClick={() => setSelectedStudent(s)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedStudent?.id === s.id ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'hover:bg-gray-50'}`}>
                    <span className="font-600" style={{ fontWeight: 600 }}>{s.name}</span>
                    <span className="text-gray-400 ml-2 text-xs">{classLabel(s.cls)}</span>
                  </button>
                ))}
                {filteredStudents.length === 0 && searchQ && <p className="text-sm text-gray-400 text-center py-4">Öğrenci bulunamadı</p>}
              </div>
              {session.role === 'director' && (
                <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                  <input type="checkbox" checked={fixedBooking} onChange={e => setFixedBooking(e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-600" />
                  <span className="text-sm text-gray-700 font-500" style={{ fontWeight: 500 }}>Sabit rezervasyon</span>
                  <span className="text-xs text-gray-400">(her hafta otomatik tekrarlanır)</span>
                </label>
              )}
              <div className="flex gap-3">
                <button className="btn-primary flex-1" onClick={confirmBook} disabled={!selectedStudent}>
                  {selectedStudent ? `${selectedStudent.name} için Rezerve Et` : 'Öğrenci Seçin'}
                </button>
                <button className="btn-ghost" onClick={() => setBookingSlot(null)}>İptal</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function SlotCell({ slotData, progEntry, slot, dayIndex, slotIdx, session, teacher, onCellClick, onCancel, weekKey }) {
  const isDirector = session.role === 'director';
  const isLesson = progEntry?.type === 'ders';

  if (slotData.disabled) {
    // Ders slotu: sınıf bilgisini göster
    if (isLesson) {
      const cls = progEntry.cls ? progEntry.cls.toUpperCase() : '—';
      return (
        <td className="py-1 px-1">
          <div className="rounded-lg py-1.5 px-1 text-center bg-blue-50 border border-blue-100 select-none">
            <div className="text-[10px] font-600 text-blue-700 truncate" style={{ fontWeight: 600 }}>{cls}</div>
            <div className="text-[9px] text-blue-400">Ders</div>
          </div>
        </td>
      );
    }
    // Müdür: kapalı slotu bu hafta için açıp rezerve edebilir
    if (isDirector) {
      return (
        <td className="py-1 px-1">
          <button
            onClick={() => onCellClick(dayIndex, slotIdx, slotData, true)}
            title="Ek slot aç ve rezervasyon yap"
            className="w-full rounded-lg py-2 px-1 text-center border border-dashed border-amber-400 bg-amber-50 hover:border-amber-500 hover:bg-amber-100 transition-colors text-xs text-amber-400 hover:text-amber-600"
          >
            +
          </button>
        </td>
      );
    }
    return (
      <td className="py-1 px-1">
        <div className="rounded-lg py-2 px-1 text-center text-xs text-gray-200 bg-gray-50 border border-gray-100 select-none">✕</div>
      </td>
    );
  }

  if (slotData.booked) {
    const bookedBy = slotData.bookedBy || 'student';
    const canCancel = isDirector ||
      (session.role === 'student' && slotData.studentId === session.id) ||
      (session.role === 'teacher' && teacher.id === session.id && bookedBy === 'teacher');

    const clsDisplay = (slotData.studentCls || '').toUpperCase();

    const colorMap = {
      student: { bg: 'bg-indigo-50', border: 'border-indigo-100', name: 'text-indigo-700', sub: 'text-indigo-400', label: 'Öğrenci' },
      teacher: { bg: 'bg-emerald-50', border: 'border-emerald-100', name: 'text-emerald-700', sub: 'text-emerald-400', label: 'Öğretmen' },
      director: { bg: 'bg-amber-50', border: 'border-amber-100', name: 'text-amber-700', sub: 'text-amber-400', label: 'Müdür' },
    };
    const c = colorMap[bookedBy] || colorMap.student;

    return (
      <td className="py-1 px-1">
        <div className={`rounded-lg py-1.5 px-1 text-center ${c.bg} border ${c.border} relative group overflow-hidden`}>
          <div className={`text-xs font-600 ${c.name} truncate`} style={{ fontWeight: 600 }}>{slotData.studentName}</div>
          <div className={`text-[10px] ${c.sub} truncate`}>{clsDisplay}</div>
          <div className={`text-[9px] ${c.sub} opacity-70`}>{c.label}</div>
          {slotData.fixed && (
            <div className="text-[8px] px-1 py-0.5 rounded bg-violet-100 text-violet-600 font-600 leading-none mt-0.5 inline-block" style={{ fontWeight: 600 }}>SABİT</div>
          )}
          {canCancel && (
            <button onClick={() => onCancel({ teacherId: teacher.id, day: dayIndex, slotId: slot.id, weekKey })}
              className={`absolute top-0.5 right-0.5 p-0.5 rounded hover:bg-red-100 transition-opacity ${isDirector ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <X size={10} className="text-red-400" />
            </button>
          )}
        </div>
      </td>
    );
  }

  return (
    <td className="py-1 px-1">
      <button
        onClick={() => onCellClick(dayIndex, slotIdx, slotData)}
        className="w-full rounded-lg py-2 px-1 text-center border border-dashed border-emerald-400 bg-emerald-50 hover:border-emerald-500 hover:bg-emerald-100 transition-colors text-xs text-emerald-500 hover:text-emerald-700"
      >
        +
      </button>
    </td>
  );
}

// ─── ŞABLON EDITÖRÜ ────────────────────────────────────────────────────────────
// ─── PROGRAM EDİTÖRÜ (Ders + Etüt birleşik) ────────────────────────────────────
// program[dayIndex][slotId] = { type: 'ders'|'etut'|null, cls?, studentId?, studentName?, studentCls?, fixed? }
function ProgramEditor({ teacher, onClose, showToast, students }) {
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // activeCell: { dayIndex, slotId } — hangi hücre seçili
  const [activeCell, setActiveCell] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/api/program?teacherId=${teacher.id}`);
        setProgram(data);
      } catch {
        setProgram({});
      } finally {
        setLoading(false);
      }
    })();
  }, [teacher.id]);

  function getEntry(dayIndex, slotId) {
    return program?.[String(dayIndex)]?.[slotId] || null;
  }

  function setEntry(dayIndex, slotId, entry) {
    setProgram(prev => ({
      ...prev,
      [String(dayIndex)]: {
        ...(prev?.[String(dayIndex)] || {}),
        [slotId]: entry,
      },
    }));
  }

  function clearEntry(dayIndex, slotId) {
    setProgram(prev => {
      const day = { ...(prev?.[String(dayIndex)] || {}) };
      delete day[slotId];
      return { ...prev, [String(dayIndex)]: day };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api('/api/program', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, program }) });
      showToast('Program kaydedildi ve uygulandı');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const allowedGroups = teacher.allowedGroups?.length ? teacher.allowedGroups : Object.keys(STUDENT_GROUPS);
  const allClasses = allowedGroups.flatMap(g => STUDENT_GROUPS[g]?.classes || []);
  const allowedStudents = students
    ? students.filter(s => !teacher.allowedGroups?.length || teacher.allowedGroups.includes(s.group))
    : [];

  // Aktif hücre için tip/değer seçici — tüm state lokal, sadece Kaydet'te setEntry çağrılır
  function CellEditor({ dayIndex, slotId }) {
    const existing = getEntry(dayIndex, slotId);
    const [type, setType] = useState(existing?.type || null);
    const [cls, setCls] = useState(existing?.cls || '');
    const [studentId, setStudentId] = useState(existing?.studentId || '');
    const [studentName, setStudentName] = useState(existing?.studentName || '');
    const [studentCls, setStudentCls] = useState(existing?.studentCls || '');
    const [fixed, setFixed] = useState(existing?.fixed || false);
    const [studentSearch, setStudentSearch] = useState('');
    const [clsError, setClsError] = useState(false);

    function handleSaveClick() {
      if (type === 'ders') {
        if (!cls) { setClsError(true); return; }
        setEntry(dayIndex, slotId, { type: 'ders', cls });
      } else if (type === 'etut') {
        setEntry(dayIndex, slotId, { type: 'etut', studentId, studentName, studentCls, fixed });
      }
      setActiveCell(null);
    }

    return (
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <div className="text-xs font-600 text-gray-500 mb-2" style={{ fontWeight: 600 }}>
          {ALL_DAYS.find(d => d.index === dayIndex)?.label} – {slotsForDay(dayIndex).find(s => s.id === slotId)?.label}
        </div>
        <div className="flex gap-2 mb-3">
          {[{val: 'ders', label: 'Ders'}, {val: 'etut', label: 'Etüt'}].map(opt => (
            <button key={opt.val} onClick={() => { setType(opt.val); setClsError(false); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-600 border transition-all ${type === opt.val ? (opt.val === 'ders' ? 'bg-blue-600 text-white border-blue-600' : 'bg-emerald-600 text-white border-emerald-600') : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
              style={{ fontWeight: 600 }}>
              {opt.label}
            </button>
          ))}
        </div>

        {type === 'ders' && (
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Sınıf</label>
            {dayIndex < 5 && MEZUN_ONLY_LESSON_SLOTS.includes(slotId) && (
              <p className="text-[10px] text-amber-600 mb-1">Bu saat sadece mezun sınıflarına açıktır.</p>
            )}
            <select value={cls} onChange={e => { setCls(e.target.value); setClsError(false); }}
              className={`w-full text-xs border rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-300 ${clsError ? 'border-red-400' : 'border-gray-200'}`}>
              <option value="">Sınıf seçin</option>
              {(dayIndex < 5 && MEZUN_ONLY_LESSON_SLOTS.includes(slotId)
                ? (STUDENT_GROUPS.mezun?.classes || [])
                : allClasses
              ).map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
            {clsError && <p className="text-xs text-red-500 mt-1">Sınıf seçilmeden ders eklenemez.</p>}
          </div>
        )}

        {type === 'etut' && (
          <div className="space-y-2 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Öğrenci (boş bırakılırsa açık slot)</label>
              <input
                className="input text-xs mb-1"
                placeholder="İsim veya sınıf kodu ara..."
                value={studentSearch}
                onChange={e => setStudentSearch(e.target.value)}
                autoFocus
              />
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg bg-white">
                <button
                  onClick={() => { setStudentId(''); setStudentName(''); setStudentCls(''); setFixed(false); setStudentSearch(''); }}
                  className={`w-full text-left px-3 py-2 text-xs transition-colors ${!studentId ? 'bg-emerald-50 text-emerald-700 font-600' : 'text-gray-400 hover:bg-gray-50'}`}
                  style={{ fontWeight: !studentId ? 600 : 400 }}>
                  — Açık slot —
                </button>
                {allowedStudents
                  .filter(s => {
                    const q = studentSearch.toLowerCase();
                    return !q || s.name.toLowerCase().includes(q) || s.cls.toLowerCase().includes(q) || classLabel(s.cls).toLowerCase().includes(q);
                  })
                  .slice(0, 20)
                  .map(s => (
                    <button key={s.id}
                      onClick={() => { setStudentId(s.id); setStudentName(s.name); setStudentCls(s.cls); setStudentSearch(''); }}
                      className={`w-full text-left px-3 py-2 text-xs transition-colors ${studentId === s.id ? 'bg-emerald-50 text-emerald-700 font-600' : 'hover:bg-gray-50 text-gray-700'}`}
                      style={{ fontWeight: studentId === s.id ? 600 : 400 }}>
                      <span className="font-600" style={{ fontWeight: 600 }}>{s.name}</span>
                      <span className="text-gray-400 ml-1.5">{classLabel(s.cls)}</span>
                    </button>
                  ))}
              </div>
            </div>
            {studentId && (
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)}
                  className="w-4 h-4 rounded accent-indigo-600" />
                <span className="text-xs text-gray-700">Sabit rezervasyon (her hafta tekrar)</span>
              </label>
            )}
          </div>
        )}

        {type && (
          <button onClick={handleSaveClick}
            className="px-4 py-1.5 rounded-lg text-xs font-600 bg-indigo-600 text-white border border-indigo-600 hover:bg-indigo-700 transition-all"
            style={{ fontWeight: 600 }}>
            Kaydet
          </button>
        )}
      </div>
    );
  }

  if (loading) return (
    <Modal title={`${teacher.name} – Program`} onClose={onClose} wide>
      <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
    </Modal>
  );

  return (
    <Modal title={`${teacher.name} – Program`} onClose={onClose} wide>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr>
              <th className="text-left py-2 px-2 text-xs text-gray-400 font-600 w-20" style={{ fontWeight: 600 }}>Saat</th>
              {ALL_DAYS.map(day => (
                <th key={day.index} className={`text-center py-2 px-1 text-xs font-600 ${day.weekend ? 'text-indigo-500' : 'text-gray-500'}`} style={{ fontWeight: 600 }}>
                  {day.short}
                  {day.weekend && <span className="block text-[9px] text-indigo-300">H.sonu</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.max(WEEKDAY_SLOTS.length, WEEKEND_SLOTS.length) }, (_, rowIdx) => (
              <tr key={rowIdx} className="border-t border-gray-50">
                <td className="py-1 px-2 text-[10px] text-gray-400 whitespace-nowrap">
                  {WEEKDAY_SLOTS[rowIdx] && <span className="block">{WEEKDAY_SLOTS[rowIdx].label}</span>}
                  {WEEKEND_SLOTS[rowIdx] && <span className="block text-indigo-300">{WEEKEND_SLOTS[rowIdx].label}</span>}
                </td>
                {ALL_DAYS.map(day => {
                  const slots = slotsForDay(day.index);
                  const slot = slots[rowIdx];
                  if (!slot) return <td key={day.index} className="py-1 px-1"><div className="h-9 rounded bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs flex items-center justify-center">—</div></td>;
                  const entry = getEntry(day.index, slot.id);
                  const isActive = activeCell?.dayIndex === day.index && activeCell?.slotId === slot.id;
                  const type = entry?.type;

                  let cellClass = 'h-9 rounded-lg border text-xs font-500 transition-all cursor-pointer flex items-center justify-center px-1 ';
                  let cellContent = <span className="text-gray-300">+</span>;

                  if (type === 'ders') {
                    cellClass += 'bg-blue-50 border-blue-200 text-blue-700';
                    cellContent = <span className="truncate text-[10px] font-600" style={{ fontWeight: 600 }}>{entry.cls ? entry.cls.toUpperCase() : 'Ders'}</span>;
                  } else if (type === 'etut') {
                    if (entry.studentId) {
                      cellClass += 'bg-emerald-50 border-emerald-200 text-emerald-700';
                      cellContent = (
                        <div className="text-center leading-tight">
                          <div className="text-[9px] truncate font-600" style={{ fontWeight: 600 }}>{entry.studentName}</div>
                          {entry.fixed && <div className="text-[8px] text-violet-500">Sabit</div>}
                        </div>
                      );
                    } else {
                      cellClass += 'bg-emerald-50 border-dashed border-emerald-300 text-emerald-400';
                      cellContent = <span className="text-[10px]">Etüt</span>;
                    }
                  } else {
                    cellClass += 'bg-white border-dashed border-gray-200 hover:border-gray-300';
                  }

                  if (isActive) cellClass += ' ring-2 ring-indigo-400';

                  return (
                    <td key={day.index} className="py-0.5 px-0.5">
                      <div className="relative">
                        <button className={`w-full ${cellClass}`}
                          onClick={() => setActiveCell(isActive ? null : { dayIndex: day.index, slotId: slot.id })}>
                          {cellContent}
                        </button>
                        {type && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              clearEntry(day.index, slot.id);
                              if (isActive) setActiveCell(null);
                            }}
                            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-sm transition-colors z-10"
                            title="Slotu temizle"
                          >
                            <X size={9} strokeWidth={3} />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {activeCell && <CellEditor dayIndex={activeCell.dayIndex} slotId={activeCell.slotId} />}

      <div className="flex gap-3 mt-4">
        <button className="btn-primary flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Kaydediliyor...' : 'Kaydet ve Uygula'}
        </button>
        <button className="btn-ghost" onClick={onClose}>İptal</button>
      </div>
    </Modal>
  );
}

// ─── LOGIN SCREEN ──────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, directorExists, showToast }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode] = useState(directorExists ? 'login' : 'setup');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'setup') {
        await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'setup_director', username, password, name }) });
        showToast('Müdür hesabı oluşturuldu');
        const status = await api('/api/auth');
        onLogin(status.session);
      } else {
        const data = await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'login', username, password }) });
        onLogin(data);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-elevated w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
            <BookOpen size={28} color="white" />
          </div>
          <h1 className="text-2xl font-800 text-gray-900" style={{ fontWeight: 800 }}>Etüt Takip</h1>
          <p className="text-sm text-gray-500 mt-1">{mode === 'setup' ? 'Müdür hesabı oluşturun' : 'Hesabınıza giriş yapın'}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'setup' && (
            <FormField label="Ad Soyad">
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Gökhan Özyurt" required />
            </FormField>
          )}
          <FormField label="Kullanıcı Adı">
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="kullanici_adi" required />
          </FormField>
          <FormField label="Şifre">
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </FormField>
          <button className="btn-primary w-full mt-2" disabled={loading}>
            {loading ? 'Lütfen bekleyin...' : mode === 'setup' ? 'Hesap Oluştur' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── TEACHER PANEL ─────────────────────────────────────────────────────────────
// ─── ÖĞRETMEN YOKLAMA PANELİ ───────────────────────────────────────────────────
function TeacherAttendancePanel({ session, weekKey, showToast }) {
  const [program, setProgram] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openDays, setOpenDays] = useState({});
  const [openClasses, setOpenClasses] = useState({});
  // attendance: { [`${date}_${cls}_${lessonNo}`]: { studentId: 'var'|'gec'|'yok' } }
  const [attendance, setAttendance] = useState({});
  const [saving, setSaving] = useState({});

  // Haftanın Pazartesi tarihini hesapla (UTC-safe, sadece YYYY-MM-DD)
  const mondayYMD = useMemo(() => {
    const [year, wStr] = weekKey.split('-W');
    const week = parseInt(wStr);
    // UTC bazında 4 Ocak'tan ISO hafta hesabı
    const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    return mon;
  }, [weekKey]);

  function dateForDay(dayIndex) {
    const d = new Date(mondayYMD);
    d.setUTCDate(mondayYMD.getUTCDate() + dayIndex);
    return d.toISOString().slice(0, 10);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [progData, stuData] = await Promise.all([
          api(`/api/program?teacherId=${session.id}`),
          api('/api/students'),
        ]);
        setProgram(progData || {});
        setStudents(stuData);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [session.id]);

  // program'daki ders slotlarından gün → { cls: [lessonNo, ...] } haritası
  // lessonNo: o günün slot listesindeki ders slotunun sıra numarası (1'den başlar)
  const days = useMemo(() => {
    if (!program) return [];
    return ALL_DAYS.map(day => {
      const dayProg = program[String(day.index)] || {};
      const slots = slotsForDay(day.index);
      const clsMap = {};
      let lessonNo = 0;
      for (const slot of slots) {
        const entry = dayProg[slot.id];
        if (entry?.type === 'ders' && entry.cls) {
          lessonNo++;
          if (!clsMap[entry.cls]) clsMap[entry.cls] = [];
          clsMap[entry.cls].push(lessonNo);
        }
      }
      if (Object.keys(clsMap).length === 0) return null;
      return { dayIndex: day.index, dayLabel: day.label, clsMap };
    }).filter(Boolean);
  }, [program]);

  // Bir sınıfın öğrencileri (sınıf koduna göre filtrele)
  const studentsForCls = useCallback((cls) => {
    return students.filter(s => s.cls === cls);
  }, [students]);

  async function loadAttendance(date, cls, lessonNo) {
    const key = `${date}_${cls}_${lessonNo}`;
    if (attendance[key] !== undefined) return;
    try {
      const data = await api(`/api/attendance?date=${date}&teacherId=${session.id}&cls=${cls}&lessonNo=${lessonNo}`);
      setAttendance(prev => ({ ...prev, [key]: data }));
    } catch {
      setAttendance(prev => ({ ...prev, [key]: {} }));
    }
  }

  function toggleDay(dayIndex) {
    setOpenDays(p => ({ ...p, [dayIndex]: !p[dayIndex] }));
  }

  function toggleClass(dayIndex, cls) {
    const key = `${dayIndex}_${cls}`;
    if (!openClasses[key]) {
      const date = dateForDay(dayIndex);
      // O sınıfın o güne ait ders numaralarını bul
      const dayData = days.find(d => d.dayIndex === dayIndex);
      const lessonNos = dayData?.clsMap[cls] || [];
      lessonNos.forEach(ln => loadAttendance(date, cls, ln));
    }
    setOpenClasses(p => ({ ...p, [key]: !p[key] }));
  }

  function setStatus(date, cls, lessonNo, studentId, status) {
    const key = `${date}_${cls}_${lessonNo}`;
    setAttendance(prev => ({
      ...prev,
      [key]: { ...(prev[key] || {}), [studentId]: status },
    }));
  }

  async function saveAttendance(dayIndex, cls, lessonNo) {
    const date = dateForDay(dayIndex);
    const key = `${date}_${cls}_${lessonNo}`;
    setSaving(p => ({ ...p, [key]: true }));
    try {
      await api('/api/attendance', {
        method: 'POST',
        body: JSON.stringify({ date, cls, lessonNo, attendance: attendance[key] || {} }),
      });
      showToast('Yoklama kaydedildi', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(p => ({ ...p, [key]: false }));
    }
  }

  const STATUS_OPTS = [
    { value: 'var', label: 'Var', active: 'bg-emerald-500 text-white border-emerald-500' },
    { value: 'gec', label: 'Geç', active: 'bg-amber-500 text-white border-amber-500' },
    { value: 'yok', label: 'Yok', active: 'bg-red-500 text-white border-red-500' },
  ];

  if (loading) return <div className="flex items-center justify-center h-40 text-gray-400">Yükleniyor...</div>;

  if (days.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">
        <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
        <p>Bu hafta için ders programı tanımlanmamış.</p>
        <p className="text-xs mt-1">Müdür panelinden ders programı oluşturulmalı.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {days.map(day => {
        const dOpen = !!openDays[day.dayIndex];
        const clsList = Object.entries(day.clsMap);
        return (
          <div key={day.dayIndex} className="card overflow-hidden">
            <button onClick={() => toggleDay(day.dayIndex)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">{clsList.length} sınıf</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0)' }} />
            </button>

            {dOpen && (
              <div className="border-t border-gray-100 px-3 py-2 space-y-1.5">
                {clsList.map(([cls, lessonNos]) => {
                  const ck = `${day.dayIndex}_${cls}`;
                  const cOpen = !!openClasses[ck];
                  const stuList = studentsForCls(cls);
                  const date = dateForDay(day.dayIndex);

                  return (
                    <div key={cls} className="rounded-xl overflow-hidden border border-gray-100">
                      <button onClick={() => toggleClass(day.dayIndex, cls)}
                        className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-2">
                          <GraduationCap size={14} className="text-indigo-500 shrink-0" />
                          <span className="text-sm font-600 text-gray-800" style={{ fontWeight: 600 }}>{cls.toUpperCase()}</span>
                          <span className="text-xs text-gray-400">{stuList.length} öğrenci · {lessonNos.length} ders</span>
                        </div>
                        <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform" style={{ transform: cOpen ? 'rotate(90deg)' : 'rotate(0)' }} />
                      </button>

                      {cOpen && (
                        <div className="bg-white">
                          {lessonNos.map(ln => {
                            const attKey = `${date}_${cls}_${ln}`;
                            const att = attendance[attKey] || {};
                            return (
                              <div key={ln} className="px-3 py-2 border-b border-gray-50 last:border-0">
                                <div className="text-[11px] font-600 text-indigo-600 mb-2" style={{ fontWeight: 600 }}>{ln}. Ders</div>
                                {stuList.length === 0 ? (
                                  <p className="text-xs text-gray-400 py-1">Bu sınıfta kayıtlı öğrenci yok.</p>
                                ) : (
                                  <>
                                    <div className="space-y-1 mb-2">
                                      {stuList.map(student => {
                                        const current = att[student.id];
                                        return (
                                          <div key={student.id} className="flex items-center justify-between py-1">
                                            <div className="flex items-center gap-2 min-w-0">
                                              <User size={12} className="text-gray-400 shrink-0" />
                                              <span className="text-sm text-gray-800 truncate">{student.name}</span>
                                            </div>
                                            <div className="flex gap-1 shrink-0 ml-2">
                                              {STATUS_OPTS.map(opt => (
                                                <button key={opt.value}
                                                  onClick={() => setStatus(date, cls, ln, student.id, opt.value)}
                                                  className={`text-[11px] px-2.5 py-1 rounded-lg border font-600 transition-all ${current === opt.value ? opt.active : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}
                                                  style={{ fontWeight: 600 }}>
                                                  {opt.label}
                                                </button>
                                              ))}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    <button
                                      onClick={() => saveAttendance(day.dayIndex, cls, ln)}
                                      disabled={saving[`${date}_${cls}_${ln}`]}
                                      className="w-full py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-600 hover:bg-indigo-700 transition-colors disabled:opacity-60"
                                      style={{ fontWeight: 600 }}>
                                      {saving[`${date}_${cls}_${ln}`] ? 'Kaydediliyor...' : `${ln}. Ders Yoklamasını Kaydet`}
                                    </button>
                                  </>
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

function TeacherPanel({ session, showToast }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [slots, setSlots] = useState(null);
  const [program, setProgram] = useState({});
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('rezervasyon'); // 'rezervasyon' | 'yoklama'
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'list'

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [slotsData, stuData, progData] = await Promise.all([
        api(`/api/slots?teacherId=${session.id}&week=${resolvedWeek}`),
        api('/api/students'),
        api(`/api/program?teacherId=${session.id}`),
      ]);
      setSlots(slotsData.grid);
      setStudents(stuData);
      setProgram(progData || {});
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [session.id]);

  useEffect(() => { loadData(); }, []);

  const handleWeekChange = async (newWeek) => {
    setWeekKey(newWeek);
    const data = await api(`/api/slots?teacherId=${session.id}&week=${newWeek}`);
    setSlots(data.grid);
  };

  const handleBook = async (params) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      handleWeekChange(params.weekKey || weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async (params) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      handleWeekChange(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const listColorMap = {
    student: { bg: 'bg-indigo-50', border: 'border-indigo-100', day: 'text-indigo-700', time: 'text-indigo-400', div: 'bg-indigo-200', badge: 'bg-indigo-100 text-indigo-500', label: 'Öğrenci' },
    teacher: { bg: 'bg-emerald-50', border: 'border-emerald-100', day: 'text-emerald-700', time: 'text-emerald-400', div: 'bg-emerald-200', badge: 'bg-emerald-100 text-emerald-600', label: 'Öğretmen' },
    director: { bg: 'bg-amber-50', border: 'border-amber-100', day: 'text-amber-700', time: 'text-amber-400', div: 'bg-amber-200', badge: 'bg-amber-100 text-amber-600', label: 'Müdür' },
  };

  const bookedList = useMemo(() => {
    if (!slots) return [];
    const items = [];
    ALL_DAYS.forEach(day => {
      const daySlots = slotsForDay(day.index);
      daySlots.forEach((slot, slotIdx) => {
        const slotData = slots[day.index]?.[slotIdx];
        if (slotData?.booked) {
          items.push({
            dayIndex: day.index,
            dayLabel: day.label,
            slotId: slot.id,
            slotLabel: slot.label,
            slotIdx,
            studentName: slotData.studentName,
            studentCls: (slotData.studentCls || '').toUpperCase(),
            studentId: slotData.studentId,
            bookedBy: slotData.bookedBy || 'student',
            fixed: !!slotData.fixed,
          });
        }
      });
    });
    return items;
  }, [slots]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      {/* Sekme başlıkları */}
      <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-4 w-fit">
        <button
          onClick={() => setActiveTab('rezervasyon')}
          className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors font-600 ${activeTab === 'rezervasyon' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          style={{ fontWeight: 600 }}>
          <Calendar size={13} /> Program
        </button>
        <button
          onClick={() => setActiveTab('yoklama')}
          className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors font-600 ${activeTab === 'yoklama' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
          style={{ fontWeight: 600 }}>
          <ClipboardList size={13} /> Yoklama
        </button>
      </div>

      {activeTab === 'rezervasyon' && (
        <>
          <div className="flex items-center justify-between mb-4">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'table' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                <LayoutGrid size={13} /> Tablo
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 text-xs flex items-center gap-1 transition-colors ${viewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                <List size={13} /> Liste
              </button>
            </div>
            <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
          </div>
          {viewMode === 'table' ? (
            <>
              <div className="card p-4">
                <SlotGrid grid={slots} program={program} teacher={{ id: session.id, name: session.name, branch: session.branch, allowedGroups: session.allowedGroups }} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} hideEmptyDays />
              </div>
              <p className="text-xs text-gray-400 mt-3 text-center">✕ = kapalı saat &nbsp;·&nbsp; + = rezervasyon yapılabilir</p>
            </>
          ) : (
            <TeacherBookingsList bookedList={bookedList} listColorMap={listColorMap}
              onCancel={item => handleCancel({ teacherId: session.id, day: item.dayIndex, slotId: item.slotId })} />
          )}
        </>
      )}

      {activeTab === 'yoklama' && (
        <>
          <div className="flex justify-end mb-4">
            <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
          </div>
          <TeacherAttendancePanel session={session} weekKey={weekKey} showToast={showToast} />
        </>
      )}
    </div>
  );
}

// ─── AVAILABLE TREE ────────────────────────────────────────────────────────────
function AvailableTree({ available, onBook }) {
  const [openTeachers, setOpenTeachers] = useState({});
  const [openDays, setOpenDays] = useState({});

  // Öğretmen → gün → slotlar hiyerarşisi
  const tree = useMemo(() => {
    const map = {};
    for (const s of available) {
      if (!map[s.teacherId]) {
        map[s.teacherId] = { id: s.teacherId, name: s.teacherName, branch: s.branch, days: {} };
      }
      const dayKey = s.day;
      if (!map[s.teacherId].days[dayKey]) {
        map[s.teacherId].days[dayKey] = { dayIndex: s.day, dayLabel: s.dayLabel, slots: [] };
      }
      map[s.teacherId].days[dayKey].slots.push(s);
    }
    // Öğretmenleri ada göre, günleri sırasına göre, slotları saat sırasına göre sırala
    return Object.values(map)
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      .map(t => ({
        ...t,
        days: Object.values(t.days).sort((a, b) => a.dayIndex - b.dayIndex),
      }));
  }, [available]);

  const toggleTeacher = id => setOpenTeachers(p => ({ ...p, [id]: !p[id] }));
  const toggleDay = key => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  if (tree.length === 0) {
    return <div className="card p-8 text-center text-gray-400"><Calendar size={32} className="mx-auto mb-2 opacity-30" /><p>Uygun etüt bulunamadı</p></div>;
  }

  return (
    <div className="space-y-2">
      {tree.map(teacher => {
        const tOpen = !!openTeachers[teacher.id];
        const totalSlots = teacher.days.reduce((n, d) => n + d.slots.length, 0);
        return (
          <div key={teacher.id} className="card overflow-hidden">
            {/* Öğretmen satırı — en büyük */}
            <button onClick={() => toggleTeacher(teacher.id)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-700 shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', fontWeight: 700 }}>
                  {teacher.branch.slice(0, 2)}
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{teacher.name}</div>
                  <div className="text-xs text-gray-500">{teacher.branch} · {totalSlots} boş saat</div>
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
                      {/* Gün satırı — orta boy */}
                      <button onClick={() => toggleDay(dayKey)}
                        className="w-full flex items-center justify-between px-5 py-2.5 bg-gray-50 hover:bg-gray-100 transition-colors">
                        <div className="flex items-center gap-2">
                          <Calendar size={13} className="text-indigo-400" />
                          <span className="text-sm font-600 text-gray-700" style={{ fontWeight: 600 }}>{day.dayLabel}</span>
                          <span className="text-xs text-gray-400">{day.slots.length} saat</span>
                        </div>
                        <ChevronRight size={13} className="text-gray-400 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                      </button>

                      {dOpen && (
                        <div className="px-5 py-1.5 space-y-1.5">
                          {day.slots.map((s, i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-white border border-gray-100 hover:border-indigo-200 transition-colors">
                              <div className="flex items-center gap-2">
                                <Clock size={12} className="text-indigo-400 shrink-0" />
                                <span className="text-xs font-600 text-gray-700" style={{ fontWeight: 600 }}>{s.slotLabel}</span>
                              </div>
                              <button onClick={() => onBook({ teacherId: s.teacherId, day: s.day, slotId: s.slotId })}
                                className="btn-primary !px-3 !py-1 text-xs">
                                Etüt Al
                              </button>
                            </div>
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
  );
}

// ─── STUDENT PANEL ─────────────────────────────────────────────────────────────
function StudentPanel({ session, showToast }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [tab, setTab] = useState('available');

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const slotsData = await api(`/api/slots?week=${resolvedWeek}`);
      setAllSlots(slotsData.slots || []);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(); }, []);

  const teachers = useMemo(() => {
    const seen = new Set();
    return allSlots.filter(s => { if (seen.has(s.teacherId)) return false; seen.add(s.teacherId); return true; })
      .map(s => ({ id: s.teacherId, name: s.teacherName }));
  }, [allSlots]);

  const myBookings = useMemo(() => allSlots.filter(s => s.booked && s.studentId === session.id), [allSlots, session.id]);

  const studentAllowedBranches = useMemo(() => allowedBranchesForClass(session.cls), [session.cls]);

  const available = useMemo(() => {
    return allSlots.filter(s => {
      if (s.booked || s.disabled) return false;
      if (!s.allowedGroups || s.allowedGroups.length === 0) return false;
      if (!s.allowedGroups.includes(session.group)) return false;
      // Sınıfa göre izin verilen branşlar
      if (!studentAllowedBranches.includes(s.branch)) return false;
      if (myBookings.some(b => b.branch === s.branch)) return false;
      if (myBookings.some(b => b.day === s.day && b.slotId === s.slotId)) return false;
      if (filterBranch && s.branch !== filterBranch) return false;
      if (filterTeacher && s.teacherId !== filterTeacher) return false;
      if (filterDay !== '' && s.day !== parseInt(filterDay)) return false;
      return true;
    });
  }, [allSlots, myBookings, session, studentAllowedBranches, filterBranch, filterTeacher, filterDay]);

  const handleBook = async ({ teacherId, day, slotId }) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify({ teacherId, day, slotId, weekKey }) });
      showToast('Etüde kaydoldunuz!');
      loadData(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async ({ teacherId, day, slotId }) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ teacherId, day, slotId, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      loadData(weekKey);
    } catch (err) { showToast(err.message, 'error'); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{classLabel(session.cls)} · {GROUPS[session.group]}</p>
        <WeekNav weekKey={weekKey} onPrev={() => { const w = getAdjacentWeek(weekKey,-1); setWeekKey(w); loadData(w); }} onNext={() => { const w = getAdjacentWeek(weekKey,1); setWeekKey(w); loadData(w); }} />
      </div>

      <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-xl w-fit">
        {[['available','Müsait Etütler'],['myBookings','Etütlerim']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab===key?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight: 600 }}>
            {label}
            {key==='myBookings' && myBookings.length>0 && <span className="ml-1.5 badge" style={{ background:'#6366f1',color:'white' }}>{myBookings.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'myBookings' ? (
        <StudentBookingsView student={{ id: session.id }} allSlots={allSlots} onCancel={handleCancel} />
      ) : (
        <AvailableTree available={available} onBook={handleBook} />
      )}
    </div>
  );
}

function TeacherBookingsList({ bookedList, listColorMap, onCancel, canCancelAll }) {
  const [openDays, setOpenDays] = useState({});
  const toggleDay = key => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  const days = useMemo(() => {
    const map = {};
    for (const item of bookedList) {
      if (!map[item.dayIndex]) map[item.dayIndex] = { dayIndex: item.dayIndex, dayLabel: item.dayLabel, items: [] };
      map[item.dayIndex].items.push(item);
    }
    return Object.values(map).sort((a, b) => a.dayIndex - b.dayIndex);
  }, [bookedList]);

  if (days.length === 0) {
    return (
      <div className="card p-10 text-center text-gray-400">
        <Calendar size={32} className="mx-auto mb-2 opacity-30" />
        <p>Bu hafta hiç rezervasyon yok</p>
      </div>
    );
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
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">{day.items.length} öğrenci</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            </button>
            {dOpen && (
              <div className="border-t border-gray-100 px-4 py-2 space-y-1.5">
                {day.items.map((item, i) => {
                  const c = listColorMap[item.bookedBy] || listColorMap.student;
                  const canCancel = canCancelAll || item.bookedBy === 'teacher';
                  return (
                    <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                      <div className="flex items-center gap-3 min-w-0">
                        <Clock size={13} className="text-indigo-400 shrink-0" />
                        <div className="min-w-0">
                          <div className="text-xs font-600 text-gray-800" style={{ fontWeight: 600 }}>{item.slotLabel}</div>
                          <div className="text-[11px] text-gray-500 truncate">{item.studentName} · {item.studentCls}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0 ml-2">
                        {item.fixed && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-600 bg-violet-100 text-violet-600" style={{ fontWeight: 600 }}>Sabit</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${c.badge}`} style={{ fontWeight: 500 }}>{c.label}</span>
                        {canCancel && (
                          <button onClick={() => onCancel(item)} className="p-1 rounded hover:bg-red-100 transition-colors" title="İptal et">
                            <X size={13} className="text-red-400" />
                          </button>
                        )}
                      </div>
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

// ─── DIRECTOR PANEL ────────────────────────────────────────────────────────────
// ─── MÜDÜR YOKLAMA PANELİ ──────────────────────────────────────────────────────
function AttendanceStudentRow({ student, variant }) {
  const colors = variant === 'absent'
    ? { bg: 'bg-red-50', border: 'border-red-100', text: 'text-red-700', btn: 'bg-red-100 hover:bg-red-200 text-red-700' }
    : { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-700', btn: 'bg-amber-100 hover:bg-amber-200 text-amber-700' };
  const telNumber = (student.parentPhone || student.phone || '').replace(/\s+/g, '');
  return (
    <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg ${colors.bg} border ${colors.border}`}>
      <span className={`text-sm font-500 ${colors.text}`} style={{ fontWeight: 500 }}>{student.name}</span>
      {telNumber ? (
        <a href={`tel:${telNumber}`} title={`Veliyi ara: ${telNumber}`}
          className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full ${colors.btn} transition-colors`}>
          <Phone size={14} />
        </a>
      ) : (
        <span className="shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-full bg-gray-100 text-gray-300" title="Telefon kayıtlı değil">
          <Phone size={14} />
        </span>
      )}
    </div>
  );
}

function AttendanceSummaryModal({ cls, date, onClose }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api(`/api/attendance/summary?date=${date}`);
        setSummary(data[cls] || null);
      } catch {
        setSummary(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [cls, date]);

  const dayName = (() => {
    const d = new Date(date);
    const names = ['Pazar','Pazartesi','Salı','Çarşamba','Perşembe','Cuma','Cumartesi'];
    return names[d.getDay()];
  })();

  return (
    <Modal title={`${cls.toUpperCase()} – ${dayName} Yoklama Özeti`} onClose={onClose}>
      {loading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">Yükleniyor...</div>
      ) : !summary || summary.lessons.length === 0 ? (
        <div className="py-8 text-center text-gray-400">
          <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
          <p className="text-sm">Bu gün için yoklama kaydı yok.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {summary.lessons.map(lesson => {
            const hasAbsent = lesson.absent.length > 0;
            const hasLate = lesson.late.length > 0;
            if (!lesson.attendanceTaken) return (
              <div key={lesson.lessonNo} className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                <div className="text-xs font-600 text-amber-700 mb-1" style={{ fontWeight: 600 }}>{lesson.lessonNo}. Ders <span className="text-amber-500 font-400">· {lesson.teacherName}</span></div>
                <p className="text-xs text-amber-600">Yoklama henüz alınmamış.</p>
              </div>
            );
            if (!hasAbsent && !hasLate) return (
              <div key={lesson.lessonNo} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="text-xs font-600 text-gray-600 mb-1" style={{ fontWeight: 600 }}>{lesson.lessonNo}. Ders <span className="text-gray-400 font-400">· {lesson.teacherName}</span></div>
                <p className="text-xs text-emerald-600">Tüm öğrenciler mevcut.</p>
              </div>
            );
            return (
              <div key={lesson.lessonNo} className="rounded-xl bg-gray-50 px-4 py-3">
                <div className="text-xs font-600 text-gray-600 mb-2" style={{ fontWeight: 600 }}>{lesson.lessonNo}. Ders <span className="text-gray-400 font-400">· {lesson.teacherName}</span></div>
                {hasAbsent && (
                  <div className="mb-2">
                    <span className="text-[10px] font-600 text-red-500 uppercase tracking-wide" style={{ fontWeight: 600 }}>Yok ({lesson.absent.length})</span>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {lesson.absent.map(s => (
                        <AttendanceStudentRow key={s.id} student={s} variant="absent" />
                      ))}
                    </div>
                  </div>
                )}
                {hasLate && (
                  <div>
                    <span className="text-[10px] font-600 text-amber-500 uppercase tracking-wide" style={{ fontWeight: 600 }}>Geç ({lesson.late.length})</span>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {lesson.late.map(s => (
                        <AttendanceStudentRow key={s.id} student={s} variant="late" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

function DirectorAttendanceView({ showToast }) {
  const today = new Date();
  const jsDay = today.getDay();
  const todayIndex = jsDay === 0 ? 6 : jsDay - 1;

  const [selectedDay, setSelectedDay] = useState(todayIndex);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedCls, setSelectedCls] = useState(null);

  // Seçili güne ait tarih (bu ISO haftanın o günü, UTC-safe)
  const dateForSelectedDay = useMemo(() => {
    const wk = getWeekKey();
    const [year, wStr] = wk.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(Date.UTC(parseInt(year), 0, 4));
    const dow = jan4.getUTCDay() || 7;
    const mon = new Date(jan4);
    mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7);
    mon.setUTCDate(mon.getUTCDate() + selectedDay);
    return mon.toISOString().slice(0, 10);
  }, [selectedDay]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setSummary(null);
      try {
        const data = await api(`/api/attendance/summary?date=${dateForSelectedDay}`);
        setSummary(data);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [dateForSelectedDay]);

  const clsList = summary ? Object.keys(summary).sort() : [];

  return (
    <div>
      {/* Gün filtresi */}
      <div className="flex gap-1.5 mb-5 flex-wrap">
        {ALL_DAYS.map(day => (
          <button key={day.index} onClick={() => setSelectedDay(day.index)}
            className={`px-3 py-1.5 rounded-lg text-xs font-600 transition-all border ${selectedDay === day.index ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-indigo-300'}`}
            style={{ fontWeight: 600 }}>
            {day.label}
            {day.index === todayIndex && <span className="ml-1 text-[10px] opacity-70">Bugün</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-400">Yükleniyor...</div>
      ) : clsList.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">
          <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
          <p>Bu gün için tanımlı ders bulunmuyor.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {clsList.map(cls => {
            const data = summary[cls];
            const totalAbsent = data.lessons.reduce((n, l) => n + l.absent.length, 0);
            const totalLate = data.lessons.reduce((n, l) => n + l.late.length, 0);
            const takenCount = data.lessons.filter(l => l.attendanceTaken).length;
            const totalCount = data.lessons.length;
            const allTaken = takenCount === totalCount;
            return (
              <button key={cls} onClick={() => setSelectedCls(cls)}
                className="card aspect-square flex flex-col items-center justify-center gap-1.5 hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer p-3">
                <GraduationCap size={20} className="text-indigo-400" />
                <span className="text-sm font-700 text-gray-900" style={{ fontWeight: 700 }}>{cls.toUpperCase()}</span>
                <div className="flex flex-wrap gap-1 justify-center">
                  {totalAbsent > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-600" style={{ fontWeight: 600 }}>{totalAbsent} yok</span>
                  )}
                  {totalLate > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-600" style={{ fontWeight: 600 }}>{totalLate} geç</span>
                  )}
                  {totalAbsent === 0 && totalLate === 0 && allTaken && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-600 font-600" style={{ fontWeight: 600 }}>Tam</span>
                  )}
                  {!allTaken && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-600" style={{ fontWeight: 600 }}>{takenCount}/{totalCount}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selectedCls && (
        <AttendanceSummaryModal cls={selectedCls} date={dateForSelectedDay} onClose={() => setSelectedCls(null)} />
      )}
    </div>
  );
}

function DirectorPanel({ session, showToast }) {
  const [tab, setTab] = useState('teachers');
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
  const [resetTarget, setResetTarget] = useState(null);
  const [expandedTeacherId, setExpandedTeacherId] = useState(null);
  const [historyTarget, setHistoryTarget] = useState(null); // { type: 'teacher'|'student', id, name }

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
        {[['teachers','Öğretmenler'],['students','Sınıf/Öğrenci'],['yoklama','Yoklama']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab===key?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight:600 }}>{label}</button>
        ))}
      </div>

      {/* TEACHERS TAB */}
      {tab === 'teachers' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğretmenler ({teachers.length})</h3>
            <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditTeacher(null); setShowTeacherForm(true); }}>
              <Plus size={14} /> Ekle
            </button>
          </div>
          <div className="grid gap-2">
            {teachers.map(t => {
              const isOpen = expandedTeacherId === t.id;
              const teacherBookings = allSlots.filter(s => s.booked && s.teacherId === t.id);
              return (
                <div key={t.id} className="card overflow-hidden">
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
                        <div className="text-xs text-gray-500">{t.branch}</div>
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
                      <div className="flex items-center justify-between mb-3">
                        <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
                        <div className="flex gap-2">
                          <button className="btn-ghost !px-3 !py-1.5 flex items-center gap-1.5 text-sm text-gray-600" onClick={() => setHistoryTarget({ type: 'teacher', id: t.id, name: t.name })}>
                            <Clock size={13} /> Geçmiş
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
                              slotsForDay(day.index).forEach((slot, slotIdx) => {
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
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğrenciler ({students.length})</h3>
            <div className="flex gap-2">
              <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => setShowImport(true)}>
                <BookOpen size={14} /> Excel Yükle
              </button>
              <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditStudent(null); setShowStudentForm(true); }}>
                <Plus size={14} /> Ekle
              </button>
              {students.length > 0 && (
                <button className="btn-ghost !px-4 !py-2 flex items-center gap-1.5 text-sm text-red-500 hover:bg-red-50" onClick={async () => {
                  if (!confirm(`Tüm ${students.length} öğrenci silinsin mi? Bu işlem geri alınamaz.`)) return;
                  try {
                    await api('/api/students', { method: 'DELETE', body: JSON.stringify({ ids: students.map(s => s.id) }) });
                    showToast(`${students.length} öğrenci silindi`);
                    loadAll(weekKey);
                  } catch(err) { showToast(err.message, 'error'); }
                }}>
                  <Trash2 size={14} /> Tümünü Sil
                </button>
              )}
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
            onReset={s => setResetTarget({ id: s.id, name: s.name, role: 'student' })}
            onHistory={s => setHistoryTarget({ type: 'student', id: s.id, name: s.name })} />
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
      {resetTarget && (
        <ResetPasswordModal target={resetTarget} targetRole={resetTarget.role} onClose={() => setResetTarget(null)} showToast={showToast} />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} showToast={showToast} onDone={() => { setShowImport(false); loadAll(weekKey); }} />
      )}
    </div>
  );
}

function StudentBookingsView({ student, allSlots, onCancel }) {
  const [openDays, setOpenDays] = useState({});

  const bookedByLabel = { student: 'Öğrenci', teacher: 'Öğretmen', director: 'Müdür' };
  const bookedByColor = {
    student: 'bg-indigo-100 text-indigo-600',
    teacher: 'bg-emerald-100 text-emerald-600',
    director: 'bg-amber-100 text-amber-600',
  };

  // Gün → saat sıralı hiyerarşi
  const days = useMemo(() => {
    const bookedSlots = allSlots.filter(s => s.booked && s.studentId === student.id);
    const map = {};
    for (const s of bookedSlots) {
      if (!map[s.day]) map[s.day] = { dayIndex: s.day, dayLabel: s.dayLabel, slots: [] };
      map[s.day].slots.push(s);
    }
    return Object.values(map)
      .sort((a, b) => a.dayIndex - b.dayIndex)
      .map(d => ({ ...d, slots: d.slots.sort((a, b) => a.slotId.localeCompare(b.slotId)) }));
  }, [allSlots, student.id]);

  const toggleDay = key => setOpenDays(p => ({ ...p, [key]: !p[key] }));

  if (days.length === 0) {
    return <div className="text-center py-8 text-gray-400"><BookOpen size={28} className="mx-auto mb-2 opacity-30" /><p>Bu hafta hiç etüt yok</p></div>;
  }

  return (
    <div className="space-y-2">
      {days.map(day => {
        const dOpen = !!openDays[day.dayIndex];
        return (
          <div key={day.dayIndex} className="card overflow-hidden">
            {/* Gün satırı — büyük */}
            <button onClick={() => toggleDay(day.dayIndex)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-700 shrink-0"
                  style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)', fontWeight: 700 }}>
                  <Calendar size={16} />
                </div>
                <div className="text-left">
                  <div className="font-700 text-gray-900 text-sm" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                  <div className="text-xs text-gray-500">{day.slots.length} etüt</div>
                </div>
              </div>
              <ChevronRight size={16} className="text-gray-400 shrink-0 transition-transform" style={{ transform: dOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
            </button>

            {dOpen && (
              <div className="border-t border-gray-100 px-4 py-2 space-y-1.5">
                {day.slots.map((s, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                    <div className="flex items-center gap-3 min-w-0">
                      <Clock size={13} className="text-indigo-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-600 text-gray-800" style={{ fontWeight: 600 }}>{s.slotLabel}</div>
                        <div className="text-[11px] text-gray-500 truncate">{s.teacherName} · {s.branch}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-2">
                      {s.fixed && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-600 bg-violet-100 text-violet-600" style={{ fontWeight: 600 }}>Sabit</span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-500 ${bookedByColor[s.bookedBy] || bookedByColor.student}`} style={{ fontWeight: 500 }}>
                        {bookedByLabel[s.bookedBy] || 'Öğrenci'}
                      </span>
                      {onCancel && (
                        <button onClick={() => onCancel({ teacherId: s.teacherId, day: s.day, slotId: s.slotId })}
                          className="p-1 rounded hover:bg-red-100 transition-colors" title="İptal et">
                          <X size={13} className="text-red-400" />
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

function StudentList({ students, allSlots, weekKey, onCancelBooking, onEdit, onDelete, onDeleteClass, onReset, onHistory }) {
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [collapsed, setCollapsed] = useState({});
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

  const toggle = cls => setCollapsed(prev => ({ ...prev, [cls]: !prev[cls] }));

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input text-sm" placeholder="İsim, sınıf..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <select className="input !w-auto text-sm" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">Tüm Gruplar</option>
          {Object.entries(GROUPS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        {grouped.length === 0 && <div className="card p-8 text-center text-gray-400"><GraduationCap size={32} className="mx-auto mb-2 opacity-30" /><p>Öğrenci bulunamadı</p></div>}
        {grouped.map(grp => {
          const isOpen = !collapsed[grp.cls];
          const dotColor = grp.group==='lise'
            ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
            : grp.group==='ortaokul'
            ? 'linear-gradient(135deg,#22c55e,#16a34a)'
            : 'linear-gradient(135deg,#f59e0b,#d97706)';
          const colors = { header:'bg-slate-200 text-slate-700 hover:bg-slate-300', dot: dotColor };
          return (
            <div key={grp.cls}>
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-700 transition-colors ${colors.header}`} style={{ fontWeight:700 }}>
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
                    <div key={s.id} className="card overflow-hidden text-sm">
                      <div className="flex items-center justify-between px-3 py-3">
                        <button className="flex items-center gap-3 flex-1 min-w-0 text-left" onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}>
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-700 shrink-0"
                            style={{ background: colors.dot, fontWeight:700 }}>
                            {s.name.slice(0,2).toUpperCase()}
                          </div>
                          <span className="font-600 truncate" style={{ fontWeight:600 }}>{s.name}</span>
                          <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform ml-auto"
                            style={{ transform: expandedId === s.id ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                        </button>
                        <div className="flex gap-2 shrink-0 ml-2">
                          {onHistory && <button className="btn-ghost !px-2 !py-1.5 text-gray-400" onClick={() => onHistory(s)} title="Geçmiş"><Clock size={12} /></button>}
                          <button className="btn-ghost !px-2 !py-1.5" onClick={() => onEdit(s)}><Edit3 size={12} /></button>
                          <button className="btn-ghost !px-2 !py-1.5 text-red-400 hover:bg-red-50" onClick={() => onDelete(s)}><Trash2 size={12} /></button>
                        </div>
                      </div>
                      {expandedId === s.id && allSlots && (
                        <div className="border-t border-gray-100 px-3 pb-3 pt-2 bg-gray-50">
                          <StudentBookingsView student={s} allSlots={allSlots} onCancel={onCancelBooking} />
                        </div>
                      )}
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

  // Görünen günler: en az bir derse sahip günler
  const visibleDays = useMemo(() => {
    if (!schedule) return [];
    return ALL_DAYS.filter(day => (schedule[day.index] || []).length > 0);
  }, [schedule]);

  // Ders satırlarını oluştur: her gün için ayrı ayrı slotId'ye göre sıralı
  // Maksimum ders sayısını bulup satır oluştur
  const rows = useMemo(() => {
    if (!schedule) return [];
    const dayLessons = {};
    let maxLessons = 0;
    for (const day of visibleDays) {
      const list = [...(schedule[day.index] || [])];
      // slot sırasına göre dizilir (w1 < w2... ya da e1 < e2...)
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
        <div className="flex items-center justify-center h-32 text-gray-400">Yükleniyor...</div>
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
                          <div className="text-[9px] text-blue-400 truncate">{lesson.branch}</div>
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

function TeacherForm({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name||'');
  const [password, setPassword] = useState('');
  const [branch, setBranch] = useState(initial?.branch||BRANCHES[0]);
  const [allowedGroups, setAllowedGroups] = useState(initial?.allowedGroups||[]);
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl||'');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const toggleGroup = g => setAllowedGroups(prev => prev.includes(g)?prev.filter(x=>x!==g):[...prev,g]);

  const handlePhoto = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.url) setPhotoUrl(data.url);
      else throw new Error(data.error);
    } catch (err) { alert(err.message); }
    finally { setUploading(false); }
  };

  const submit = async e => { e.preventDefault(); setLoading(true); await onSave({name, username: name, password, branch, allowedGroups, photoUrl}); setLoading(false); };
  return (
    <Modal title={initial?'Öğretmen Düzenle':'Yeni Öğretmen'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
            {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : <User size={28} className="text-gray-400" />}
          </div>
          <div>
            <label className="btn-ghost !px-3 !py-2 text-sm cursor-pointer inline-block">
              {uploading ? 'Yükleniyor...' : 'Fotoğraf Seç'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhoto} disabled={uploading} />
            </label>
            {photoUrl && <button type="button" className="block text-xs text-red-400 mt-1 hover:underline" onClick={() => setPhotoUrl('')}>Fotoğrafı kaldır</button>}
          </div>
        </div>
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label={initial?'Şifre (boş bırakırsan değişmez)':'Şifre'}>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required={!initial} />
        </FormField>
        <FormField label="Branş">
          <select className="input" value={branch} onChange={e=>setBranch(e.target.value)}>
            {BRANCHES.map(b=><option key={b} value={b}>{b}</option>)}
          </select>
        </FormField>
        <div>
          <Label>Hangi gruplara etüt verebilir?</Label>
          <p className="text-xs text-gray-400 mb-2">Hiç seçilmezse tüm gruplara açık</p>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(GROUPS).map(([key,label]) => (
              <button key={key} type="button" onClick={() => toggleGroup(key)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all font-500 ${allowedGroups.includes(key)?'border-indigo-300 bg-indigo-50 text-indigo-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                style={{ fontWeight:500 }}>
                {allowedGroups.includes(key)&&<Check size={12} className="inline mr-1" />}{label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading}>{loading?'Kaydediliyor...':'Kaydet'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

function StudentForm({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name||'');
  const [password, setPassword] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(initial?.group||'ortaokul');
  const [cls, setCls] = useState(initial?.cls||STUDENT_GROUPS.ortaokul.classes[0]);
  const [phone, setPhone] = useState(initial?.phone||'');
  const [parentPhone, setParentPhone] = useState(initial?.parentPhone||'');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!initial) setCls(STUDENT_GROUPS[selectedGroup].classes[0]); }, [selectedGroup]);
  const submit = async e => { e.preventDefault(); setLoading(true); await onSave({name, username: name, password, cls, phone, parentPhone}); setLoading(false); };
  return (
    <Modal title={initial?'Öğrenci Düzenle':'Yeni Öğrenci'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label={initial?'Şifre (boş bırakırsan değişmez)':'Şifre'}>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required={!initial} />
        </FormField>
        <FormField label="Grup">
          <select className="input" value={selectedGroup} onChange={e=>setSelectedGroup(e.target.value)} disabled={!!initial}>
            {Object.entries(GROUPS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <FormField label="Sınıf">
          <select className="input" value={cls} onChange={e=>setCls(e.target.value)}>
            {STUDENT_GROUPS[selectedGroup].classes.map(c=><option key={c} value={c}>{classLabel(c)}</option>)}
          </select>
        </FormField>
        <FormField label="Öğrenci Telefonu">
          <input className="input" type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e=>setPhone(e.target.value)} />
        </FormField>
        <FormField label="Veli Telefonu">
          <input className="input" type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={parentPhone} onChange={e=>setParentPhone(e.target.value)} />
        </FormField>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading}>{loading?'Kaydediliyor...':'Kaydet'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── ŞİFRE DEĞİŞTİR (kendi şifresini değiştirme) ─────────────────────────────
function ChangePasswordModal({ onClose, showToast }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (next !== next2) { showToast('Yeni şifreler eşleşmiyor', 'error'); return; }
    if (next.length < 4) { showToast('Şifre en az 4 karakter olmalı', 'error'); return; }
    setLoading(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'change_password', password: current, newPassword: next }) });
      showToast('Şifre başarıyla değiştirildi');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Şifremi Değiştir" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Mevcut Şifre">
          <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Yeni Şifre">
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} required />
        </FormField>
        <FormField label="Yeni Şifre (Tekrar)">
          <input className="input" type="password" value={next2} onChange={e => setNext2(e.target.value)} required />
        </FormField>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading}>{loading ? 'Kaydediliyor...' : 'Değiştir'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── EXCEL TOPLU IMPORT ────────────────────────────────────────────────────────
function ImportModal({ onClose, showToast, onDone }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/students/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      showToast(`${data.added.length} öğrenci eklendi`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Excel'den Öğrenci Yükle" onClose={onClose}>
      <p className="text-sm text-gray-500 mb-4">
        Excel dosyası: <strong>A sütunu</strong> isim soyisim, <strong>B sütunu</strong> sınıf kodu (701, 802, 101 vb.)
      </p>
      {!result ? (
        <label className={`btn-primary flex items-center justify-center gap-2 cursor-pointer ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <BookOpen size={14} /> {loading ? 'Yükleniyor...' : 'Excel Dosyası Seç'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} disabled={loading} />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="card p-3"><div className="text-xl font-700 text-green-600" style={{fontWeight:700}}>{result.added.length}</div><div className="text-xs text-gray-500">Eklendi</div></div>
            <div className="card p-3"><div className="text-xl font-700 text-amber-500" style={{fontWeight:700}}>{result.skipped.length}</div><div className="text-xs text-gray-500">Zaten Var</div></div>
            <div className="card p-3"><div className="text-xl font-700 text-red-400" style={{fontWeight:700}}>{result.errors.length}</div><div className="text-xs text-gray-500">Hata</div></div>
          </div>
          {result.added.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              <p className="text-xs font-600 text-gray-500 mb-1" style={{fontWeight:600}}>Eklenen öğrenciler ve şifreleri:</p>
              {result.added.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-green-50">
                  <span className="font-500" style={{fontWeight:500}}>{s.name} <span className="text-gray-400">({s.cls})</span></span>
                  <span className="text-gray-500 font-mono">{s.password}</span>
                </div>
              ))}
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-600 text-red-500 mb-1" style={{fontWeight:600}}>Hatalar:</p>
              {result.errors.map((e, i) => <p key={i} className="text-xs text-red-400">{e}</p>)}
            </div>
          )}
          <button className="btn-primary w-full" onClick={onDone}>Kapat</button>
        </div>
      )}
    </Modal>
  );
}

// ─── ŞİFRE SIFIRLA (müdür başkasının şifresini sıfırlar) ──────────────────────
function ResetPasswordModal({ target, targetRole, onClose, showToast }) {
  const [newPass, setNewPass] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (newPass.length < 4) { showToast('Şifre en az 4 karakter olmalı', 'error'); return; }
    setLoading(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'reset_password', targetId: target.id, targetRole, newPassword: newPass }) });
      showToast(`${target.name} şifresi sıfırlandı`);
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title={`Şifre Sıfırla: ${target.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-sm text-gray-500">Yeni şifreyi belirleyin ve kullanıcıya bildirin.</p>
        <FormField label="Yeni Şifre">
          <input className="input" type="text" value={newPass} onChange={e => setNewPass(e.target.value)} required autoFocus placeholder="En az 4 karakter" />
        </FormField>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading}>{loading ? 'Kaydediliyor...' : 'Sıfırla'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({ target, onClose, currentWeekKey, currentEntries }) {
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const printRef = React.useRef();

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await api(`/api/archive?type=${target.type}&id=${target.id}`);
        setWeeks(data.weeks || []);
      } catch {}
      setLoading(false);
    })();
  }, [target.id, target.type]);

  const allWeeks = useMemo(() => {
    const result = [];
    if (currentEntries && currentEntries.length > 0) {
      result.push({ weekKey: currentWeekKey, entries: currentEntries, isCurrent: true });
    }
    result.push(...weeks);
    return result;
  }, [weeks, currentEntries, currentWeekKey]);

  const handlePrint = () => {
    const s = {
      body: 'font-family:Arial,sans-serif;font-size:13px;color:#111;padding:24px;',
      h1: 'font-size:18px;margin:0 0 4px;',
      sub: 'color:#666;font-size:12px;margin-bottom:20px;',
      week: 'margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;',
      weekTitle: 'font-size:13px;font-weight:bold;background-color:#f3f4f6;padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;',
      dayTitle: 'font-size:11px;font-weight:bold;color:#4f46e5;margin:10px 0 4px 4px;',
      entry: 'display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background-color:#f9fafb;border:1px solid #f3f4f6;border-radius:6px;margin-bottom:4px;',
      entryLeft: 'font-size:12px;font-weight:600;color:#1f2937;',
      entryRight: 'font-size:11px;color:#6b7280;',
    };
    let html = `<html><head><title>${target.name} – Etüt Geçmişi</title>
    <style>* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }</style>
    </head><body style="${s.body}">`;
    html += `<h1 style="${s.h1}">${target.name}</h1><div style="${s.sub}">Etüt Geçmişi</div>`;
    allWeeks.forEach(week => {
      const badge = week.isCurrent ? ' <span style="font-size:10px;background-color:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:99px;font-weight:normal;margin-left:6px;">Bu Hafta</span>' : '';
      html += `<div style="${s.week}"><div style="${s.weekTitle}">${weekLabel(week.weekKey)}${badge}</div><div style="padding:8px 10px;">`;
      const byDay = {};
      week.entries.forEach(e => {
        if (!byDay[e.day]) byDay[e.day] = { dayLabel: e.dayLabel, entries: [] };
        byDay[e.day].entries.push(e);
      });
      Object.values(byDay).sort((a,b) => a.entries[0].day - b.entries[0].day).forEach(day => {
        html += `<div style="${s.dayTitle}">${day.dayLabel}</div>`;
        day.entries.sort((a,b) => a.slotId.localeCompare(b.slotId)).forEach(e => {
          const right = target.type === 'teacher'
            ? `${e.studentName} · ${(e.studentCls||'').toUpperCase()}`
            : `${e.teacherName} · ${e.branch}`;
          html += `<div style="${s.entry}"><span style="${s.entryLeft}">${e.slotLabel}</span><span style="${s.entryRight}">${right}</span></div>`;
        });
      });
      html += `</div></div>`;
    });
    html += '</body></html>';
    const w = window.open('', '_blank');
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  const weekLabel = wk => {
    // 2026-W20 → "12 Mayıs – 18 Mayıs 2026"
    try {
      const [year, week] = wk.split('-W');
      const jan4 = new Date(parseInt(year), 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const monday = new Date(jan4);
      monday.setDate(jan4.getDate() - dayOfWeek + 1 + (parseInt(week) - 1) * 7);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const fmt = d => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      return `${fmt(monday)} – ${fmt(sunday)} ${year}`;
    } catch { return wk; }
  };

  return (
    <Modal title={`${target.name} – Geçmiş Etütler`} onClose={onClose} wide>
      {loading ? (
        <div className="py-12 text-center text-gray-400">Yükleniyor...</div>
      ) : allWeeks.length === 0 ? (
        <div className="py-12 text-center text-gray-400">
          <Clock size={32} className="mx-auto mb-2 opacity-30" />
          <p>Henüz etüt yok</p>
          <p className="text-xs mt-1 text-gray-300">Geçmiş haftalar her Pazar arşivlenir</p>
        </div>
      ) : (
        <>
          <div className="flex justify-end mb-4">
            <button onClick={handlePrint} className="btn-ghost !px-4 !py-2 flex items-center gap-2 text-sm text-indigo-600">
              <BookOpen size={14} /> PDF / Yazdır
            </button>
          </div>
          <div className="space-y-4" ref={printRef}>
            {allWeeks.map(week => {
              const byDay = {};
              week.entries.forEach(e => {
                if (!byDay[e.day]) byDay[e.day] = { dayLabel: e.dayLabel, entries: [] };
                byDay[e.day].entries.push(e);
              });
              const sortedDays = Object.values(byDay).sort((a,b) => a.entries[0].day - b.entries[0].day);
              return (
                <div key={week.weekKey} className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                    <span className="font-700 text-sm text-gray-800" style={{ fontWeight: 700 }}>{weekLabel(week.weekKey)}</span>
                    {week.isCurrent && <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600 font-600" style={{ fontWeight: 600 }}>Bu Hafta</span>}
                  </div>
                  <div className="p-3 space-y-3">
                    {sortedDays.map(day => (
                      <div key={day.dayLabel}>
                        <div className="text-xs font-700 text-indigo-600 mb-1.5 px-1" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                        <div className="space-y-1">
                          {day.entries.sort((a,b) => a.slotId.localeCompare(b.slotId)).map((e,i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-sm">
                              <div className="flex items-center gap-2">
                                <Clock size={12} className="text-indigo-400 shrink-0" />
                                <span className="font-600 text-gray-800 text-xs" style={{ fontWeight: 600 }}>{e.slotLabel}</span>
                              </div>
                              <span className="text-xs text-gray-500">
                                {target.type === 'teacher'
                                  ? `${e.studentName} · ${(e.studentCls||'').toUpperCase()}`
                                  : `${e.teacherName} · ${e.branch}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

function DirectorNameModal({ current, onClose, onSave, showToast }) {
  const [name, setName] = useState(current || '');
  const [loading, setLoading] = useState(false);
  const submit = async e => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'update_director_name', name: name.trim() }) });
      onSave(name.trim());
      showToast('İsim güncellendi');
      onClose();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setLoading(false); }
  };
  return (
    <Modal title="İsmi Güncelle" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Ad Soyad">
          <input className="input" value={name} onChange={e => setName(e.target.value)} required autoFocus />
        </FormField>
        <div className="flex gap-3">
          <button className="btn-primary flex-1" disabled={loading}>{loading ? 'Kaydediliyor...' : 'Kaydet'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

// ─── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [directorExists, setDirectorExists] = useState(false);
  const [toast, setToast] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDirectorName, setShowDirectorName] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const status = await api('/api/auth');
        setDirectorExists(status.directorExists);
        if (status.session) setSession(status.session);
      } catch {}
      setLoading(false);
    })();
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const logout = async () => {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
    setSession(null);
    showToast('Çıkış yapıldı');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-400 text-sm">Yükleniyor...</div></div>;

  if (!session) return (
    <><LoginScreen directorExists={directorExists} onLogin={setSession} showToast={showToast} /><Toast toast={toast} /></>
  );

  const roleLabel = { director:'Müdür', teacher:'Öğretmen', student:'Öğrenci' };
  const roleColor = { director:'#6366f1', teacher:'#22c55e', student:'#f59e0b' };
  const RoleIcon = { director:Shield, teacher:BookMarked, student:GraduationCap };
  const Icon = RoleIcon[session.role] || User;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
              <BookOpen size={16} color="white" />
            </div>
            <span className="font-800 text-gray-900" style={{ fontWeight:800 }}>Çözüm Etüt</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background:'#f3f4f6' }}>
              <Icon size={14} style={{ color:roleColor[session.role] }} />
              <span className="text-sm font-600 text-gray-700" style={{ fontWeight:600 }}>{session.name}</span>
              <span className="text-sm font-500 text-gray-400" style={{ fontWeight:500 }}>{roleLabel[session.role]}</span>
            </div>
            {(session.role === 'teacher' || session.role === 'student') && (
              <button onClick={() => setShowChangePassword(true)} title="Şifremi Değiştir" className="btn-ghost !px-3 !py-2">
                <Settings size={14} />
              </button>
            )}
            {session.role === 'director' && (
              <button onClick={() => setShowDirectorName(true)} title="İsmi Güncelle" className="btn-ghost !px-3 !py-2">
                <Settings size={14} />
              </button>
            )}
            <button onClick={logout} className="btn-ghost !px-3 !py-2"><LogOut size={14} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {session.role==='director' && <DirectorPanel session={session} showToast={showToast} />}
        {session.role==='teacher' && <TeacherPanel session={session} showToast={showToast} />}
        {session.role==='student' && <StudentPanel session={session} showToast={showToast} />}
      </main>
      {showChangePassword && (
        <ChangePasswordModal showToast={showToast} onClose={() => setShowChangePassword(false)} />
      )}
      {showDirectorName && (
        <DirectorNameModal current={session.name} showToast={showToast}
          onClose={() => setShowDirectorName(false)}
          onSave={newName => setSession(s => ({ ...s, name: newName }))} />
      )}
      <Toast toast={toast} />
    </div>
  );
}
