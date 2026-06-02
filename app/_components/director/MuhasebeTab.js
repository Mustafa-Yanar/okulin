'use client';

// Müdür muhasebe sekmesi: öğrenci ödemeleri (FinancePanel) + muhasebeci CRUD.
import React, { useState, useEffect } from 'react';
import { Plus, Wallet, Edit3, Trash2, X } from 'lucide-react';
import FinancePanel from '../finance/FinancePanel';
import ExpensePanel from '../finance/ExpensePanel';

export default function DirectorMuhasebeTab({ session, showToast }) {
  const [subTab, setSubTab] = useState('finance');
  const [accountants, setAccountants] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editAcc, setEditAcc] = useState(null);
  const [form, setForm] = useState({ name: '', password: '', phone: '' });
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

  function openNew() { setEditAcc(null); setForm({ name: '', password: '', phone: '' }); setShowForm(true); }
  function openEdit(a) { setEditAcc(a); setForm({ name: a.name, password: '', phone: a.phone || '' }); setShowForm(true); }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) { showToast('İsim gerekli', 'error'); return; }
    if (!editAcc && !form.password) { showToast('Şifre gerekli', 'error'); return; }
    setSaving(true);
    try {
      const body = editAcc
        ? { id: editAcc.id, name: form.name, password: form.password || undefined, phone: form.phone || undefined }
        : { name: form.name, password: form.password, phone: form.phone || undefined };
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
      <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: 'var(--bg-muted)' }}>
        {[['finance', 'Öğrenci Ödemeleri'], ['expenses', 'Giderler'], ['accountants', 'Muhasebeciler']].map(([k, l]) => (
          <button key={k} onClick={() => setSubTab(k)} className="press-effect"
            style={{
              padding: '6px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600,
              transition: 'all var(--transition-base)',
              background: subTab === k ? 'var(--bg-surface)' : 'transparent',
              color: subTab === k ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: subTab === k ? 'var(--shadow-sm)' : 'none',
            }}>{l}</button>
        ))}
      </div>

      {subTab === 'finance' && <FinancePanel session={session} showToast={showToast} />}

      {subTab === 'expenses' && <ExpensePanel session={session} showToast={showToast} />}

      {subTab === 'accountants' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Muhasebeciler ({accountants.length})</h3>
            <button className="btn-primary !px-4 !py-2 flex items-center gap-1.5 text-sm" onClick={openNew}>
              <Plus size={14} /> Ekle
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-32 text-caption">Yükleniyor...</div>
          ) : accountants.length === 0 ? (
            <div className="text-center py-12">
              <Wallet size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="text-caption">Henüz muhasebeci tanımlanmamış</p>
              <button className="mt-3 btn-primary !px-4 !py-2 text-sm" onClick={openNew}>
                <Plus size={13} className="inline mr-1" /> İlk muhasebeciyi ekle
              </button>
            </div>
          ) : (
            <div className="grid gap-2">
              {accountants.map(a => (
                <div key={a.id} className="card card-interactive flex items-center px-4 py-3.5 gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white font-700 text-sm"
                    style={{ background: 'linear-gradient(135deg,#0891b2,#0284c7)', fontWeight: 700 }}>
                    {a.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</div>
                    <div className="text-caption">Kullanıcı adı: <span className="font-500" style={{ color: 'var(--text-secondary)' }}>{a.username}</span></div>
                  </div>
                  <span className="badge" style={{ background: 'color-mix(in srgb, #0891b2 12%, transparent)', color: '#0891b2' }}>
                    Muhasebeci
                  </span>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => openEdit(a)} className="btn-icon btn-icon-primary" title="Düzenle">
                      <Edit3 size={14} />
                    </button>
                    <button onClick={() => handleDelete(a.id, a.name)} className="btn-icon btn-icon-danger" title="Sil">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showForm && (
            <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
              <div role="dialog" aria-modal="true" aria-label={editAcc ? 'Muhasebeci düzenle' : 'Yeni muhasebeci'} className="modal w-full max-w-sm">
                <div className="flex items-center justify-between p-5 border-b border-gray-100">
                  <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>
                    {editAcc ? 'Muhasebeci Düzenle' : 'Yeni Muhasebeci'}
                  </h3>
                  <button onClick={() => setShowForm(false)} className="p-2 rounded-lg hover:bg-gray-100"><X size={16} /></button>
                </div>
                <form onSubmit={handleSave} className="p-5 space-y-4">
                  <div>
                    <label className="text-label block mb-1.5">Ad Soyad</label>
                    <input
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                      className="input"
                      placeholder="Örn: Ayşe Yılmaz"
                      aria-label="Muhasebeci adı soyadı"
                      required autoFocus
                    />
                    <p className="text-caption mt-1">Kullanıcı adı olarak da kullanılacak</p>
                  </div>
                  <div>
                    <label className="text-label block mb-1.5">
                      Şifre {editAcc && <span className="normal-case font-400" style={{ color: 'var(--text-muted)' }}>(boş bırakırsan değişmez)</span>}
                    </label>
                    <input
                      type="password"
                      value={form.password}
                      onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      className="input"
                      placeholder={editAcc ? 'Yeni şifre (opsiyonel)' : 'Şifre girin'}
                      aria-label="Muhasebeci şifresi"
                      required={!editAcc}
                    />
                  </div>
                  <div>
                    <label className="text-label block mb-1.5">Telefon</label>
                    <input
                      type="tel"
                      inputMode="tel"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="input"
                      placeholder="05XX XXX XX XX"
                      aria-label="Muhasebeci telefonu"
                    />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button type="submit" disabled={saving} className="btn-primary flex-1">
                      {saving ? 'Kaydediliyor…' : editAcc ? 'Güncelle' : 'Ekle'}
                    </button>
                    <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">İptal</button>
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
