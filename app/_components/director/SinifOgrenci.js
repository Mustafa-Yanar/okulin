'use client';

// "Sınıf / Öğrenci" — eski "Sınıflar" (ClassManager) + eski "Rehberlik" (StudentList) birleşik sekme.
// Omurga = şubeler (registry /api/classes); her şube kartı akordeon → açılınca o şubenin öğrencileri.
// Öğrenciye tıklayınca bireysel takip (rehberlik/devamsızlık/etüt) açılır — özellik kaybı yok.
// Şube CRUD + ders kataloğu ClassManager'dan; öğrenci detay + ders programı modalı StudentList'ten.

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, Trash2, Edit3, Calendar, GraduationCap, BookOpen, ChevronRight, ChevronLeft,
} from 'lucide-react';
import { classLabel } from '@/lib/constants';
import { classLabelFrom } from '@/lib/classCatalog';
import { api } from './shared';
import { StudentExpandedView, ClassScheduleModal } from './StudentList';
import { ClassFormModal, CourseCatalog, KADEME_LABEL, KADEME_ORDER, DAL_LABEL } from './ClassManager';
import LoadingBox from '../Loading';
import EmptyState from '../EmptyState';
import { useUrlParam } from '../useUrlParam';
import { useConfirm } from '../ConfirmProvider';

export default function SinifOgrenci({
  students = [], allSlots, weekKey,
  onCancelBooking, onEditStudent, onDeleteStudent, onHistory,
  pendingGuidance = {}, onGuidanceReviewed, onSelectChange,
  onAddStudent, onAddCounselor, isCounselor = false,
  onClassesChanged, showToast, sektor = 'dershane', classes: classesProp = [],
}) {
  const confirm = useConfirm();
  const [classes, setClasses] = useState(classesProp);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // list | catalog
  const [editClass, setEditClass] = useState(null); // {} = yeni, kayıt = düzenle
  const [scheduleCls, setScheduleCls] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [openClsId, setOpenClsId] = useState(null);
  const [expandedId, setExpandedId] = useUrlParam('ogrenci');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/classes');
      setClasses(data.classes || []);
      setCourses(data.courses || []);
    } catch (err) { showToast?.(err.message, 'error'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Detay açık/kapalı durumunu dışarı bildir (gerekirse liste başlığını gizleme vb.).
  useEffect(() => { onSelectChange?.(expandedId); }, [expandedId, onSelectChange]);

  const activeCourses = courses.filter((c) => c.active !== false);

  // class.id → o şubedeki öğrenciler (ada göre sıralı)
  const studentsByClass = useMemo(() => {
    const m = {};
    for (const s of students) (m[s.cls] ||= []).push(s);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
    return m;
  }, [students]);

  // Kademeye göre grupla (sıralı), her kademe içinde şube adına göre.
  const byKademe = useMemo(() => {
    const m = {};
    for (const c of classes) (m[c.kademe || 'ortaokul'] ||= []).push(c);
    for (const k of Object.keys(m)) m[k].sort((a, b) => (a.ad || '').localeCompare(b.ad || '', 'tr'));
    return m;
  }, [classes]);
  const kademeKeys = KADEME_ORDER.filter((k) => byKademe[k]?.length);

  // Arama doluyken: şube akordeonu yerine düz öğrenci listesi (eski StudentList UX'i).
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return null;
    return students
      .filter((s) =>
        s.name?.toLowerCase().includes(q) ||
        s.cls?.toLowerCase().includes(q) ||
        s.username?.toLowerCase().includes(q) ||
        classLabelFrom(classes, s.cls, classLabel).toLowerCase().includes(q))
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  }, [searchQ, students, classes]);

  async function handleDeleteClass(c) {
    const inClass = studentsByClass[c.id] || [];
    if (inClass.length > 0) {
      if (!(await confirm(`"${c.ad}" şubesinde ${inClass.length} öğrenci var. Şube ve tüm öğrencileri silinsin mi?`))) return;
    } else if (!(await confirm(`"${c.ad}" şubesi silinsin mi?`))) return;
    setBusy(true);
    try {
      if (inClass.length > 0) {
        await api('/api/students', { method: 'DELETE', body: JSON.stringify({ ids: inClass.map((s) => s.id) }) });
      }
      await api('/api/classes', { method: 'DELETE', body: JSON.stringify({ id: c.id }) });
      showToast?.('Şube silindi');
      await load();
      onClassesChanged?.();
    } catch (err) { showToast?.(err.message, 'error'); }
    finally { setBusy(false); }
  }

  // ── Öğrenci detay sayfası (seçili öğrenci) ──
  const selected = expandedId ? students.find((x) => x.id === expandedId) : null;
  if (expandedId && selected) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <button onClick={() => setExpandedId(null)}
            className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5">
            <ChevronLeft size={16} /> Geri
          </button>
          <div className="flex gap-2 shrink-0">
            <button className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5" onClick={() => onEditStudent?.(selected)}>
              <Edit3 size={14} /> Düzenle
            </button>
            <button className="btn-ghost !px-3 !py-2 text-sm text-red-500 hover:bg-red-50 flex items-center gap-1.5"
              onClick={() => { onDeleteStudent?.(selected); setExpandedId(null); }}>
              <Trash2 size={14} /> Sil
            </button>
          </div>
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white text-sm font-700"
              style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', fontWeight: 700 }}>
              {selected.name.slice(0, 2).toUpperCase()}
            </div>
            <div>
              <h3 className="font-700 text-base" style={{ fontWeight: 700 }}>{selected.name}</h3>
              <p className="text-caption">{classLabelFrom(classes, selected.cls, classLabel)}</p>
            </div>
          </div>
          <StudentExpandedView student={selected} allSlots={allSlots} onCancelBooking={onCancelBooking} onGuidanceReviewed={onGuidanceReviewed} />
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Başlık + aksiyonlar */}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
          Sınıf / Öğrenci
          <span className="font-500 opacity-60 ml-1.5 text-sm" style={{ fontWeight: 500 }}>
            ({classes.length} şube · {students.length} öğrenci)
          </span>
        </h3>
        <div className="flex gap-2 flex-wrap">
          <button className={`btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5 ${view === 'catalog' ? 'is-active' : ''}`}
            onClick={() => setView(view === 'catalog' ? 'list' : 'catalog')}>
            <BookOpen size={14} /> Ders Kataloğu
          </button>
          <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={() => onAddStudent?.()}>
            <Plus size={14} /> Öğrenci Ekle
          </button>
          <button className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5 border" style={{ borderColor: 'var(--border-subtle)' }}
            onClick={() => setEditClass({})}>
            <Plus size={14} /> Yeni Şube
          </button>
          {!isCounselor && (
            <button className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5 border" style={{ borderColor: 'var(--border-subtle)' }}
              onClick={() => onAddCounselor?.()}>
              <Plus size={14} /> Rehberlik Öğretmeni
            </button>
          )}
        </div>
      </div>

      {loading ? <LoadingBox /> : view === 'catalog' ? (
        <div>
          <button onClick={() => setView('list')} className="btn-ghost !px-3 !py-2 text-sm flex items-center gap-1.5 mb-3">
            <ChevronLeft size={16} /> Şubeler
          </button>
          <CourseCatalog courses={courses} showToast={showToast}
            onChanged={async () => { await load(); onClassesChanged?.(); }} />
        </div>
      ) : (
        <>
          <div className="mb-4">
            <input className="input text-sm" placeholder="İsim, sınıf, kullanıcı adı ara…"
              aria-label="Öğrenci/sınıf ara" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
          </div>

          {/* Arama sonucu: düz öğrenci listesi */}
          {searchResults ? (
            <div className="grid gap-1.5">
              {searchResults.length === 0 ? (
                <div className="card p-8 text-center text-gray-400">
                  <GraduationCap size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-caption">Aramanızla eşleşen öğrenci yok</p>
                </div>
              ) : searchResults.map((s) => (
                <StudentRow key={s.id} s={s} subtitle={classLabelFrom(classes, s.cls, classLabel)}
                  pending={pendingGuidance?.[s.id]} onClick={() => setExpandedId(s.id)} />
              ))}
            </div>
          ) : classes.length === 0 ? (
            <EmptyState card icon={GraduationCap} title="Henüz şube yok"
              description="“Yeni Şube” ile ilk şubeyi ekleyin." />
          ) : (
            <div className="space-y-5">
              {kademeKeys.map((kademe) => (
                <div key={kademe}>
                  <p className="text-[11px] uppercase tracking-widest mb-2"
                    style={{ fontWeight: 700, color: 'var(--text-muted)' }}>
                    {KADEME_LABEL[kademe] || kademe}
                  </p>
                  <div className="grid gap-2">
                    {byKademe[kademe].map((c) => (
                      <ClassRow key={c.id} c={c} courses={courses}
                        students={studentsByClass[c.id] || []}
                        isOpen={openClsId === c.id}
                        onToggle={() => setOpenClsId((prev) => (prev === c.id ? null : c.id))}
                        onEdit={() => setEditClass(c)}
                        onSchedule={() => setScheduleCls({ cls: c.id, label: c.ad })}
                        onDelete={() => handleDeleteClass(c)}
                        onSelectStudent={setExpandedId}
                        pendingGuidance={pendingGuidance}
                        busy={busy} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {editClass && (
        <ClassFormModal
          initial={editClass}
          courses={activeCourses}
          sektor={sektor}
          onClose={() => setEditClass(null)}
          onSaved={async () => { setEditClass(null); await load(); onClassesChanged?.(); }}
          showToast={showToast}
        />
      )}
      {scheduleCls && (
        <ClassScheduleModal cls={scheduleCls.cls} label={scheduleCls.label} onClose={() => setScheduleCls(null)} />
      )}
    </div>
  );
}

// ─── Şube satırı (akordeon: başlık + 3 buton + açılınca öğrenciler) ───────────────────
function ClassRow({ c, courses, students, isOpen, onToggle, onEdit, onSchedule, onDelete, onSelectStudent, pendingGuidance, busy }) {
  const courseLabel = (key) => courses.find((x) => x.key === key)?.ad || key;
  const dersler = c.dersler || [];
  const meta = [c.duzey && `${c.duzey}. sınıf`, c.dal && DAL_LABEL[c.dal]].filter(Boolean).join(' · ');
  return (
    <div className="card-elevated overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-3">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight size={16} className="shrink-0" style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          <div className="min-w-0">
            <p className="truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
              {c.ad} <span className="font-500 opacity-60" style={{ fontWeight: 500 }}>({students.length} öğrenci)</span>
            </p>
            {meta && <p className="text-caption">{meta}</p>}
          </div>
        </button>
        <div className="flex gap-1 shrink-0">
          <button className="btn-icon" onClick={onEdit} aria-label="Şubeyi düzenle" title="Düzenle" disabled={busy}><Edit3 size={14} /></button>
          <button className="btn-icon" onClick={onSchedule} aria-label="Ders programı" title="Ders Programı"><Calendar size={14} /></button>
          <button className="btn-icon btn-icon-danger" onClick={onDelete} aria-label="Şubeyi sil" title="Sil" disabled={busy}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="px-3.5 pb-2.5 flex flex-wrap gap-1">
        {dersler.length === 0 ? (
          <span className="text-caption" style={{ color: 'var(--text-muted)' }}>Ders atanmadı</span>
        ) : dersler.slice(0, 8).map((k) => (
          <span key={k} className="badge-info text-[11px]">{courseLabel(k)}</span>
        ))}
        {dersler.length > 8 && <span className="text-caption">+{dersler.length - 8}</span>}
      </div>
      {isOpen && (
        <div className="px-3 pb-3 pt-2 grid gap-1.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {students.length === 0 ? (
            <p className="text-caption px-1 py-1">Bu şubede öğrenci yok.</p>
          ) : students.map((s) => (
            <StudentRow key={s.id} s={s} pending={pendingGuidance?.[s.id]} onClick={() => onSelectStudent(s.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Öğrenci satırı (kart) ─────────────────────────────────────────────────────────
function StudentRow({ s, subtitle, pending, onClick }) {
  return (
    <button onClick={onClick}
      className="card card-interactive overflow-hidden text-sm w-full flex items-center gap-3 px-3 py-2.5 text-left">
      <div className="relative shrink-0">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-xs font-700"
          style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', fontWeight: 700 }}>
          {s.name.slice(0, 2).toUpperCase()}
        </div>
        {pending > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-700 flex items-center justify-center" style={{ fontWeight: 700 }}>
            {pending}
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-600 truncate" style={{ fontWeight: 600 }}>{s.name}</div>
        {subtitle ? <div className="text-caption truncate">{subtitle}</div>
          : s.username && <div className="text-caption truncate">@{s.username}</div>}
      </div>
      <ChevronRight size={14} className="text-gray-400 shrink-0" />
    </button>
  );
}
