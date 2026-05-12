'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Users, LogOut, Plus, Trash2, Edit3, Save, X,
  Search, Calendar, Clock, User, Check,
  BookMarked, GraduationCap, Shield, ChevronLeft, ChevronRight,
  RefreshCw, Settings
} from 'lucide-react';

const BRANCHES = ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İnkılap Tarihi'];

function allowedBranchesForClass(cls) {
  const grade = Math.floor(parseInt(cls) / 100);
  if (grade === 7) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler'];
  if (grade === 8) return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi'];
  return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya'];
}

const WEEKDAY_SLOTS = [
  { id: 'w1', label: '15:00–15:30' },
  { id: 'w2', label: '15:45–16:15' },
  { id: 'w3', label: '16:30–17:00' },
  { id: 'w4', label: '17:15–17:45' },
  { id: 'w5', label: '18:00–18:30' },
];
const WEEKEND_SLOTS = [
  { id: 'e1', label: '14:30–15:00' },
  { id: 'e2', label: '15:15–15:45' },
  { id: 'e3', label: '16:00–16:30' },
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

function WeekNav({ weekKey, onPrev, onNext }) {
  const [year, wStr] = weekKey.split('-W');
  return (
    <div className="flex items-center gap-2">
      <button onClick={onPrev} className="btn-ghost !p-2"><ChevronLeft size={16} /></button>
      <span className="text-sm font-600 text-gray-700 min-w-[120px] text-center" style={{ fontWeight: 600 }}>
        {year} – Hafta {parseInt(wStr)}
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
function SlotGrid({ grid, teacher, weekKey, session, students, onBook, onCancel }) {
  const [bookingSlot, setBookingSlot] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);

  const filteredStudents = useMemo(() => {
    if (!students) return [];
    const q = searchQ.toLowerCase();
    return students.filter(s =>
      s.name.toLowerCase().includes(q) || s.cls.toLowerCase().includes(q) || s.username?.toLowerCase().includes(q)
    ).slice(0, 20);
  }, [students, searchQ]);

  const handleCellClick = (dayIndex, slotIdx, slotData, isForceOpen = false) => {
    if (slotData.booked) return;
    if (slotData.disabled && !isForceOpen) return;
    const slot = slotsForDay(dayIndex)[slotIdx];
    const day = ALL_DAYS.find(d => d.index === dayIndex);
    setBookingSlot({ dayIndex, slotIdx, slotId: slot.id, slotLabel: slot.label, dayLabel: day.label, forceOpen: isForceOpen });
    setSearchQ('');
    setSelectedStudent(null);
  };

  const confirmBook = async () => {
    if (!bookingSlot) return;
    let studentId = session.role === 'student' ? session.id : selectedStudent?.id;
    if (!studentId) return;
    await onBook({ teacherId: teacher.id, day: bookingSlot.dayIndex, slotId: bookingSlot.slotId, studentId, weekKey, forceOpen: bookingSlot.forceOpen });
    setBookingSlot(null);
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-xs text-gray-400 font-600 w-28" style={{ fontWeight: 600 }}>Saat</th>
              {ALL_DAYS.map(day => (
                <th key={day.index} className={`text-center py-2 px-1 text-xs font-600 ${day.weekend ? 'text-indigo-400' : 'text-gray-500'}`} style={{ fontWeight: 600 }}>
                  {day.short}
                  {day.weekend && <span className="block text-[9px] text-indigo-300">H.sonu</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Hafta içi satırları */}
            {WEEKDAY_SLOTS.map((slot, slotIdx) => (
              <tr key={slot.id} className="border-t border-gray-50">
                <td className="py-2 px-3 text-xs text-gray-500 font-500 whitespace-nowrap" style={{ fontWeight: 500 }}>{slot.label}</td>
                {ALL_DAYS.map(day => {
                  if (day.weekend) {
                    return <td key={day.index} className="py-1 px-1"><div className="rounded-lg py-2 bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs">—</div></td>;
                  }
                  const slotData = (grid && grid[day.index] && grid[day.index][slotIdx]) || { booked: false, disabled: true };
                  return <SlotCell key={day.index} slotData={slotData} slot={slot} dayIndex={day.index} slotIdx={slotIdx} session={session} teacher={teacher} onCellClick={handleCellClick} onCancel={onCancel} weekKey={weekKey} mezunForbidden={MEZUN_FORBIDDEN} />;
                })}
              </tr>
            ))}
            {/* Ayırıcı */}
            <tr><td colSpan={8} className="py-1"><div className="border-t-2 border-dashed border-indigo-100 mt-1" /></td></tr>
            {/* Hafta sonu satırları */}
            {WEEKEND_SLOTS.map((slot, slotIdx) => (
              <tr key={slot.id} className="border-t border-indigo-50 bg-indigo-50/30">
                <td className="py-2 px-3 text-xs text-indigo-400 font-500 whitespace-nowrap" style={{ fontWeight: 500 }}>{slot.label}</td>
                {ALL_DAYS.map(day => {
                  if (!day.weekend) {
                    return <td key={day.index} className="py-1 px-1"><div className="rounded-lg py-2 bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs">—</div></td>;
                  }
                  const slotData = (grid && grid[day.index] && grid[day.index][slotIdx]) || { booked: false, disabled: true };
                  return <SlotCell key={day.index} slotData={slotData} slot={slot} dayIndex={day.index} slotIdx={slotIdx} session={session} teacher={teacher} onCellClick={handleCellClick} onCancel={onCancel} weekKey={weekKey} mezunForbidden={null} />;
                })}
              </tr>
            ))}
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
                <input className="input" placeholder="İsim veya sınıf..." value={searchQ}
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
            className="w-full rounded-lg py-2 px-1 text-center border border-dashed border-amber-200 hover:border-amber-400 hover:bg-amber-50 transition-colors text-xs text-amber-200 hover:text-amber-500"
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
    const canCancel = isDirector ||
      (session.role === 'teacher' && teacher.id === session.id) ||
      (session.role === 'student' && slotData.studentId === session.id);
    return (
      <td className="py-1 px-1">
        <div className="rounded-lg py-2 px-2 text-center bg-indigo-50 border border-indigo-100 relative group">
          <div className="text-xs font-600 text-indigo-700 truncate" style={{ fontWeight: 600 }}>{slotData.studentName}</div>
          <div className="text-[10px] text-indigo-400">{slotData.studentCls}</div>
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
        className="w-full rounded-lg py-2 px-1 text-center border border-dashed border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-xs text-gray-300 hover:text-indigo-400"
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
            {WEEKDAY_SLOTS.map(slot => (
              <tr key={slot.id} className="border-t border-gray-50">
                <td className="py-1.5 px-2 text-xs text-gray-500 whitespace-nowrap">{slot.label}</td>
                {ALL_DAYS.map(day => {
                  if (day.weekend) return <td key={day.index} className="py-1 px-1"><div className="rounded py-2 bg-gray-50 text-center text-gray-200 text-xs">—</div></td>;
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
            ))}
            <tr><td colSpan={8} className="py-1"><div className="border-t-2 border-dashed border-indigo-100 mt-1" /></td></tr>
            {WEEKEND_SLOTS.map(slot => (
              <tr key={slot.id} className="border-t border-indigo-50 bg-indigo-50/20">
                <td className="py-1.5 px-2 text-xs text-indigo-400 whitespace-nowrap">{slot.label}</td>
                {ALL_DAYS.map(day => {
                  if (!day.weekend) return <td key={day.index} className="py-1 px-1"><div className="rounded py-2 bg-gray-50 text-center text-gray-200 text-xs">—</div></td>;
                  const open = (template[day.index] || []).includes(slot.id);
                  return (
                    <td key={day.index} className="py-1 px-1">
                      <button onClick={() => toggleSlot(day.index, slot.id)}
                        className={`w-full rounded-lg py-2 text-xs font-600 border transition-all ${open ? 'bg-green-50 border-green-300 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-300 hover:border-indigo-200'}`}
                        style={{ fontWeight: 600 }}>
                        {open ? '✓' : '✕'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode] = useState(directorExists ? 'login' : 'setup');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'setup') {
        await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'setup_director', username, password }) });
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
  const [weekKey, setWeekKey] = useState('');
  const [slots, setSlots] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const [weekData, slotsData, stuData] = await Promise.all([
        wk ? { weekKey: wk } : api('/api/admin/week'),
        wk ? api(`/api/slots?teacherId=${session.id}&week=${wk}`) : api(`/api/slots?teacherId=${session.id}`),
        api('/api/students'),
      ]);
      if (!wk) setWeekKey(weekData.weekKey);
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

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-700 text-gray-900" style={{ fontWeight: 700 }}>Etüt Saatlerim</h2>
          <p className="text-sm text-gray-500">{session.branch} branşı</p>
        </div>
        <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
      </div>
      <div className="card p-4">
        <SlotGrid grid={slots} teacher={{ id: session.id, name: session.name, branch: session.branch }} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} />
      </div>
      <p className="text-xs text-gray-400 mt-3 text-center">✕ = kapalı saat &nbsp;·&nbsp; + = rezervasyon yapılabilir</p>
    </div>
  );
}

// ─── STUDENT PANEL ─────────────────────────────────────────────────────────────
function StudentPanel({ session, showToast }) {
  const [weekKey, setWeekKey] = useState('');
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [tab, setTab] = useState('available');

  const loadData = useCallback(async (wk) => {
    setLoading(true);
    try {
      const weekData = wk ? { weekKey: wk } : await api('/api/admin/week');
      const resolvedWeek = wk || weekData.weekKey;
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
      if (myBookings.some(b => b.teacherId === s.teacherId)) return false;
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
        <div>
          <h2 className="text-xl font-700 text-gray-900" style={{ fontWeight: 700 }}>Etüt Ara</h2>
          <p className="text-sm text-gray-500">{classLabel(session.cls)} · {GROUPS[session.group]}</p>
        </div>
        <WeekNav weekKey={weekKey} onPrev={() => { const w = getAdjacentWeek(weekKey,-1); setWeekKey(w); loadData(w); }} onNext={() => { const w = getAdjacentWeek(weekKey,1); setWeekKey(w); loadData(w); }} />
      </div>

      <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-xl w-fit">
        {[['available','Müsait Etütler'],['myBookings','Rezervasyonlarım']].map(([key,label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab===key?'bg-white shadow text-gray-900':'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight: 600 }}>
            {label}
            {key==='myBookings' && myBookings.length>0 && <span className="ml-1.5 badge" style={{ background:'#6366f1',color:'white' }}>{myBookings.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'myBookings' ? (
        <div className="space-y-3">
          {myBookings.length === 0 ? (
            <div className="card p-8 text-center text-gray-400"><BookOpen size={32} className="mx-auto mb-2 opacity-30" /><p>Henüz etüt rezervasyonunuz yok</p></div>
          ) : myBookings.map((s,i) => (
            <div key={i} className="card p-4 flex items-center justify-between">
              <div>
                <div className="font-600 text-gray-900" style={{ fontWeight:600 }}>{s.teacherName} – {s.branch}</div>
                <div className="text-sm text-gray-500">{s.dayLabel} · {s.slotLabel}</div>
              </div>
              <button onClick={() => handleCancel({ teacherId:s.teacherId, day:s.day, slotId:s.slotId })}
                className="btn-ghost !px-3 !py-2 text-red-400 hover:text-red-600 hover:bg-red-50"><X size={14} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="card p-3 mb-4 flex flex-wrap gap-2">
            <select className="input !w-auto text-sm" value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
              <option value="">Tüm Branşlar</option>
              {studentAllowedBranches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className="input !w-auto text-sm" value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)}>
              <option value="">Tüm Öğretmenler</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className="input !w-auto text-sm" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
              <option value="">Tüm Günler</option>
              {ALL_DAYS.map(d => <option key={d.index} value={d.index}>{d.label}</option>)}
            </select>
          </div>
          {available.length === 0 ? (
            <div className="card p-8 text-center text-gray-400"><Calendar size={32} className="mx-auto mb-2 opacity-30" /><p>Uygun etüt bulunamadı</p></div>
          ) : (
            <div className="grid gap-2">
              {available.map((s,i) => (
                <div key={i} className="card p-4 flex items-center justify-between hover:shadow-md transition-shadow">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-700"
                      style={{ background:'linear-gradient(135deg,#6366f1,#4f46e5)', fontWeight:700 }}>
                      {s.branch.slice(0,2)}
                    </div>
                    <div>
                      <div className="font-600 text-gray-900" style={{ fontWeight:600 }}>{s.teacherName}</div>
                      <div className="text-xs text-gray-500">{s.branch} · {s.dayLabel} · {s.slotLabel}</div>
                    </div>
                  </div>
                  <button onClick={() => handleBook({ teacherId:s.teacherId, day:s.day, slotId:s.slotId })} className="btn-primary !px-4 !py-2 text-sm">
                    Etüt Al
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DIRECTOR PANEL ────────────────────────────────────────────────────────────
function DirectorPanel({ session, showToast }) {
  const [tab, setTab] = useState('teachers');
  const [teachers, setTeachers] = useState([]);
  const [students, setStudents] = useState([]);
  const [weekKey, setWeekKey] = useState('');
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showTeacherForm, setShowTeacherForm] = useState(false);
  const [showStudentForm, setShowStudentForm] = useState(false);
  const [editTeacher, setEditTeacher] = useState(null);
  const [editStudent, setEditStudent] = useState(null);
  const [selectedTeacherForSlots, setSelectedTeacherForSlots] = useState(null);
  const [teacherSlots, setTeacherSlots] = useState(null);
  const [templateTeacher, setTemplateTeacher] = useState(null);

  const [filterBranch, setFilterBranch] = useState('');
  const [filterTeacher, setFilterTeacher] = useState('');
  const [filterDay, setFilterDay] = useState('');

  const loadAll = useCallback(async (wk) => {
    setLoading(true);
    try {
      const [weekData, teacherData, studentData] = await Promise.all([
        wk ? { weekKey: wk } : api('/api/admin/week'),
        api('/api/teachers'),
        api('/api/students'),
      ]);
      const resolvedWeek = wk || weekData.weekKey;
      if (!wk) setWeekKey(resolvedWeek);
      setTeachers(teacherData);
      setStudents(studentData);
      const slotsData = await api(`/api/slots?week=${resolvedWeek}`);
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

  const advanceWeek = async () => {
    try {
      const data = await api('/api/admin/week', { method: 'POST', body: JSON.stringify({ action: 'advance', weekKey }) });
      showToast(`Yeni haftaya geçildi: ${data.nextWeek}`);
      loadAll(data.nextWeek);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleBook = async (params) => {
    try {
      await api('/api/slots', { method: 'POST', body: JSON.stringify(params) });
      showToast('Rezervasyon yapıldı');
      loadTeacherSlots(selectedTeacherForSlots);
      const slotsData = await api(`/api/slots?week=${weekKey}`);
      setAllSlots(slotsData.slots || []);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const handleCancel = async (params) => {
    try {
      await api('/api/slots', { method: 'DELETE', body: JSON.stringify({ ...params, weekKey }) });
      showToast('Rezervasyon iptal edildi');
      loadTeacherSlots(selectedTeacherForSlots);
      const slotsData = await api(`/api/slots?week=${weekKey}`);
      setAllSlots(slotsData.slots || []);
    } catch (err) { showToast(err.message, 'error'); }
  };

  const overviewSlots = useMemo(() => allSlots.filter(s => {
    if (filterBranch && s.branch !== filterBranch) return false;
    if (filterTeacher && s.teacherId !== filterTeacher) return false;
    if (filterDay !== '' && s.day !== parseInt(filterDay)) return false;
    return true;
  }), [allSlots, filterBranch, filterTeacher, filterDay]);

  const bookedOverview = overviewSlots.filter(s => s.booked);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Yükleniyor...</div>;

  return (
    <div>
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-xl w-fit flex-wrap">
        {[['teachers','Öğretmenler'],['students','Öğrenciler'],['slots','Etüt Saatleri'],['overview','Genel Bakış']].map(([key,label]) => (
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
          <div className="grid gap-3">
            {teachers.map(t => (
              <div key={t.id} className="card p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-700"
                    style={{ background:'linear-gradient(135deg,#6366f1,#4f46e5)', fontWeight:700 }}>
                    {t.name.slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <div className="font-600" style={{ fontWeight:600 }}>{t.name}</div>
                    <div className="text-xs text-gray-500">{t.branch} · @{t.username}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(t.allowedGroups||[]).map(g => <span key={g} className="badge" style={{ background:'#e0e7ff',color:'#4338ca' }}>{GROUPS[g]}</span>)}
                      {(t.allowedGroups||[]).length===0 && <span className="badge" style={{ background:'#f3f4f6',color:'#9ca3af' }}>Tüm gruplar</span>}
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button title="Etüt saati şablonu" className="btn-ghost !px-3 !py-2 text-indigo-400 hover:bg-indigo-50" onClick={() => setTemplateTeacher(t)}>
                    <Settings size={14} />
                  </button>
                  <button className="btn-ghost !px-3 !py-2" onClick={() => { setEditTeacher(t); setShowTeacherForm(true); }}><Edit3 size={14} /></button>
                  <button className="btn-ghost !px-3 !py-2 text-red-400 hover:bg-red-50" onClick={async () => {
                    if (!confirm(`${t.name} silinsin mi?`)) return;
                    try { await api('/api/teachers',{method:'DELETE',body:JSON.stringify({id:t.id})}); showToast('Öğretmen silindi'); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
                  }}><Trash2 size={14} /></button>
                </div>
              </div>
            ))}
            {teachers.length===0 && <div className="card p-8 text-center text-gray-400"><Users size={32} className="mx-auto mb-2 opacity-30" /><p>Henüz öğretmen eklenmemiş</p></div>}
          </div>
        </div>
      )}

      {/* STUDENTS TAB */}
      {tab === 'students' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Öğrenciler ({students.length})</h3>
            <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => { setEditStudent(null); setShowStudentForm(true); }}>
              <Plus size={14} /> Ekle
            </button>
          </div>
          <StudentList students={students}
            onEdit={s => { setEditStudent(s); setShowStudentForm(true); }}
            onDelete={async s => {
              if (!confirm(`${s.name} silinsin mi?`)) return;
              try { await api('/api/students',{method:'DELETE',body:JSON.stringify({id:s.id})}); showToast('Öğrenci silindi'); loadAll(weekKey); } catch(err){showToast(err.message,'error');}
            }} />
        </div>
      )}

      {/* SLOTS TAB */}
      {tab === 'slots' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Etüt Saati Yönetimi</h3>
            <div className="flex items-center gap-3">
              <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
              <button className="btn-ghost !px-3 !py-2 flex items-center gap-1.5 text-sm" onClick={advanceWeek}>
                <RefreshCw size={14} /> Haftayı Yenile
              </button>
            </div>
          </div>
          <div className="flex gap-2 mb-4 flex-wrap">
            {teachers.map(t => (
              <button key={t.id} onClick={() => loadTeacherSlots(t)}
                className={`px-3 py-2 rounded-lg text-sm font-500 transition-all border ${selectedTeacherForSlots?.id===t.id?'border-indigo-300 bg-indigo-50 text-indigo-700':'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}
                style={{ fontWeight:500 }}>
                {t.name} <span className="text-xs text-gray-400 ml-1">{t.branch}</span>
              </button>
            ))}
          </div>
          {selectedTeacherForSlots && teacherSlots ? (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <span className="font-600" style={{ fontWeight:600 }}>{selectedTeacherForSlots.name}</span>
                  <span className="text-sm text-gray-400 ml-2">{selectedTeacherForSlots.branch}</span>
                </div>
                <button className="btn-ghost !px-3 !py-2 flex items-center gap-1.5 text-sm text-indigo-500" onClick={() => setTemplateTeacher(selectedTeacherForSlots)}>
                  <Settings size={13} /> Şablon Düzenle
                </button>
              </div>
              <SlotGrid grid={teacherSlots} teacher={selectedTeacherForSlots} weekKey={weekKey} session={session} students={students} onBook={handleBook} onCancel={handleCancel} />
            </div>
          ) : (
            <div className="card p-8 text-center text-gray-400"><Calendar size={32} className="mx-auto mb-2 opacity-30" /><p>Bir öğretmen seçin</p></div>
          )}
        </div>
      )}

      {/* OVERVIEW TAB */}
      {tab === 'overview' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight:700 }}>Genel Bakış</h3>
            <WeekNav weekKey={weekKey} onPrev={() => handleWeekChange(getAdjacentWeek(weekKey,-1))} onNext={() => handleWeekChange(getAdjacentWeek(weekKey,1))} />
          </div>
          <div className="card p-3 mb-4 flex flex-wrap gap-2">
            <select className="input !w-auto text-sm" value={filterBranch} onChange={e => setFilterBranch(e.target.value)}>
              <option value="">Tüm Branşlar</option>
              {BRANCHES.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select className="input !w-auto text-sm" value={filterTeacher} onChange={e => setFilterTeacher(e.target.value)}>
              <option value="">Tüm Öğretmenler</option>
              {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select className="input !w-auto text-sm" value={filterDay} onChange={e => setFilterDay(e.target.value)}>
              <option value="">Tüm Günler</option>
              {ALL_DAYS.map(d => <option key={d.index} value={d.index}>{d.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="card p-4 text-center">
              <div className="text-2xl font-800" style={{ fontWeight:800, color:'#6366f1' }}>{bookedOverview.length}</div>
              <div className="text-xs text-gray-500 mt-1">Dolu Etüt</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-2xl font-800" style={{ fontWeight:800, color:'#22c55e' }}>{overviewSlots.filter(s=>!s.disabled&&!s.booked).length}</div>
              <div className="text-xs text-gray-500 mt-1">Boş Etüt</div>
            </div>
            <div className="card p-4 text-center">
              <div className="text-2xl font-800" style={{ fontWeight:800, color:'#f59e0b' }}>
                {(() => { const open=overviewSlots.filter(s=>!s.disabled); return open.length>0?Math.round((bookedOverview.length/open.length)*100):0; })()}%
              </div>
              <div className="text-xs text-gray-500 mt-1">Doluluk</div>
            </div>
          </div>
          <div className="space-y-2">
            {bookedOverview.map((s,i) => (
              <div key={i} className="card p-3 flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <span className="badge" style={{ background:'#e0e7ff',color:'#4338ca' }}>{s.branch}</span>
                  <span className="font-500" style={{ fontWeight:500 }}>{s.teacherName}</span>
                  <span className="text-gray-400">{s.dayLabel} {s.slotLabel}</span>
                </div>
                <div className="text-gray-700 font-500" style={{ fontWeight:500 }}>{s.studentName} <span className="text-gray-400 text-xs">({s.studentCls})</span></div>
              </div>
            ))}
            {bookedOverview.length===0 && <div className="card p-8 text-center text-gray-400">Henüz rezervasyon yok</div>}
          </div>
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
      {templateTeacher && (
        <TemplateEditor teacher={templateTeacher} showToast={showToast}
          onClose={() => setTemplateTeacher(null)}
          onSave={async () => {
            setTemplateTeacher(null);
            loadAll(weekKey);
            if (selectedTeacherForSlots?.id === templateTeacher.id) await loadTeacherSlots(templateTeacher);
          }} />
      )}
    </div>
  );
}

function StudentList({ students, onEdit, onDelete }) {
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const filtered = useMemo(() => {
    const q = searchQ.toLowerCase();
    return students.filter(s =>
      (s.name.toLowerCase().includes(q)||s.cls.toLowerCase().includes(q)||s.username?.toLowerCase().includes(q)) &&
      (!filterGroup||s.group===filterGroup)
    );
  }, [students, searchQ, filterGroup]);
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
        {filtered.map(s => (
          <div key={s.id} className="card p-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-700"
                style={{ background:s.group==='lise'?'linear-gradient(135deg,#6366f1,#4f46e5)':s.group==='ortaokul'?'linear-gradient(135deg,#22c55e,#16a34a)':'linear-gradient(135deg,#f59e0b,#d97706)', fontWeight:700 }}>
                {s.name.slice(0,2).toUpperCase()}
              </div>
              <div>
                <span className="font-600" style={{ fontWeight:600 }}>{s.name}</span>
                <span className="text-gray-400 ml-2 text-xs">{classLabel(s.cls)}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-ghost !px-2 !py-1.5" onClick={() => onEdit(s)}><Edit3 size={12} /></button>
              <button className="btn-ghost !px-2 !py-1.5 text-red-400 hover:bg-red-50" onClick={() => onDelete(s)}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
        {filtered.length===0 && <div className="card p-8 text-center text-gray-400"><GraduationCap size={32} className="mx-auto mb-2 opacity-30" /><p>Öğrenci bulunamadı</p></div>}
      </div>
    </div>
  );
}

function TeacherForm({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name||'');
  const [username, setUsername] = useState(initial?.username||'');
  const [password, setPassword] = useState('');
  const [branch, setBranch] = useState(initial?.branch||BRANCHES[0]);
  const [allowedGroups, setAllowedGroups] = useState(initial?.allowedGroups||[]);
  const [loading, setLoading] = useState(false);
  const toggleGroup = g => setAllowedGroups(prev => prev.includes(g)?prev.filter(x=>x!==g):[...prev,g]);
  const submit = async e => { e.preventDefault(); setLoading(true); await onSave({name,username,password,branch,allowedGroups}); setLoading(false); };
  return (
    <Modal title={initial?'Öğretmen Düzenle':'Yeni Öğretmen'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label="Kullanıcı Adı"><input className="input" value={username} onChange={e=>setUsername(e.target.value)} required /></FormField>
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
  const [username, setUsername] = useState(initial?.username||'');
  const [password, setPassword] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(initial?.group||'ortaokul');
  const [cls, setCls] = useState(initial?.cls||STUDENT_GROUPS.ortaokul.classes[0]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!initial) setCls(STUDENT_GROUPS[selectedGroup].classes[0]); }, [selectedGroup]);
  const submit = async e => { e.preventDefault(); setLoading(true); await onSave({name,username,password,cls}); setLoading(false); };
  return (
    <Modal title={initial?'Öğrenci Düzenle':'Yeni Öğrenci'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label="Kullanıcı Adı"><input className="input" value={username} onChange={e=>setUsername(e.target.value)} required /></FormField>
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

// ─── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [directorExists, setDirectorExists] = useState(false);
  const [toast, setToast] = useState(null);

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
            <span className="font-800 text-gray-900" style={{ fontWeight:800 }}>Etüt Takip</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background:'#f3f4f6' }}>
              <Icon size={14} style={{ color:roleColor[session.role] }} />
              <span className="text-sm font-600 text-gray-700" style={{ fontWeight:600 }}>{session.name}</span>
              <span className="badge" style={{ background:roleColor[session.role]+'20', color:roleColor[session.role] }}>{roleLabel[session.role]}</span>
            </div>
            <button onClick={logout} className="btn-ghost !px-3 !py-2"><LogOut size={14} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {session.role==='director' && <DirectorPanel session={session} showToast={showToast} />}
        {session.role==='teacher' && <TeacherPanel session={session} showToast={showToast} />}
        {session.role==='student' && <StudentPanel session={session} showToast={showToast} />}
      </main>
      <Toast toast={toast} />
    </div>
  );
}
