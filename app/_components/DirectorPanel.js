'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  BookOpen, Users, Plus, Trash2, Edit3, Save, X, Search, Calendar, Clock, User, Check,
  BookMarked, GraduationCap, Shield, ChevronLeft, ChevronRight, Settings, Lock, LayoutGrid,
  List, ClipboardList, Phone, Wallet, KeyRound
} from 'lucide-react';
import { useSlotTimes } from './SlotTimesContext';
import { isValidTurkishMobile, formatTurkishMobile } from '@/lib/phone';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import DirectorDenemeYonetimi from './rehberlik/DirectorDenemeYonetimi';
import ProgramOlusturucu from './program/ProgramOlusturucu';
import FinancePanel from './finance/FinancePanel';
import { StudentBookingsView } from './StudentPanel';
import { TeacherBookingsList } from './TeacherPanel';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';

import {
  STUDENT_GROUPS,
  ALL_DAYS,
  WEEKDAY_SLOT_IDS,
  WEEKEND_SLOT_IDS,
  classLabel,
  getWeekKey,
  weekRangeLabel,
  slotsForDay,
  branchesForGroups,
  makeSlots
} from '@/lib/constants';
import {
  GROUPS, api, Modal, Label, FormField,
  getAdjacentWeek, WeekNav, isSlotPast, guidanceSubjectsFor,
} from './director/shared';
import { TeacherForm, StudentForm, ImportModal, ResetPasswordModal } from './director/Forms';

// ─── MÜDÜR YOKLAMA BİLEŞENLERİ ──────────────────────────────────────────────────
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
                className="card aspect-square flex flex-col items-center justify-center gap-1.5 hover:shadow-lg hover:border-indigo-400 hover:-translate-y-px hover:bg-indigo-50/30 transition-all duration-200 cursor-pointer p-3">
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

// ─── DIRECTOR MUHASEBE TAB ────────────────────────────────────────────────────
function DirectorMuhasebeTab({ session, showToast }) {
  const [subTab, setSubTab] = useState('finance');
  const [accountants, setAccountants] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editAcc, setEditAcc] = useState(null);
  const [form, setForm] = useState({ name: '', password: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadAccountants() {
    setLoading(true);
    try {
      const res = await fetch('/api/accountants', { credentials: 'same-origin' });
      const data = await res.json();
      setAccountants(Array.isArray(data) ? data : []);
    } catch { showToast('Muhasebeciler yüklenemedi', 'error'); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (subTab === 'accountants') loadAccountants(); }, [subTab]);

  function openNew() { setEditAcc(null); setForm({ name: '', password: '' }); setShowForm(true); }
  function openEdit(a) { setEditAcc(a); setForm({ name: a.name, password: '' }); setShowForm(true); }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { showToast('İsim gerekli', 'error'); return; }
    if (!editAcc && !form.password) { showToast('Şifre gerekli', 'error'); return; }
    setSaving(true);
    try {
      const body = editAcc
        ? { id: editAcc.id, name: form.name, password: form.password || undefined }
        : { name: form.name, password: form.password };
      const res = await fetch('/api/accountants', {
        method: editAcc ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Hata');
      showToast(editAcc ? 'Muhasebeci güncellendi' : 'Muhasebeci eklendi');
      setShowForm(false);
      loadAccountants();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  }

  async function handleDelete(id, name) {
    if (!confirm(`"${name}" isimli muhasebeci silinsin mi?`)) return;
    try {
      const res = await fetch('/api/accountants', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Silme hatası');
      showToast('Muhasebeci silindi');
      loadAccountants();
    } catch (err) { showToast(err.message, 'error'); }
  }

  return (
    <div>
      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-xl w-fit">
        {[['finance', '📊 Öğrenci Ödemeleri'], ['accountants', '👤 Muhasebeciler']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${subTab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight: 600 }}>{l}</button>
        ))}
      </div>

      {subTab === 'finance' && <FinancePanel session={session} showToast={showToast} />}

      {subTab === 'accountants' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Muhasebeciler ({accountants.length})</h3>
            <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={openNew}>
              <Plus size={14} /> Ekle
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32 text-gray-400">Yükleniyor...</div>
          ) : accountants.length === 0 ? (
            <div className="text-center py-12">
              <Wallet size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-gray-400 text-sm">Henüz muhasebeci eklenmemiş.</p>
              <button className="mt-3 btn-primary !px-4 !py-2 text-sm" onClick={openNew}>
                <Plus size={13} className="inline mr-1" /> İlk muhasebeciyi ekle
              </button>
            </div>
          ) : (
            <div className="grid gap-2">
              {accountants.map(a => (
                <div key={a.id} className="card flex items-center px-4 py-3.5 gap-3 hover:shadow-md transition-all">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white font-700 text-sm"
                    style={{ background: 'linear-gradient(135deg,#0891b2,#0284c7)', fontWeight: 700 }}>
                    {a.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-600 text-gray-800" style={{ fontWeight: 600 }}>{a.name}</div>
                    <div className="text-xs text-gray-400">Kullanıcı adı: <span className="text-gray-600 font-500">{a.username}</span></div>
                  </div>
                  <span className="text-[11px] px-2.5 py-1 rounded-lg font-600" style={{ background: '#e0f2fe', color: '#0369a1', fontWeight: 600 }}>
                    Muhasebeci
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(a)} className="p-2 rounded-lg hover:bg-indigo-50 text-gray-400 hover:text-indigo-600 transition-colors" title="Düzenle">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDelete(a.id, a.name)} className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors" title="Sil">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showForm && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
              onClick={e => e.target === e.currentTarget && setShowForm(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
                <div className="flex items-center justify-between p-5 border-b border-gray-100">
                  <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
                    {editAcc ? 'Muhasebeci Düzenle' : 'Yeni Muhasebeci'}
                  </h3>
                  <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-gray-100"><X size={16} /></button>
                </div>
                <form onSubmit={handleSave} className="p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>Ad Soyad</label>
                    <input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
                      placeholder="Örn: Ayşe Yılmaz"
                      required autoFocus
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Kullanıcı adı olarak da kullanılacak</p>
                  </div>
                  <div>
                    <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>
                      Şifre {editAcc && <span className="normal-case text-gray-400 font-400">(boş bırakırsan değişmez)</span>}
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:border-indigo-400 focus:outline-none"
                      placeholder={editAcc ? 'Yeni şifre (opsiyonel)' : 'Şifre girin'}
                      required={!editAcc}
                    />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="submit" disabled={saving}
                      className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-700 text-sm hover:from-cyan-600 hover:to-blue-700 transition-all disabled:opacity-50"
                      style={{ fontWeight: 700 }}
                    >{saving ? 'Kaydediliyor…' : editAcc ? 'Güncelle' : 'Ekle'}</button>
                    <button type="button" onClick={() => setShowForm(false)}
                      className="px-4 py-3 rounded-xl bg-gray-100 text-gray-600 font-600 text-sm hover:bg-gray-200 transition-colors"
                      style={{ fontWeight: 600 }}>İptal</button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── STUDENT LIST & RELATED ─────────────────────────────────────────────────────
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

function StudentAttendanceView({ studentId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api(`/api/attendance/student?studentId=${studentId}`);
        setData(d);
      } catch {
        setData({ entries: [], summary: { yok: 0, gec: 0 } });
      }
      setLoading(false);
    })();
  }, [studentId]);

  if (loading) return <div className="py-8 text-center text-gray-400 text-sm">Yükleniyor...</div>;
  if (!data || data.entries.length === 0) return (
    <div className="py-8 text-center text-gray-400">
      <ClipboardList size={28} className="mx-auto mb-2 opacity-30" />
      <p className="text-sm">Devamsızlık kaydı yok</p>
    </div>
  );

  const byDate = {};
  for (const e of data.entries) {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  }

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        {data.summary.yok > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-600" style={{ fontWeight: 600 }}>
            {data.summary.yok} Yok
          </span>
        )}
        {data.summary.gec > 0 && (
          <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-600" style={{ fontWeight: 600 }}>
            {data.summary.gec} Geç
          </span>
        )}
        <span className="text-xs text-gray-400 ml-1">Toplam {data.entries.length} kayıt</span>
      </div>
      <div className="space-y-1.5">
        {Object.entries(byDate).map(([date, items]) => {
          const d = new Date(date);
          const fmtDate = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
          return (
            <div key={date} className="card overflow-hidden">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                <span className="font-700 text-sm text-gray-800" style={{ fontWeight: 700 }}>{fmtDate}</span>
                <span className="text-xs text-gray-400 ml-2">{items[0].dayLabel}</span>
              </div>
              <div className="p-2 space-y-1">
                {items.map((e, i) => {
                  const statusClass = e.status === 'yok'
                    ? 'bg-red-50 border-red-100 text-red-700'
                    : 'bg-amber-50 border-amber-100 text-amber-700';
                  return (
                    <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${statusClass}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-700 shrink-0 ${e.status === 'yok' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`} style={{ fontWeight: 700 }}>
                          {e.status === 'yok' ? 'YOK' : 'GEÇ'}
                        </span>
                        <span className="text-xs font-600 shrink-0" style={{ fontWeight: 600 }}>{e.lessonNo}. Ders</span>
                        {e.slotLabel && <span className="text-xs opacity-70 shrink-0">({e.slotLabel})</span>}
                      </div>
                      <span className="text-xs opacity-70 text-right truncate ml-2">
                        {e.teacherName}{(e.subBranch || e.branch) ? ` · ${e.subBranch || e.branch}` : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function StudentList({ students, allSlots, weekKey, onCancelBooking, onEdit, onDelete, onDeleteClass, onReset, onHistory, pendingGuidance, onGuidanceReviewed }) {
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
        <input className="input text-sm" placeholder="İsim, sınıf..." value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <select className="input !w-auto text-sm" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">Tüm Gruplar</option>
          {Object.entries(GROUPS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        {grouped.length === 0 && <div className="card p-8 text-center text-gray-400"><GraduationCap size={32} className="mx-auto mb-2 opacity-30" /><p>Öğrenci bulunamadı</p></div>}
        {grouped.map(grp => {
          const isOpen = openCls === grp.cls;
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
                    <div key={s.id} className={`card overflow-hidden text-sm transition-all duration-200 ${expandedId === s.id ? '' : 'hover:shadow-lg hover:border-indigo-400 hover:-translate-y-px hover:bg-indigo-50/30'}`}>
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
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col animate-slide-in">
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
                <h3 className="font-700 text-base truncate" style={{ fontWeight: 700 }}>
                  {st.name} <span className="font-500 text-gray-400 text-sm" style={{ fontWeight: 500 }}>· {classLabel(st.cls)}</span>
                </h3>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => onReset(st)} className="p-2 rounded-lg text-amber-500 hover:bg-amber-50" title="Şifre sıfırla"><KeyRound size={18} /></button>
                  <button onClick={() => setExpandedId(null)} className="p-2 rounded-lg hover:bg-gray-100" title="Kapat"><X size={18} /></button>
                </div>
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

// ─── FORMS & MODALS ─────────────────────────────────────────────────────────────

function HistoryModal({ target, onClose, currentWeekKey, currentEntries }) {
  const isStudent = target.type === 'student';
  const [activeTab, setActiveTab] = useState('etut');
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState(null);
  const [attLoading, setAttLoading] = useState(false);
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

  useEffect(() => {
    if (!isStudent || activeTab !== 'devamsizlik' || attendance !== null) return;
    (async () => {
      setAttLoading(true);
      try {
        const data = await api(`/api/attendance/student?studentId=${target.id}`);
        setAttendance(data);
      } catch {
        setAttendance({ entries: [], summary: { yok: 0, gec: 0 } });
      }
      setAttLoading(false);
    })();
  }, [activeTab, isStudent, target.id, attendance]);

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

  const modalTitle = isStudent
    ? `${target.name} – Geçmiş`
    : `${target.name} – Geçmiş Etütler`;

  const etutContent = (
    loading ? (
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
      )
    );

  const devamsizlikContent = (
    attLoading || attendance === null ? (
      <div className="py-12 text-center text-gray-400">Yükleniyor...</div>
    ) : attendance.entries.length === 0 ? (
      <div className="py-12 text-center text-gray-400">
        <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
        <p>Devamsızlık kaydı yok</p>
        <p className="text-xs mt-1 text-gray-300">Yok veya geç olarak işaretlenmiş ders bulunmuyor</p>
      </div>
    ) : (
      <>
        <div className="flex items-center gap-2 mb-4">
          {attendance.summary.yok > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-red-100 text-red-700 font-600" style={{ fontWeight: 600 }}>
              {attendance.summary.yok} Yok
            </span>
          )}
          {attendance.summary.gec > 0 && (
            <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-600" style={{ fontWeight: 600 }}>
              {attendance.summary.gec} Geç
            </span>
          )}
          <span className="text-xs text-gray-400 ml-1">Toplam {attendance.entries.length} kayıt</span>
        </div>
        <div className="space-y-1.5">
          {(() => {
            const byDate = {};
            for (const e of attendance.entries) {
              if (!byDate[e.date]) byDate[e.date] = [];
              byDate[e.date].push(e);
            }
            return Object.entries(byDate).map(([date, items]) => {
              const d = new Date(date);
              const fmtDate = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
              return (
                <div key={date} className="card overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <span className="font-700 text-sm text-gray-800" style={{ fontWeight: 700 }}>{fmtDate}</span>
                      <span className="text-xs text-gray-400 ml-2">{items[0].dayLabel}</span>
                    </div>
                  </div>
                  <div className="p-2 space-y-1">
                    {items.map((e, i) => {
                      const statusClass = e.status === 'yok'
                        ? 'bg-red-50 border-red-100 text-red-700'
                        : 'bg-amber-50 border-amber-100 text-amber-700';
                      return (
                        <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${statusClass}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-700 shrink-0 ${e.status === 'yok' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`} style={{ fontWeight: 700 }}>
                              {e.status === 'yok' ? 'YOK' : 'GEÇ'}
                            </span>
                            <span className="text-xs font-600 shrink-0" style={{ fontWeight: 600 }}>{e.lessonNo}. Ders</span>
                            {e.slotLabel && <span className="text-xs opacity-70 shrink-0">({e.slotLabel})</span>}
                          </div>
                          <span className="text-xs opacity-70 text-right truncate ml-2">
                            {e.teacherName}{(e.subBranch || e.branch) ? ` · ${e.subBranch || e.branch}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </>
    )
  );

  return (
    <Modal title={modalTitle} onClose={onClose} wide>
      {isStudent && (
        <div className="flex rounded-xl border border-gray-200 overflow-hidden mb-4 w-fit">
          <button
            onClick={() => setActiveTab('etut')}
            className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors ${activeTab === 'etut' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            style={{ fontWeight: 600 }}>
            <Clock size={13} /> Geçmiş Etütler
          </button>
          <button
            onClick={() => setActiveTab('devamsizlik')}
            className={`px-4 py-2 text-xs flex items-center gap-1.5 transition-colors ${activeTab === 'devamsizlik' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
            style={{ fontWeight: 600 }}>
            <ClipboardList size={13} /> Devamsızlık Bilgisi
          </button>
        </div>
      )}
      {(!isStudent || activeTab === 'etut') && etutContent}
      {isStudent && activeTab === 'devamsizlik' && devamsizlikContent}
    </Modal>
  );
}

function ProgramEditor({ teacher, onClose, showToast, students }) {
  const currentWeek = getWeekKey();
  const maxWeek = getAdjacentWeek(getAdjacentWeek(currentWeek, 1), 1);
  const [weekKey, setWeekKey] = useState(currentWeek);
  const [program, setProgram] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeCell, setActiveCell] = useState(null);
  const [offDays, setOffDays] = useState(teacher.offDays || []);
  const [togglingDay, setTogglingDay] = useState(null);
  const [dirty, setDirty] = useState({});

  const { slotTimes } = useSlotTimes();
  const weekdaySlots = useMemo(() => makeSlots(WEEKDAY_SLOT_IDS, slotTimes.weekday), [slotTimes.weekday]);
  const weekendSlots = useMemo(() => makeSlots(WEEKEND_SLOT_IDS, slotTimes.weekend), [slotTimes.weekend]);

  useEffect(() => {
    setLoading(true);
    setActiveCell(null);
    setDirty({});
    (async () => {
      try {
        const data = await api(`/api/program?teacherId=${teacher.id}&week=${weekKey}`);
        setProgram(data.program || {});
      } catch {
        setProgram({});
      } finally {
        setLoading(false);
      }
    })();
  }, [teacher.id, weekKey]);

  const canPrev = weekKey !== currentWeek;
  const canNext = weekKey !== maxWeek;

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
    setDirty(prev => ({ ...prev, [`${dayIndex}:${slotId}`]: entry }));
  }

  function clearEntry(dayIndex, slotId) {
    setProgram(prev => {
      const day = { ...(prev?.[String(dayIndex)] || {}) };
      delete day[slotId];
      return { ...prev, [String(dayIndex)]: day };
    });
    setDirty(prev => ({ ...prev, [`${dayIndex}:${slotId}`]: null }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const diff = {};
      for (const [key, entry] of Object.entries(dirty)) {
        const [dayIdx, slotId] = key.split(':');
        if (!diff[dayIdx]) diff[dayIdx] = {};
        diff[dayIdx][slotId] = entry;
      }
      await api('/api/program', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, weekKey, program: diff }) });
      showToast('Program kaydedildi ve uygulandı');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffDay(dayIndex) {
    const isCurrentlyOff = offDays.includes(dayIndex);
    const willBeOff = !isCurrentlyOff;
    if (willBeOff) {
      const dayProg = program?.[String(dayIndex)] || {};
      const hasEntries = Object.values(dayProg).some(e => e && e.type);
      if (hasEntries) {
        if (!confirm('Bu güne tanımlı ders/etüt var. İzin günü yapılırsa hepsi silinecek. Devam etmek istiyor musunuz?')) return;
      }
    }
    setTogglingDay(dayIndex);
    try {
      const res = await api('/api/teachers', {
        method: 'PUT',
        body: JSON.stringify({ action: 'toggle_off_day', id: teacher.id, dayIndex, off: willBeOff }),
      });
      setOffDays(res.offDays || []);
      if (willBeOff) {
        setProgram(prev => {
          const next = { ...(prev || {}) };
          delete next[String(dayIndex)];
          return next;
        });
        setDirty(prev => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (k.startsWith(`${dayIndex}:`)) delete next[k];
          }
          return next;
        });
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setTogglingDay(null);
    }
  }

  const allowedStudents = students
    ? students.filter(s => !teacher.allowedGroups?.length || teacher.allowedGroups.includes(s.group))
    : [];

  function handleSlotClick(dayIndex, slotId) {
    const entry = getEntry(dayIndex, slotId);
    if (!entry || !entry.type) {
      setEntry(dayIndex, slotId, { type: 'available', fixed: true });
    } else if (entry.type === 'available') {
      setActiveCell(prev => prev?.slotId === slotId && prev?.dayIndex === dayIndex ? null : { dayIndex, slotId });
    } else if (entry.type === 'etut') {
      setActiveCell(prev => prev?.slotId === slotId && prev?.dayIndex === dayIndex ? null : { dayIndex, slotId });
    }
  }

  function EtutPanel({ dayIndex, slotId }) {
    const existing = getEntry(dayIndex, slotId);
    const [studentId, setStudentId] = useState(existing?.studentId || '');
    const [studentName, setStudentName] = useState(existing?.studentName || '');
    const [studentCls, setStudentCls] = useState(existing?.studentCls || '');
    const [fixed, setFixed] = useState(existing?.fixed !== false);
    const [studentSearch, setStudentSearch] = useState('');

    function saveEtut() {
      setEntry(dayIndex, slotId, { type: 'etut', studentId, studentName, studentCls, fixed });
      setActiveCell(null);
    }

    return (
      <div className="p-4 border-t border-gray-100 bg-gray-50">
        <div className="text-xs font-600 text-gray-500 mb-2" style={{ fontWeight: 600 }}>
          {ALL_DAYS.find(d => d.index === dayIndex)?.label} – {slotsForDay(dayIndex, slotTimes).find(s => s.id === slotId)?.label}
        </div>
        <div className="flex gap-2 mb-3">
          <button onClick={() => { clearEntry(dayIndex, slotId); setActiveCell(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-600 border bg-white border-gray-200 text-gray-500 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-all"
            style={{ fontWeight: 600 }}>Slotu Kapat</button>
          <button onClick={() => { setEntry(dayIndex, slotId, { type: 'etut', studentId: '', studentName: '', studentCls: '', fixed: true }); setActiveCell(null); }}
            className="px-3 py-1.5 rounded-lg text-xs font-600 border bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-all"
            style={{ fontWeight: 600 }}>Açık Etüt</button>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Sabit öğrenci rezervasyonu (opsiyonel)</label>
          <input className="input text-xs mb-1" placeholder="İsim veya sınıf ara..." value={studentSearch}
            onChange={e => setStudentSearch(e.target.value)} />
          <div className="max-h-36 overflow-y-auto border border-gray-200 rounded-lg bg-white">
            <button onClick={() => { setStudentId(''); setStudentName(''); setStudentCls(''); setStudentSearch(''); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors ${!studentId ? 'bg-emerald-50 text-emerald-700 font-600' : 'text-gray-400 hover:bg-gray-50'}`}
              style={{ fontWeight: !studentId ? 600 : 400 }}>— Açık slot —</button>
            {allowedStudents.filter(s => {
              const q = studentSearch.toLowerCase();
              return !q || s.name.toLowerCase().includes(q) || s.cls.toLowerCase().includes(q);
            }).slice(0, 20).map(s => (
              <button key={s.id} onClick={() => { setStudentId(s.id); setStudentName(s.name); setStudentCls(s.cls); setStudentSearch(''); }}
                className={`w-full text-left px-3 py-2 text-xs transition-colors ${studentId === s.id ? 'bg-emerald-50 text-emerald-700 font-600' : 'hover:bg-gray-50 text-gray-700'}`}
                style={{ fontWeight: studentId === s.id ? 600 : 400 }}>
                <span className="font-600" style={{ fontWeight: 600 }}>{s.name}</span>
                <span className="text-gray-400 ml-1.5">{classLabel(s.cls)}</span>
              </button>
            ))}
          </div>
          {studentId && (
            <label className="flex items-center gap-2 cursor-pointer select-none mt-2">
              <input type="checkbox" checked={fixed} onChange={e => setFixed(e.target.checked)}
                className="w-4 h-4 rounded accent-indigo-600" />
              <span className="text-xs text-gray-700">Sabit rezervasyon (her hafta tekrar)</span>
            </label>
          )}
          {studentId && (
            <button onClick={saveEtut}
              className="mt-2 px-4 py-1.5 rounded-lg text-xs font-600 bg-indigo-600 text-white hover:bg-indigo-700 transition-all"
              style={{ fontWeight: 600 }}>Kaydet</button>
          )}
        </div>
      </div>
    );
  }

  const weekNav = (
    <div className="flex items-center justify-between mb-3 px-1">
      <button
        onClick={() => canPrev && setWeekKey(getAdjacentWeek(weekKey, -1))}
        disabled={!canPrev}
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <div className="text-xs text-gray-700 text-center">
        <div className="font-600" style={{ fontWeight: 600 }}>
          {(() => { const r = weekRangeLabel(weekKey); return `${r.startStr} – ${r.endStr} ${r.yearStr}`; })()}
        </div>
        {weekKey === currentWeek && <div className="text-[10px] text-indigo-500 mt-0.5">Bu hafta</div>}
        {weekKey !== currentWeek && <div className="text-[10px] text-amber-600 mt-0.5">İleri hafta — geçici değişiklikler bu haftaya uygulanır</div>}
      </div>
      <button
        onClick={() => canNext && setWeekKey(getAdjacentWeek(weekKey, 1))}
        disabled={!canNext}
        className={`btn-ghost !p-2 ${!canNext ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronRight size={16} />
      </button>
    </div>
  );

  const offSet = new Set(offDays);
  const visibleDays = ALL_DAYS.filter(d => !offSet.has(d.index));

  const dayHasContent = {};
  for (const day of visibleDays) {
    const dayProg = program?.[String(day.index)] || {};
    dayHasContent[day.index] = Object.values(dayProg).some(e => e && e.type);
  }
  const totalUnits = visibleDays.reduce((sum, d) => sum + (dayHasContent[d.index] ? 3 : 1), 0) || 1;
  const dayWidth = (dayIdx) => `${((dayHasContent[dayIdx] ? 3 : 1) / totalUnits) * 100}%`;

  const offDayBar = (
    <div className="flex flex-wrap items-center gap-1 mb-3 px-1">
      <span className="text-[10px] text-gray-400 mr-1">İzin günleri:</span>
      {ALL_DAYS.map(day => {
        const isOff = offSet.has(day.index);
        const busy = togglingDay === day.index;
        return (
          <button key={day.index}
            onClick={() => !busy && toggleOffDay(day.index)}
            disabled={busy}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${isOff ? 'bg-rose-100 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'} ${busy ? 'opacity-50' : ''}`}
            title={isOff ? 'İzin günü — tıklayarak aç' : 'Tıklayarak izin günü yap'}>
            {day.short} {isOff && '×'}
          </button>
        );
      })}
    </div>
  );

  if (loading) return (
    <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>
      {weekNav}
      {offDayBar}
      <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
    </Modal>
  );

  const weekdayDays = visibleDays.filter(d => !d.weekend);
  const weekendDays = visibleDays.filter(d => d.weekend);
  const hasWeekday = weekdayDays.length > 0;
  const hasWeekend = weekendDays.length > 0;

  return (
    <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>
      {weekNav}
      {offDayBar}
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse table-fixed">
          <thead>
            <tr>
              {hasWeekday && (
                <th className="hiddentext-left py-2 px-2 text-xs text-gray-400 font-600" style={{ fontWeight: 600, width: '72px' }}>Saat</th>
              )}
              {weekdayDays.map(day => (
                <th key={day.index}
                  className="text-center py-2 px-1 text-xs font-600 text-gray-500"
                  style={{ fontWeight: 600, width: dayWidth(day.index) }}>
                  {day.short}
                </th>
              ))}
              {hasWeekday && hasWeekend && (
                <th className="hiddenpx-0" style={{ width: '12px' }}><div className="w-px h-6 bg-gray-200 mx-auto" /></th>
              )}
              {weekendDays.map(day => (
                <th key={day.index}
                  className="text-center py-2 px-1 text-xs font-600 text-indigo-500"
                  style={{ fontWeight: 600, width: dayWidth(day.index) }}>
                  {day.short}
                  <span className="block text-[9px] text-indigo-300">H.sonu</span>
                </th>
              ))}
              {hasWeekend && (
                <th className="hiddentext-right py-2 px-2 text-xs text-indigo-400 font-600" style={{ fontWeight: 600, width: '72px' }}>Saat</th>
              )}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const maxRows = Math.max(hasWeekday ? weekdaySlots.length : 0, hasWeekend ? weekendSlots.length : 0);
              const renderDayCell = (day, rowIdx) => {
                const slots = slotsForDay(day.index, slotTimes);
                const slot = slots[rowIdx];
                if (!slot) return <td key={day.index} className="py-1 px-1"><div className="h-9 rounded bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs flex items-center justify-center">—</div></td>;
                const entry = getEntry(day.index, slot.id);
                const isActive = activeCell?.dayIndex === day.index && activeCell?.slotId === slot.id;
                const type = entry?.type;
                let cellClass = 'h-9 rounded-lg border text-xs font-500 transition-all cursor-pointer flex items-center justify-center px-1 w-full ';
                let cellContent = <span className="text-gray-300 text-[10px]">kapalı</span>;
                if (type === 'available') {
                  cellClass += 'bg-blue-50 border-blue-200 text-blue-600 hover:bg-blue-100';
                  cellContent = <span className="text-[10px] font-600" style={{ fontWeight: 600 }}>Ders</span>;
                } else if (type === 'etut') {
                  if (entry.studentId) {
                    cellClass += 'bg-emerald-50 border-emerald-200 text-emerald-700';
                    cellContent = (
                      <div className="text-center leading-tight">
                        <div className="text-[9px] truncate font-600" style={{ fontWeight: 600 }}>{entry.studentName}</div>
                        <div className="text-[8px] text-violet-500">Sabit</div>
                      </div>
                    );
                  } else {
                    cellClass += 'bg-emerald-50 border-dashed border-emerald-300 text-emerald-500';
                    cellContent = <span className="text-[10px]">Etüt</span>;
                  }
                } else {
                  cellClass += 'bg-white border-dashed border-gray-200 hover:border-blue-300 hover:bg-blue-50/40';
                }
                const slotIsPast = isSlotPast(weekKey, day.index, slot.label);
                const blockPast = slotIsPast && type === 'etut';
                if (isActive) cellClass += ' ring-2 ring-indigo-400';
                if (blockPast) cellClass += ' opacity-70 !cursor-not-allowed';
                return (
                  <td key={day.index} className="py-0.5 px-0.5">
                    <div className="relative">
                      <button className={cellClass}
                        disabled={blockPast}
                        title={blockPast ? 'Bu saat dilimi geçmiş — düzenlenemez' : (type ? 'Tıkla: seçenekler' : 'Tıkla: ders saati aç')}
                        onClick={() => !blockPast && handleSlotClick(day.index, slot.id)}>
                        {cellContent}
                      </button>
                      {type && !slotIsPast && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            clearEntry(day.index, slot.id);
                            if (isActive) setActiveCell(null);
                          }}
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-sm transition-colors z-10"
                          title="Slotu kapat"
                        >
                          <X size={9} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                  </td>
                );
              };
              return Array.from({ length: maxRows }, (_, rowIdx) => (
                <tr key={rowIdx} className="border-t border-gray-50">
                  {hasWeekday && (
                    <td className="hiddenpy-1 px-2 text-[10px] text-gray-400 whitespace-nowrap text-left">
                      {weekdaySlots[rowIdx]?.label || ''}
                    </td>
                  )}
                  {weekdayDays.map(day => renderDayCell(day, rowIdx))}
                  {hasWeekday && hasWeekend && (
                    <td className="hiddenpx-0"><div className="w-px h-9 bg-gray-200 mx-auto" /></td>
                  )}
                  {weekendDays.map(day => renderDayCell(day, rowIdx))}
                  {hasWeekend && (
                    <td className="hiddenpy-1 px-2 text-[10px] text-indigo-400 whitespace-nowrap text-right">
                      {weekendSlots[rowIdx]?.label || ''}
                    </td>
                  )}
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>

      {activeCell && (getEntry(activeCell.dayIndex, activeCell.slotId)?.type === 'available' || getEntry(activeCell.dayIndex, activeCell.slotId)?.type === 'etut') && (
        <EtutPanel dayIndex={activeCell.dayIndex} slotId={activeCell.slotId} />
      )}

      <div className="flex gap-3 mt-4">
        <button className="btn-primary flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Kaydediliyor...' : 'Kaydet ve Uygula'}
        </button>
        <button className="btn-ghost" onClick={onClose}>İptal</button>
      </div>
    </Modal>
  );
}

// ─── MAIN DIRECTOR PANEL ────────────────────────────────────────────────────────
export default function DirectorPanel({ session, showToast }) {
  const [tab, setTab] = useState('teachers');
  const [showProgramOlusturucuModal, setShowProgramOlusturucuModal] = useState(false);
  const [showDenemelerModal, setShowDenemelerModal] = useState(false);
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
        {[['teachers','Öğretmenler'],['students','Rehberlik'],['yoklama','Yoklama'],['muhasebe','💰 Muhasebe']].map(([key,label]) => (
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
                      <button className="btn-ghost !px-3 !py-2 text-amber-500 hover:bg-amber-50" title="Şifre sıfırla" onClick={() => setResetTarget({ id: t.id, name: t.name, role: 'teacher' })}><KeyRound size={14} /></button>
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
            onReset={s => setResetTarget({ id: s.id, name: s.name, role: 'student' })}
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
      {resetTarget && (
        <ResetPasswordModal target={resetTarget} targetRole={resetTarget.role} onClose={() => setResetTarget(null)} showToast={showToast} />
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
          <DirectorDenemeYonetimi showToast={showToast} />
        </Modal>
      )}
    </div>
  );
}

export function DirectorSettingsModal({ current, onClose, onSave, showToast }) {
  const [name, setName] = useState(current || '');
  const [savingName, setSavingName] = useState(false);

  const [weekday, setWeekday] = useState([]);
  const [weekend, setWeekend] = useState([]);
  const [timesLoading, setTimesLoading] = useState(true);
  const [savingTimes, setSavingTimes] = useState(false);

  const { updateSlotTimes } = useSlotTimes();

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/slot-times');
        setWeekday(data.weekday || []);
        setWeekend(data.weekend || []);
      } catch (e) { showToast(e.message, 'error'); }
      setTimesLoading(false);
    })();
  }, []);

  const submitName = async e => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'update_director_name', name: name.trim() }) });
      onSave(name.trim());
      showToast('İsim güncellendi');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSavingName(false); }
  };

  const TIME_OPTIONS = useMemo(() => {
    const out = [];
    for (let h = 9; h <= 19; h++) {
      for (let m = 0; m < 60; m += 5) {
        if (h === 19 && m > 20) break;
        out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return out;
  }, []);

  function toMin(t) {
    const [h, m] = t.split(':').map(n => parseInt(n));
    return h * 60 + m;
  }

  function updateSlot(arr, setArr, i, field, value) {
    const next = arr.map((s, idx) => idx === i ? { ...s, [field]: value } : s);
    for (let j = i + 1; j < next.length; j++) {
      if (toMin(next[j].start || '00:00') < toMin(next[j - 1].end || '00:00')) {
        next[j] = { start: '', end: '' };
      }
    }
    setArr(next);
  }

  function renderRow(arr, setArr, i) {
    const s = arr[i];
    const prevEnd = i > 0 ? arr[i - 1].end : null;
    const startOptions = TIME_OPTIONS.filter(t => !prevEnd || toMin(t) >= toMin(prevEnd));
    const endOptions = s.start ? TIME_OPTIONS.filter(t => toMin(t) > toMin(s.start)) : [];
    return (
      <tr key={i} className="border-t border-gray-50">
        <td className="py-1 px-2 text-xs text-gray-400 w-10">{i + 1}.</td>
        <td className="py-1 px-1">
          <select value={s.start || ''} onChange={e => updateSlot(arr, setArr, i, 'start', e.target.value)}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white">
            <option value="">—</option>
            {startOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
        <td className="py-1 px-1 text-xs text-gray-400 text-center">–</td>
        <td className="py-1 px-1">
          <select value={s.end || ''} onChange={e => updateSlot(arr, setArr, i, 'end', e.target.value)}
            disabled={!s.start}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-300">
            <option value="">—</option>
            {endOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
      </tr>
    );
  }

  async function saveTimes() {
    for (const arr of [weekday, weekend]) {
      for (const s of arr) {
        if (!s.start || !s.end) {
          showToast('Tüm saat alanlarını doldurun', 'error');
          return;
        }
      }
    }
    setSavingTimes(true);
    try {
      await api('/api/slot-times', { method: 'POST', body: JSON.stringify({ weekday, weekend }) });
      updateSlotTimes({ weekday, weekend });
      showToast('Saatler kaydedildi ve uygulandı');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSavingTimes(false);
    }
  }

  return (
    <Modal title="Ayarlar" onClose={onClose} wide>
      <div className="mb-5 pb-5 border-b border-gray-100">
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Müdür Bilgisi</h4>
        <form onSubmit={submitName} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-600 text-gray-400 uppercase tracking-wide mb-1" style={{ fontWeight: 600 }}>Ad Soyad</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary !px-4 !py-2 text-sm" disabled={savingName}>
            {savingName ? 'Kaydediliyor…' : 'Güncelle'}
          </button>
        </form>
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Ders Saatleri</h4>
        {timesLoading ? (
          <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-600 text-gray-500 uppercase mb-1.5" style={{ fontWeight: 600 }}>Hafta İçi</div>
                <table className="w-full text-sm">
                  <tbody>{weekday.map((_, i) => renderRow(weekday, setWeekday, i))}</tbody>
                </table>
              </div>
              <div>
                <div className="text-[11px] font-600 text-gray-500 uppercase mb-1.5" style={{ fontWeight: 600 }}>Hafta Sonu</div>
                <table className="w-full text-sm">
                  <tbody>{weekend.map((_, i) => renderRow(weekend, setWeekend, i))}</tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button className="btn-primary !px-4 !py-2 text-sm" onClick={saveTimes} disabled={savingTimes}>
                {savingTimes ? 'Kaydediliyor…' : 'Saatleri Kaydet'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <AuditLogSection showToast={showToast} />
      </div>

      <PushTestSection showToast={showToast} />
    </Modal>
  );
}

// ─── BİLDİRİM TESTİ ─────────────────────────────────────────────────────────────
function PushTestSection({ showToast }) {
  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    setSending(true);
    try {
      const r = await api('/api/push', { method: 'POST', body: JSON.stringify({ action: 'test' }) });
      if (r.sent > 0) showToast(`Test bildirimi gönderildi (${r.sent} cihaz)`);
      else showToast('Kayıtlı cihaz yok — önce üstteki zil simgesinden bildirimleri aç', 'info');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSending(false); }
  };

  return (
    <div>
      <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Bildirim Testi</h4>
      <p className="text-xs text-gray-500 mb-2">Üstteki zil simgesinden bildirimleri açtıktan sonra kendine test bildirimi gönder.</p>
      <button onClick={sendTest} disabled={sending} className="btn-ghost !px-4 !py-2 text-sm">
        {sending ? 'Gönderiliyor…' : 'Kendime test bildirimi gönder'}
      </button>
    </div>
  );
}

// ─── DENETİM KAYITLARI (AUDIT LOG) ──────────────────────────────────────────────
function AuditLogSection({ showToast }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);

  const ACTION_LABELS = {
    'student.delete': { label: 'Öğrenci silindi', color: '#dc2626' },
    'student.bulkDelete': { label: 'Toplu öğrenci silme', color: '#dc2626' },
    'teacher.delete': { label: 'Öğretmen silindi', color: '#dc2626' },
    'accountant.delete': { label: 'Muhasebeci silindi', color: '#dc2626' },
    'finance.payment': { label: 'Ödeme alındı', color: '#16a34a' },
    'finance.paymentDelete': { label: 'Ödeme silindi', color: '#ea580c' },
    'finance.create': { label: 'Finansal kayıt', color: '#6366f1' },
    'finance.update': { label: 'Finansal güncelleme', color: '#6366f1' },
    'finance.delete': { label: 'Finansal kayıt silindi', color: '#dc2626' },
    'auth.resetPassword': { label: 'Şifre sıfırlandı', color: '#d97706' },
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/audit');
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) { showToast(e.message, 'error'); setEntries([]); }
    finally { setLoading(false); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && entries === null) load();
  };

  const fmtTime = (iso) => {
    try {
      const d = new Date(iso);
      const tr = new Date(d.getTime() + 3 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(tr.getUTCDate())}.${pad(tr.getUTCMonth() + 1)}.${tr.getUTCFullYear()} ${pad(tr.getUTCHours())}:${pad(tr.getUTCMinutes())}`;
    } catch { return iso; }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide" style={{ fontWeight: 700 }}>İşlem Kayıtları</h4>
        <button onClick={toggle} className="btn-ghost !px-3 !py-1.5 text-xs flex items-center gap-1.5">
          <Clock size={13} /> {open ? 'Gizle' : 'Göster'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          {loading ? (
            <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">Henüz kayıt yok</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {entries.map((e, i) => {
                const meta = ACTION_LABELS[e.action] || { label: e.action, color: '#6b7280' };
                return (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-700">{e.detail || meta.label}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {fmtTime(e.ts)} · {e.actorName} ({e.actorRole === 'director' ? 'Müdür' : e.actorRole === 'accountant' ? 'Muhasebeci' : e.actorRole})
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Son 500 kayıt gösterilir · kayıtlar 90 gün saklanır</p>
        </div>
      )}
    </div>
  );
}
