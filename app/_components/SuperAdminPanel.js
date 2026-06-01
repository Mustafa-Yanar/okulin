'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Building2, ToggleLeft, ToggleRight, KeyRound, LogOut, RefreshCw, Pencil } from 'lucide-react';

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(s) {
  return s.toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function Field({ label, id, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}

function Input({ id, ...props }) {
  return (
    <input
      id={id}
      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      {...props}
    />
  );
}

// ── Yeni Kurum Modalı ────────────────────────────────────────────────────────

function NewOrgModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: '', slug: '', shortName: '',
    directorUsername: '', directorPassword: '', directorName: '',
  });
  const [slugManual, setSlugManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      if (k === 'name' && !slugManual) next.slug = slugify(v);
      return next;
    });
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...form }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onCreated();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="new-org-title">
        <h2 id="new-org-title" className="text-lg font-semibold mb-4">Yeni Kurum Ekle</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Kurum Adı *" id="org-name">
            <Input id="org-name" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Akyazı Çözüm Dershanesi" />
          </Field>
          <Field label="Slug (URL kimliği) *" id="org-slug">
            <Input id="org-slug" required value={form.slug}
              onChange={e => { setSlugManual(true); set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); }}
              placeholder="akyazi-cozum"
            />
            <p className="text-xs text-slate-400">Subdomain olarak kullanılır: {form.slug || 'slug'}.etuttakip.app</p>
          </Field>
          <Field label="Kısa Ad" id="org-short">
            <Input id="org-short" value={form.shortName} onChange={e => set('shortName', e.target.value)} placeholder="Çözüm" />
          </Field>
          <hr className="border-slate-200" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Müdür Hesabı</p>
          <Field label="Kullanıcı Adı *" id="dir-user">
            <Input id="dir-user" required value={form.directorUsername} onChange={e => set('directorUsername', e.target.value)} />
          </Field>
          <Field label="Ad Soyad" id="dir-name">
            <Input id="dir-name" value={form.directorName} onChange={e => set('directorName', e.target.value)} />
          </Field>
          <Field label="Şifre *" id="dir-pass">
            <Input id="dir-pass" required type="text" value={form.directorPassword} onChange={e => set('directorPassword', e.target.value)} autoComplete="new-password" />
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-sm text-slate-600 hover:bg-slate-100">İptal</button>
            <button type="submit" disabled={loading} className="px-4 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {loading ? 'Oluşturuluyor…' : 'Oluştur'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Müdür Şifre Sıfırla Modalı ───────────────────────────────────────────────

function ResetPasswordModal({ org, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_director', slug: org.slug, newPassword: pw }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="reset-pw-title">
        <h2 id="reset-pw-title" className="text-base font-semibold mb-1">Müdür Şifresi Sıfırla</h2>
        <p className="text-sm text-slate-500 mb-4">{org.name}</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Yeni Şifre *" id="new-pw">
            <Input id="new-pw" required type="text" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-sm text-slate-600 hover:bg-slate-100">İptal</button>
            <button type="submit" disabled={loading} className="px-4 py-1.5 rounded text-sm bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
              {loading ? 'Sıfırlanıyor…' : 'Sıfırla'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Ad Düzenle Modalı ────────────────────────────────────────────────────────

function RenameModal({ org, onClose, onDone }) {
  const [name, setName] = useState(org.name);
  const [shortName, setShortName] = useState(org.shortName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', slug: org.slug, name, shortName }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="rename-title">
        <h2 id="rename-title" className="text-base font-semibold mb-4">Kurum Adını Düzenle</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Kurum Adı *" id="r-name">
            <Input id="r-name" required value={name} onChange={e => setName(e.target.value)} />
          </Field>
          <Field label="Kısa Ad" id="r-short">
            <Input id="r-short" value={shortName} onChange={e => setShortName(e.target.value)} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={onClose} className="px-3 py-1.5 rounded text-sm text-slate-600 hover:bg-slate-100">İptal</button>
            <button type="submit" disabled={loading} className="px-4 py-1.5 rounded text-sm bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50">
              {loading ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Ana Panel ────────────────────────────────────────────────────────────────

export default function SuperAdminPanel({ session, onLogout }) {
  const [orgs, setOrgs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | {type, org?}

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin');
      const data = await res.json();
      if (res.ok) setOrgs(data.orgs || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);

  async function toggleActive(org) {
    await fetch('/api/superadmin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_active', slug: org.slug }),
    });
    loadOrgs();
  }

  function closeModal() { setModal(null); }
  function afterAction() { setModal(null); loadOrgs(); }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-indigo-700 text-white px-4 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-2">
          <Building2 size={20} />
          <span className="font-semibold">Süper Admin</span>
          <span className="text-indigo-300 text-sm ml-2">— {session?.name}</span>
        </div>
        <button
          onClick={onLogout}
          aria-label="Çıkış yap"
          className="flex items-center gap-1.5 text-sm text-indigo-200 hover:text-white"
        >
          <LogOut size={16} /> Çıkış
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold text-slate-700">
            Kurumlar <span className="text-slate-400 font-normal text-sm">({orgs.length})</span>
          </h1>
          <div className="flex gap-2">
            <button
              onClick={loadOrgs}
              aria-label="Yenile"
              className="p-2 rounded hover:bg-slate-200 text-slate-500"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => setModal({ type: 'new' })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
            >
              <Plus size={15} /> Yeni Kurum
            </button>
          </div>
        </div>

        {/* Org listesi */}
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Yükleniyor…</p>
        ) : orgs.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Henüz kurum yok.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {orgs.map(org => (
              <div
                key={org.slug}
                className={`bg-white rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${org.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}
              >
                {/* Bilgi */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800 truncate">{org.name}</span>
                    {org.shortName && <span className="text-xs text-slate-400">({org.shortName})</span>}
                    {!org.active && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Pasif</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap">
                    <span>slug: <code className="font-mono">{org.slug}</code></span>
                    {org.directorUsername && <span>müdür: {org.directorUsername}</span>}
                    {org.createdAt && <span>{new Date(org.createdAt).toLocaleDateString('tr-TR')}</span>}
                  </div>
                </div>

                {/* Aksiyonlar */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setModal({ type: 'rename', org })}
                    title="Adını düzenle"
                    aria-label={`${org.name} adını düzenle`}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setModal({ type: 'reset', org })}
                    title="Müdür şifresi sıfırla"
                    aria-label={`${org.name} müdür şifresini sıfırla`}
                    className="p-1.5 rounded hover:bg-amber-50 text-amber-600"
                  >
                    <KeyRound size={15} />
                  </button>
                  <button
                    onClick={() => toggleActive(org)}
                    title={org.active ? 'Pasife al' : 'Aktif et'}
                    aria-label={org.active ? `${org.name} pasife al` : `${org.name} aktif et`}
                    className={`p-1.5 rounded ${org.active ? 'hover:bg-red-50 text-red-500' : 'hover:bg-green-50 text-green-600'}`}
                  >
                    {org.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modaller */}
      {modal?.type === 'new' && (
        <NewOrgModal onClose={closeModal} onCreated={afterAction} />
      )}
      {modal?.type === 'reset' && (
        <ResetPasswordModal org={modal.org} onClose={closeModal} onDone={afterAction} />
      )}
      {modal?.type === 'rename' && (
        <RenameModal org={modal.org} onClose={closeModal} onDone={afterAction} />
      )}
    </div>
  );
}
