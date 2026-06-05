'use client';

// "Sabit Dersler (Ön Eşleştirme)" — öğretmen detay sayfasında gösterilir.
// Müdür "bu öğretmen şu sınıfın şu dersini sabit versin" der → teacher.presets'e yazılır.
// CP-SAT bunu HARD preset olarak alır; GÜN/SAATİ solver seçer (slot serbest).
// Veri öğretmen kaydında: presets: [{ cls, course }].
import React, { useState, useMemo } from 'react';
import { Lock, Plus, Save, X } from 'lucide-react';
import {
  ALL_CLASSES, COL_COURSES, colKeyForClass, classToGroup, classLabel,
} from '@/lib/constants';
import { api } from './shared';

// Öğretmenin girebileceği gruplar (boşsa hepsi).
function teacherGroups(t) {
  const ag = t.allowedGroups || [];
  return ag.length > 0 ? ag : ['ortaokul', 'lise', 'mezun'];
}

// Bir öğretmen için seçilebilir sınıf → o sınıfta verebileceği dersler.
// dersler = sınıfın ders sütunu ∩ öğretmenin branşları.
function eligibleMap(t) {
  const groups = teacherGroups(t);
  const branches = new Set(t.branches || []);
  const map = {}; // cls -> [course, ...]
  for (const cls of ALL_CLASSES) {
    if (!groups.includes(classToGroup(cls))) continue;
    const courses = (COL_COURSES[colKeyForClass(cls)] || []).filter(c => branches.has(c));
    if (courses.length) map[cls] = courses;
  }
  return map;
}

export default function TeacherPresets({ teacher, onSaved, showToast }) {
  const [presets, setPresets] = useState(() =>
    Array.isArray(teacher.presets) ? teacher.presets.map(p => ({ cls: p.cls, course: p.course })) : []
  );
  const [selCls, setSelCls] = useState('');
  const [selCourse, setSelCourse] = useState('');
  const [saving, setSaving] = useState(false);

  const elig = useMemo(() => eligibleMap(teacher), [teacher]);
  const eligClasses = useMemo(() => Object.keys(elig).sort(), [elig]);

  // Seçili sınıfın dersleri; tek ders varsa otomatik seçilir (kullanıcı seçmez).
  const coursesForSel = selCls ? (elig[selCls] || []) : [];
  const autoCourse = coursesForSel.length === 1 ? coursesForSel[0] : '';
  const effCourse = autoCourse || selCourse;

  const canAdd = selCls && effCourse;

  function add() {
    if (!canAdd) return;
    setPresets(prev => {
      // Aynı sınıf zaten varsa dersini güncelle (üzerine yaz), yoksa ekle.
      const filtered = prev.filter(p => p.cls !== selCls);
      return [...filtered, { cls: selCls, course: effCourse }];
    });
    setSelCls('');
    setSelCourse('');
  }

  function remove(i) {
    setPresets(prev => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await api('/api/teachers', {
        method: 'PUT',
        body: JSON.stringify({ action: 'set_presets', id: teacher.id, presets }),
      });
      // Sunucu geçersizleri eleyip döndürebilir → dönen listeyle senkronla.
      const saved = Array.isArray(res?.presets) ? res.presets : presets;
      setPresets(saved.map(p => ({ cls: p.cls, course: p.course })));
      showToast('Sabit dersler kaydedildi');
      onSaved?.(saved);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  }

  const noBranches = !(teacher.branches || []).length;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Lock size={15} style={{ color: 'var(--text-muted)' }} />
        <div>
          <h4 className="font-600 text-sm" style={{ fontWeight: 600 }}>Sabit Dersler (Ön Eşleştirme)</h4>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Seçtiğiniz sınıf-dersler bu öğretmene kilitlenir; program oluşturulurken çözücü mutlaka uyar (saati çözücü seçer).
          </p>
        </div>
      </div>

      {noBranches ? (
        <p className="text-xs text-amber-600">Bu öğretmenin branşı yok — önce Düzenle'den branş ekleyin.</p>
      ) : eligClasses.length === 0 ? (
        <p className="text-xs text-amber-600">Branş ve grup eşleşmesine uygun sınıf yok.</p>
      ) : (
        <div className="flex gap-2 flex-wrap items-end">
          <div>
            <label className="text-label block mb-1">Sınıf</label>
            <select className="input !w-auto text-sm" value={selCls}
              onChange={e => { setSelCls(e.target.value); setSelCourse(''); }}>
              <option value="">Seç</option>
              {eligClasses.map(c => <option key={c} value={c}>{classLabel(c)}</option>)}
            </select>
          </div>
          {/* Ders seçimi: yalnız sınıfta birden çok uygun ders varsa göster (tekse otomatik). */}
          {selCls && coursesForSel.length > 1 && (
            <div>
              <label className="text-label block mb-1">Ders</label>
              <select className="input !w-auto text-sm" value={selCourse}
                onChange={e => setSelCourse(e.target.value)}>
                <option value="">Seç</option>
                {coursesForSel.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}
          {selCls && coursesForSel.length === 1 && (
            <div>
              <label className="text-label block mb-1">Ders</label>
              <div className="input !w-auto text-sm flex items-center" style={{ color: 'var(--text-secondary)' }}>{autoCourse}</div>
            </div>
          )}
          <button onClick={add} disabled={!canAdd}
            className="btn-primary !px-3 !py-2 text-sm flex items-center gap-1.5 disabled:opacity-50">
            <Plus size={14} /> Ekle
          </button>
        </div>
      )}

      {presets.length > 0 && (
        <div className="space-y-1.5">
          {presets.map((p, i) => (
            <div key={`${p.cls}-${i}`} className="flex items-center justify-between text-sm rounded-lg px-3 py-2"
              style={{ background: 'var(--bg-muted)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
                <b style={{ color: 'var(--text-primary)' }}>{classLabel(p.cls)}</b> → {p.course}
              </span>
              <button onClick={() => remove(i)} className="p-1 rounded hover:bg-red-100 text-gray-400 hover:text-red-500" title="Kaldır">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={save} disabled={saving}
          className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5">
          <Save size={14} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}
