'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Edit3, GraduationCap, BookOpen, Check, X as XIcon, Layers,
} from 'lucide-react';
import { api, Modal, FormField } from './shared';
import { KADEMELER, kademelerForSektor } from '@/lib/institution';
import LoadingBox from '../Loading';
import EmptyState from '../EmptyState';

// Şube (sınıf) + ders kataloğu yönetimi. Kurum kendi şubelerini açar/düzenler/siler ve
// ders kataloğunu (çekirdek + kendi eklediği) yönetir; her şubeye gördüğü dersleri atar.
// Veri: GET/POST/PATCH/DELETE /api/classes + /api/courses. Detay: hafıza kurum-turu-sinif-modeli.

export const KADEME_LABEL = Object.fromEntries(KADEMELER.map((k) => [k.key, k.label]));
export const KADEME_ORDER = ['ilkokul', 'ortaokul', 'lise', 'mezun'];

const DAL_OPTIONS = [
  { key: '', label: '— (dalsız)' },
  { key: 'sayisal', label: 'Sayısal' },
  { key: 'ea', label: 'Eşit Ağırlık' },
  { key: 'sozel', label: 'Sözel' },
  { key: 'dil', label: 'Dil' },
];
export const DAL_LABEL = { sayisal: 'Sayısal', ea: 'Eşit Ağırlık', sozel: 'Sözel', dil: 'Dil' };

// Kademeye göre düzey seçenekleri (UI yardımcısı; mezunda düzey yok).
function duzeylerFor(kademe) {
  if (kademe === 'ilkokul') return ['1', '2', '3', '4'];
  if (kademe === 'ortaokul') return ['5', '6', '7', '8'];
  if (kademe === 'lise') return ['9', '10', '11', '12'];
  return [];
}
// Dal seçimi yalnız lise 11/12 ve mezunda anlamlı.
function dalRelevant(kademe, duzey) {
  if (kademe === 'mezun') return true;
  if (kademe === 'lise' && (duzey === '11' || duzey === '12')) return true;
  return false;
}

export default function ClassManager({ showToast, sektor = 'dershane' }) {
  const [view, setView] = useState('subeler'); // subeler | dersler
  const [classes, setClasses] = useState([]);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editClass, setEditClass] = useState(null); // {} = yeni, kayıt = düzenle
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/api/classes');
      setClasses(data.classes || []);
      setCourses(data.courses || []);
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Kademeye göre grupla (sıralı).
  const byKademe = {};
  for (const c of classes) {
    const k = c.kademe || 'ortaokul';
    (byKademe[k] ||= []).push(c);
  }
  const kademeKeys = KADEME_ORDER.filter((k) => byKademe[k]?.length);

  const activeCourses = courses.filter((c) => c.active !== false);

  async function deleteClass(c) {
    if (!confirm(`"${c.ad}" şubesi silinsin mi?`)) return;
    setBusy(true);
    try {
      await api('/api/classes', { method: 'DELETE', body: JSON.stringify({ id: c.id }) });
      showToast?.('Şube silindi');
      await load();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Alt sekmeler */}
      <div className="pill-tabs mb-4">
        {[['subeler', 'Şubeler', Layers], ['dersler', 'Ders Kataloğu', BookOpen]].map(([k, l, Icon]) => (
          <button key={k} onClick={() => setView(k)}
            className={`pill-tab press-effect${view === k ? ' is-active' : ''}`}>
            <Icon size={13} /> <span>{l}</span>
          </button>
        ))}
      </div>

      {loading ? <LoadingBox /> : view === 'subeler' ? (
        <div>
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="text-lg" style={{ fontWeight: 700 }}>Şubeler ({classes.length})</h3>
            <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm"
              onClick={() => setEditClass({})}>
              <Plus size={14} /> Şube Ekle
            </button>
          </div>

          {classes.length === 0 ? (
            <EmptyState icon={GraduationCap} title="Henüz şube yok"
              description="İlk şubeyi eklemek için “Şube Ekle”ye tıklayın." />
          ) : (
            <div className="space-y-5">
              {kademeKeys.map((kademe) => (
                <div key={kademe}>
                  <p className="text-[11px] uppercase tracking-widest mb-2"
                    style={{ fontWeight: 700, color: 'var(--text-muted)' }}>
                    {KADEME_LABEL[kademe] || kademe}
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {byKademe[kademe].map((c) => (
                      <ClassCard key={c.id} c={c} courses={courses}
                        onEdit={() => setEditClass(c)} onDelete={() => deleteClass(c)} busy={busy} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <CourseCatalog courses={courses} onChanged={load} showToast={showToast} />
      )}

      {editClass && (
        <ClassFormModal
          initial={editClass}
          courses={activeCourses}
          sektor={sektor}
          onClose={() => setEditClass(null)}
          onSaved={async () => { setEditClass(null); await load(); }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// ─── Şube kartı ──────────────────────────────────────────────────────────────────
function ClassCard({ c, courses, onEdit, onDelete, busy }) {
  const courseLabel = (key) => courses.find((x) => x.key === key)?.ad || key;
  const dersler = c.dersler || [];
  const meta = [c.duzey && `${c.duzey}. sınıf`, c.dal && DAL_LABEL[c.dal]].filter(Boolean).join(' · ');
  return (
    <div className="card-elevated p-3.5 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.ad}</p>
          {meta && <p className="text-caption">{meta}</p>}
        </div>
        <div className="flex gap-1 shrink-0">
          <button className="btn-icon" onClick={onEdit} aria-label="Düzenle" disabled={busy}><Edit3 size={14} /></button>
          <button className="btn-icon" onClick={onDelete} aria-label="Sil" disabled={busy}><Trash2 size={14} /></button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {dersler.length === 0 ? (
          <span className="text-caption" style={{ color: 'var(--text-muted)' }}>Ders atanmadı</span>
        ) : dersler.slice(0, 8).map((k) => (
          <span key={k} className="badge-info text-[11px]">{courseLabel(k)}</span>
        ))}
        {dersler.length > 8 && <span className="text-caption">+{dersler.length - 8}</span>}
      </div>
    </div>
  );
}

// ─── Şube ekle/düzenle modalı ─────────────────────────────────────────────────────
export function ClassFormModal({ initial, courses, sektor, onClose, onSaved, showToast }) {
  const isEdit = !!initial.id;
  const [ad, setAd] = useState(initial.ad || '');
  const [kademe, setKademe] = useState(initial.kademe || kademelerForSektor(sektor)[0]);
  const [duzey, setDuzey] = useState(initial.duzey || '');
  const [dal, setDal] = useState(initial.dal || '');
  // Düzenlemede şubenin mevcut dersleri seçili gelir; yenide boş (server şablondan prefill eder).
  const [dersler, setDersler] = useState(initial.dersler || null); // null = dokunulmadı
  const [saving, setSaving] = useState(false);

  const allowedKademeler = kademelerForSektor(sektor);
  const duzeyOptions = duzeylerFor(kademe);
  const showDal = dalRelevant(kademe, duzey);

  function toggleDers(key) {
    setDersler((prev) => {
      const cur = prev || [];
      return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
    });
  }

  async function save() {
    if (!ad.trim()) { showToast?.('Şube adı gir', 'error'); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api('/api/classes', {
          method: 'PATCH',
          body: JSON.stringify({
            id: initial.id, ad: ad.trim(),
            dal: showDal ? (dal || null) : null,
            ...(dersler !== null ? { dersler } : {}),
          }),
        });
        showToast?.('Şube güncellendi');
      } else {
        await api('/api/classes', {
          method: 'POST',
          body: JSON.stringify({
            ad: ad.trim(), kademe,
            duzey: duzey || undefined,
            dal: showDal ? (dal || null) : null,
            ...(dersler !== null ? { dersler } : {}),
          }),
        });
        showToast?.('Şube eklendi');
      }
      await onSaved();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally { setSaving(false); }
  }

  // Düzenlemede tüm katalog görünür (atama); yenide de aynı — kullanıcı isterse şimdiden seçer.
  const selected = dersler || [];

  return (
    <Modal title={isEdit ? 'Şubeyi Düzenle' : 'Yeni Şube'} onClose={onClose}>
      <div className="space-y-1">
        <FormField label="Şube adı">
          <input className="input" value={ad} onChange={(e) => setAd(e.target.value)}
            placeholder="örn. 8-A, 801, Einstein" autoFocus />
        </FormField>

        {!isEdit && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kademe">
              <select className="input" value={kademe}
                onChange={(e) => { setKademe(e.target.value); setDuzey(''); setDal(''); }}>
                {allowedKademeler.map((k) => (
                  <option key={k} value={k}>{KADEME_LABEL[k] || k}</option>
                ))}
              </select>
            </FormField>
            {duzeyOptions.length > 0 && (
              <FormField label="Düzey">
                <select className="input" value={duzey} onChange={(e) => setDuzey(e.target.value)}>
                  <option value="">— seç —</option>
                  {duzeyOptions.map((d) => <option key={d} value={d}>{d}. sınıf</option>)}
                </select>
              </FormField>
            )}
          </div>
        )}

        {showDal && (
          <FormField label="Dal (alan)" hint="Sayısal/EA ayrımı ders programı ve denemelerde kullanılır.">
            <select className="input" value={dal} onChange={(e) => setDal(e.target.value)}>
              {DAL_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </FormField>
        )}

        <div className="mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-label">Dersler {selected.length > 0 && `(${selected.length})`}</label>
            {!isEdit && dersler === null && (
              <span className="text-caption">Boş bırakılırsa şablondan otomatik atanır</span>
            )}
          </div>
          {courses.length === 0 ? (
            <p className="text-caption">Katalogda aktif ders yok.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto p-1">
              {courses.map((c) => {
                const on = selected.includes(c.key);
                return (
                  <button key={c.key} type="button" onClick={() => toggleDers(c.key)}
                    className="px-2.5 py-1 rounded-lg text-xs border transition-all"
                    style={on ? {
                      background: 'color-mix(in srgb, var(--brand,#6366f1) 14%, transparent)',
                      borderColor: 'var(--brand,#6366f1)',
                      color: 'var(--brand,#6366f1)', fontWeight: 600,
                    } : {
                      background: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--text-secondary)',
                    }}>
                    {on && <Check size={11} className="inline mr-0.5" />}{c.ad}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button className="btn-ghost" onClick={onClose} disabled={saving}>İptal</button>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Kaydediliyor…' : isEdit ? 'Kaydet' : 'Ekle'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Ders kataloğu yönetimi ───────────────────────────────────────────────────────
export function CourseCatalog({ courses, onChanged, showToast }) {
  const [yeni, setYeni] = useState('');
  const [busy, setBusy] = useState(false);

  async function ekle() {
    const ad = yeni.trim();
    if (!ad) return;
    setBusy(true);
    try {
      await api('/api/courses', { method: 'POST', body: JSON.stringify({ ad }) });
      setYeni('');
      showToast?.('Ders eklendi');
      await onChanged();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally { setBusy(false); }
  }

  async function toggleActive(c) {
    setBusy(true);
    try {
      await api('/api/courses', { method: 'PATCH', body: JSON.stringify({ key: c.key, active: c.active === false }) });
      await onChanged();
    } catch (err) {
      showToast?.(err.message, 'error');
    } finally { setBusy(false); }
  }

  const sorted = [...courses].sort((a, b) => {
    if ((a.core ? 0 : 1) !== (b.core ? 0 : 1)) return (a.core ? 0 : 1) - (b.core ? 0 : 1);
    return a.ad.localeCompare(b.ad, 'tr');
  });

  return (
    <div>
      <div className="flex items-end gap-2 mb-4 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="text-label block mb-1.5">Yeni ders ekle</label>
          <input className="input" value={yeni} onChange={(e) => setYeni(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ekle(); }}
            placeholder="örn. Resim, Müzik, Beden Eğitimi, Seçmeli Fizik" />
        </div>
        <button className="btn-primary !py-2.5 flex items-center gap-1.5" onClick={ekle} disabled={busy || !yeni.trim()}>
          <Plus size={15} /> Ekle
        </button>
      </div>

      <p className="text-caption mb-2">
        Çekirdek dersler silinemez, yalnız pasifleştirilebilir. Pasif ders yeni şubelere atanamaz
        (geçmiş kayıtlar korunur).
      </p>

      <div className="space-y-1.5">
        {sorted.map((c) => {
          const inactive = c.active === false;
          return (
            <div key={c.key}
              className="flex items-center justify-between gap-2 p-2.5 rounded-xl"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', opacity: inactive ? 0.55 : 1 }}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="truncate" style={{ fontWeight: 600 }}>{c.ad}</span>
                {c.core && <span className="badge text-[10px]">çekirdek</span>}
                {c.family === 'matematik' && <span className="badge-info text-[10px]">mat. ailesi</span>}
                {inactive && <span className="text-caption">pasif</span>}
              </div>
              <button className="btn-ghost !px-3 !py-1.5 text-sm flex items-center gap-1"
                onClick={() => toggleActive(c)} disabled={busy}>
                {inactive ? (<><Check size={13} /> Aktifleştir</>) : (<><XIcon size={13} /> Pasifleştir</>)}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
