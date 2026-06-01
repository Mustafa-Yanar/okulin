'use client';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Building2, ToggleLeft, ToggleRight, KeyRound, LogOut, RefreshCw, Pencil, Users, GraduationCap } from 'lucide-react';

// ── helpers ──────────────────────────────────────────────────────────────────

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

// ── Yeni Şube Modalı ─────────────────────────────────────────────────────────

function NewBranchModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    branchSlug: '', name: '',
    directorUsername: '', directorPassword: '', directorName: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/hq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_branch', ...form }),
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" role="dialog" aria-modal="true" aria-labelledby="new-branch-title">
        <h2 id="new-branch-title" className="text-lg font-semibold mb-4">Yeni Şube Ekle</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Şube Slug (URL kimliği) *" id="b-slug">
            <Input id="b-slug" required value={form.branchSlug}
              onChange={e => set('branchSlug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="ankara" />
            <p className="text-xs text-slate-400">Küçük harf, rakam, tire. Örn: ankara, izmir-merkez</p>
          </Field>
          <Field label="Şube Adı *" id="b-name">
            <Input id="b-name" required value={form.name} onChange={e => set('name', e.target.value)} placeholder="Ankara Şubesi" />
          </Field>
          <hr className="border-slate-200" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Şube Müdürü</p>
          <Field label="Kullanıcı Adı *" id="b-user">
            <Input id="b-user" required value={form.directorUsername} onChange={e => set('directorUsername', e.target.value)} />
          </Field>
          <Field label="Ad Soyad" id="b-dname">
            <Input id="b-dname" value={form.directorName} onChange={e => set('directorName', e.target.value)} />
          </Field>
          <Field label="Şifre *" id="b-pass">
            <Input id="b-pass" required type="text" value={form.directorPassword} onChange={e => set('directorPassword', e.target.value)} autoComplete="new-password" />
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

// ── Müdür Şifre Sıfırlama Modalı ─────────────────────────────────────────────

function ResetPasswordModal({ branch, onClose, onDone }) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/hq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_director', branchSlug: branch.slug, newPassword: pw }),
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="reset-b-pw-title">
        <h2 id="reset-b-pw-title" className="text-base font-semibold mb-1">Müdür Şifresi Sıfırla</h2>
        <p className="text-sm text-slate-500 mb-4">{branch.name}</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Yeni Şifre *" id="b-new-pw">
            <Input id="b-new-pw" required type="text" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
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

function RenameModal({ branch, onClose, onDone }) {
  const [name, setName] = useState(branch.name);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/hq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', branchSlug: branch.slug, name }),
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="rename-b-title">
        <h2 id="rename-b-title" className="text-base font-semibold mb-4">Şube Adını Düzenle</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Şube Adı *" id="rb-name">
            <Input id="rb-name" required value={name} onChange={e => setName(e.target.value)} />
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

export default function OrgAdminPanel({ session, onLogout }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/hq');
      const json = await res.json();
      if (res.ok) setData(json);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(branch) {
    await fetch('/api/hq', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_active', branchSlug: branch.slug }),
    });
    load();
  }

  function closeModal() { setModal(null); }
  function afterAction() { setModal(null); load(); }

  const branches = data?.branches || [];
  const totalStudents = branches.reduce((s, b) => s + (b.studentCount || 0), 0);
  const totalTeachers = branches.reduce((s, b) => s + (b.teacherCount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-indigo-700 text-white px-4 py-3 flex items-center justify-between shadow">
        <div className="flex items-center gap-2 min-w-0">
          <Building2 size={20} className="shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold truncate">{data?.orgName || '…'}</span>
            <span className="ml-2 text-xs bg-indigo-500 px-1.5 py-0.5 rounded">Genel Merkez</span>
          </div>
          <span className="text-indigo-300 text-sm ml-2 hidden sm:inline">— {session?.name}</span>
        </div>
        <button
          onClick={onLogout}
          aria-label="Çıkış yap"
          className="flex items-center gap-1.5 text-sm text-indigo-200 hover:text-white shrink-0"
        >
          <LogOut size={16} /> Çıkış
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        {/* Özet istatistik */}
        {!loading && data && (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{branches.length}</div>
              <div className="text-xs text-slate-500 mt-0.5">Şube</div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{totalStudents}</div>
              <div className="text-xs text-slate-500 mt-0.5">Öğrenci</div>
            </div>
            <div className="bg-white rounded-lg border border-slate-200 p-3 text-center">
              <div className="text-2xl font-bold text-green-600">{totalTeachers}</div>
              <div className="text-xs text-slate-500 mt-0.5">Öğretmen</div>
            </div>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold text-slate-700">Şubeler</h1>
          <div className="flex gap-2">
            <button onClick={load} aria-label="Yenile" className="p-2 rounded hover:bg-slate-200 text-slate-500">
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => setModal({ type: 'new' })}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700"
            >
              <Plus size={15} /> Yeni Şube
            </button>
          </div>
        </div>

        {/* Şube listesi */}
        {loading ? (
          <p className="text-sm text-slate-400 text-center py-8">Yükleniyor…</p>
        ) : branches.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">Henüz şube yok.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {branches.map(branch => (
              <div
                key={branch.slug}
                className={`bg-white rounded-lg border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${branch.active ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}
              >
                {/* Bilgi */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800">{branch.name}</span>
                    {branch.slug === 'main' && (
                      <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">Ana Şube</span>
                    )}
                    {!branch.active && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Pasif</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap items-center">
                    <span>slug: <code className="font-mono">{branch.slug}</code></span>
                    {branch.directorUsername && <span>müdür: {branch.directorUsername}</span>}
                    <span className="flex items-center gap-1"><GraduationCap size={11} /> {branch.studentCount}</span>
                    <span className="flex items-center gap-1"><Users size={11} /> {branch.teacherCount}</span>
                  </div>
                </div>

                {/* Aksiyonlar */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setModal({ type: 'rename', branch })}
                    title="Adını düzenle"
                    aria-label={`${branch.name} adını düzenle`}
                    className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setModal({ type: 'reset', branch })}
                    title="Müdür şifresi sıfırla"
                    aria-label={`${branch.name} müdür şifresini sıfırla`}
                    className="p-1.5 rounded hover:bg-amber-50 text-amber-600"
                  >
                    <KeyRound size={15} />
                  </button>
                  {branch.slug !== 'main' && (
                    <button
                      onClick={() => toggleActive(branch)}
                      title={branch.active ? 'Pasife al' : 'Aktif et'}
                      aria-label={branch.active ? `${branch.name} pasife al` : `${branch.name} aktif et`}
                      className={`p-1.5 rounded ${branch.active ? 'hover:bg-red-50 text-red-500' : 'hover:bg-green-50 text-green-600'}`}
                    >
                      {branch.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modaller */}
      {modal?.type === 'new' && (
        <NewBranchModal onClose={closeModal} onCreated={afterAction} />
      )}
      {modal?.type === 'reset' && (
        <ResetPasswordModal branch={modal.branch} onClose={closeModal} onDone={afterAction} />
      )}
      {modal?.type === 'rename' && (
        <RenameModal branch={modal.branch} onClose={closeModal} onDone={afterAction} />
      )}
    </div>
  );
}
