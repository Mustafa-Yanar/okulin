'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Users, LogOut, Plus, Trash2, Edit3, Save, X,
  Search, Calendar, Clock, User, Check,
  BookMarked, GraduationCap, Shield, ChevronLeft, ChevronRight,
  RefreshCw, Settings, Lock, LayoutGrid, List
} from 'lucide-react';

const BRANCHES = ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İnkılap Tarihi', 'İngilizce'];

function allowedBranchesForClass(cls) {
  const grade = Math.floor(parseInt(cls) / 100);
  if (grade === 7) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  if (grade === 8) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya'];
}

const WEEKDAY_SLOTS = [
  { id: 'w1', label: '15:00–15:30' },
  { id: 'w2', label: '15:45–16:15' },
  { id: 'w3', label: '16:30–17:00' },
  { id: 'w4', label: '17:15–17:45' },
  { id: 'w5', label: '18:00–18:30' },
];
const WEEKEND_SLOT_COUNT = 3; // hafta sonu sadece w1-w3
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
  return dayIndex >= 5 ? WEEKDAY_SLOTS.slice(0, WEEKEND_SLOT_COUNT) : WEEKDAY_SLOTS;
}

const MEZUN_FORBIDDEN = 'w3';
const GROUPS = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };
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
function SlotGrid({ grid, teacher, weekKey, session, students, onBook, onCancel, hideEmptyDays }) {
  const [bookingSlot, setBookingSlot] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [fixedBooking, setFixedBooking] = useState(false);

  const filteredStudents = useMemo(() => {
    if (!students) return [];
    const q = searchQ.toLowerCase();
    const allowedGroups = teacher.allowedGroups;
    return students.filter(s => {
      if (allowedGroups && allowedGroups.length > 0 && !allowedGroups.includes(s.group)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) ||
        s.cls.toLowerCase().includes(q) ||
        classLabel(s.cls).toLowerCase().includes(q);
    }).slice(0, 20);
  }, [students, searchQ, teacher.allowedGroups]);

  // hideEmptyDays=true ise hiç etüt alınmamış günleri gizle
  const visibleDays = useMemo(() => {
    if (!hideEmptyDays || !grid) return ALL_DAYS;
    return ALL_DAYS.filter(day => {
      const daySlots = slotsForDay(day.index);
      return daySlots.some((_, slotIdx) => {
        const sd = grid[day.index]?.[slotIdx];
        return sd && !sd.disabled;
      });
    });
  }, [grid, hideEmptyDays]);

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
            {WEEKDAY_SLOTS.map((slot, slotIdx) => {
              const isWeekendSlot = slotIdx < WEEKEND_SLOT_COUNT;
              // hafta sonu olmayan slotlarda hafta sonu günleri zaten visibleDays'den çıkmış olabilir
              const daysToRender = visibleDays.filter(day => !(day.weekend && !isWeekendSlot));
              if (daysToRender.length === 0 && visibleDays.every(d => d.weekend)) return null;
              return (
                <tr key={slot.id} className="border-t border-gray-50">
                  <td className="py-2 px-3 text-xs text-gray-500 font-500 whitespace-nowrap" style={{ fontWeight: 500 }}>{slot.label}</td>
                  {visibleDays.map(day => {
                    if (day.weekend && !isWeekendSlot) {
                      return <td key={day.index} className="py-1 px-1"><div className="rounded-lg py-2 bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs">—</div></td>;
                    }
                    const slotData = (grid && grid[day.index] && grid[day.index][slotIdx]) || { booked: false, disabled: true };
                    return <SlotCell key={day.index} slotData={slotData} slot={slot} dayIndex={day.index} slotIdx={slotIdx} session={session} teacher={teacher} onCellClick={handleCellClick} onCancel={onCancel} weekKey={weekKey} mezunForbidden={day.weekend ? null : MEZUN_FORBIDDEN} />;
                  })}
                </tr>
              );
            })}
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

function SlotCell({ slotData, slot, dayIndex, slotIdx, session, teacher, onCellClick, onCancel, weekKey, mezunForbidden }) {
  const isForbidden = session.role === 'student' && session.group === 'mezun' && mezunForbidden && slot.id === mezunForbidden;
  const isDirector = session.role === 'director';

  if (isForbidden) {
    return (
      <td className="py-1 px-1">
        <div className="rounded-lg py-2 px-1 text-center text-xs text-gray-200 bg-gray-50 border border-dashed border-gray-100">—</div>
      </td>
    );
  }

  if (slotData.disabled) {
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
function TemplateEditor({ teacher, onClose, onSave, showToast }) {
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api(`/api/teachers/template?teacherId=${teacher.id}`);
        // Convert string keys from JSON to numbers
        const normalized = {};
        for (const [k, v] of Object.entries(data.template || {})) {
          normalized[parseInt(k)] = v;
        }
        setTemplate(normalized);
      } catch {
        setTemplate({});
      } finally {
        setLoading(false);
      }
    })();
  }, [teacher.id]);

  const toggleSlot = (dayIndex, slotId) => {
    setTemplate(prev => {
      const current = prev[dayIndex] || [];
      const next = current.includes(slotId)
        ? current.filter(s => s !== slotId)
        : [...current, slotId];
      return { ...prev, [dayIndex]: next };
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api('/api/teachers/template', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, template }) });
      showToast('Şablon kaydedildi ve haftaya uygulandı');
      onSave();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <Modal title={`${teacher.name} – Etüt Saati Şablonu`} onClose={onClose} wide>
      <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
    </Modal>
  );

  return (
    <Modal title={`${teacher.name} – Etüt Saati Şablonu`} onClose={onClose} wide>
      <p className="text-sm text-gray-500 mb-4">
        Yeşil kutucuklar <strong>açık</strong> (öğrenci alınabilir), gri kutucuklar <strong>kapalı</strong> saatleri gösterir. Her hafta bu şablon otomatik uygulanır.
      </p>
      <div className="overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 px-2 text-xs text-gray-400 font-600 w-24" style={{ fontWeight: 600 }}>Saat</th>
              {ALL_DAYS.map(day => (
                <th key={day.index} className={`text-center py-2 px-1 text-xs font-600 ${day.weekend ? 'text-indigo-400' : 'text-gray-500'}`} style={{ fontWeight: 600 }}>
                  {day.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_SLOTS.map((slot, slotIdx) => {
              const isWeekendSlot = slotIdx < WEEKEND_SLOT_COUNT;
              return (
                <tr key={slot.id} className="border-t border-gray-50">
                  <td className="py-1.5 px-2 text-xs text-gray-500 whitespace-nowrap">{slot.label}</td>
                  {ALL_DAYS.map(day => {
                    const validForDay = day.weekend ? isWeekendSlot : true;
                    if (!validForDay) return <td key={day.index} className="py-1 px-1"><div className="rounded py-2 bg-gray-50 text-center text-gray-200 text-xs">—</div></td>;
                    const open = (template[day.index] || []).includes(slot.id);
                    return (
                      <td key={day.index} className="py-1 px-1">
                        <button onClick={() => toggleSlot(day.index, slot.id)}
                          className={`w-full rounded-lg py-2 text-xs font-600 border transition-all ${open ? 'bg-green-50 border-green-300 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-300 hover:border-gray-300'}`}
                          style={{ fontWeight: 600 }}>
                          {open ? '✓' : '✕'}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex gap-3">
        <button className="btn-primary flex-1" onClick={handleSave} disabled={saving}>
          {saving ? 'Kaydediliyor...' : 'Kaydet ve Uygula'}
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
function TeacherPanel({ session, showToast }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [slots, setSlots] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'list'

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const resolvedWeek = wk || getWeekKey();
      if (!wk) setWeekKey(resolvedWeek);
      const [slotsData, stuData] = await Promise.all([
        api(`/api/slots?teacherId=${session.id}&week=${resolvedWeek}`),
        api('/api/students'),
      ]);
      setSlots(slotsData.grid);
      setStudents(stuData);
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

  // Dolu slotları gün+saat sırasına göre listele
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
            <SlotGrid grid={slots} teacher={{ id: session.id, name: session.name, branch: session.branch }} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} hideEmptyDays />
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">✕ = kapalı saat &nbsp;·&nbsp; + = rezervasyon yapılabilir</p>
        </>
      ) : (
        <TeacherBookingsList bookedList={bookedList} listColorMap={listColorMap}
          onCancel={item => handleCancel({ teacherId: session.id, day: item.dayIndex, slotId: item.slotId })} />
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
      if (s.allowedGroups?.length > 0 && !s.allowedGroups.includes(session.group)) return false;
      if (session.group === 'mezun' && s.slotId === MEZUN_FORBIDDEN) return false;
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
  const [slotModalTeacher, setSlotModalTeacher] = useState(null);
  const [templateTeacher, setTemplateTeacher] = useState(null);
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

  const openSlotModal = async (teacher) => {
    const data = await api(`/api/slots?teacherId=${teacher.id}&week=${weekKey}`);
    setTeacherSlots(data.grid);
    setSelectedTeacherForSlots(teacher);
    setSlotModalTeacher(teacher);
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
        {[['teachers','Öğretmenler'],['students','Öğrenciler']].map(([key,label]) => (
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
                          <button className="btn-primary !px-3 !py-1.5 flex items-center gap-1.5 text-sm" onClick={() => openSlotModal(t)}>
                            <LayoutGrid size={13} /> Tablo
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
      {slotModalTeacher && teacherSlots && (
        <Modal title={`${slotModalTeacher.name} – ${slotModalTeacher.branch}`} onClose={() => setSlotModalTeacher(null)} wide>
          <div className="flex items-center justify-between mb-4">
            <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
            <button className="btn-ghost !px-3 !py-2 flex items-center gap-1.5 text-sm text-indigo-500" onClick={() => setTemplateTeacher(slotModalTeacher)}>
              <Settings size={13} /> Şablon
            </button>
          </div>
          <SlotGrid grid={teacherSlots} teacher={slotModalTeacher} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} />
        </Modal>
      )}
      {templateTeacher && (
        <TemplateEditor teacher={templateTeacher} showToast={showToast}
          onClose={() => setTemplateTeacher(null)}
          onSave={async () => {
            setTemplateTeacher(null);
            loadAll(weekKey);
            if (selectedTeacherForSlots?.id === templateTeacher.id) await loadTeacherSlots(templateTeacher);
          }} />
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
                {onDeleteClass && (
                  <button onClick={() => onDeleteClass(grp.cls, grp.students)}
                    className="ml-2 p-1 rounded hover:bg-red-100 text-red-400 hover:text-red-600 transition-colors"
                    title="Sınıfı sil">
                    <Trash2 size={12} />
                  </button>
                )}
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
    </div>
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
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!initial) setCls(STUDENT_GROUPS[selectedGroup].classes[0]); }, [selectedGroup]);
  const submit = async e => { e.preventDefault(); setLoading(true); await onSave({name, username: name, password, cls}); setLoading(false); };
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
