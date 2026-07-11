'use client';
import { useState } from 'react';
import useSWR from 'swr';
import { Plus, Building2, ToggleLeft, ToggleRight, KeyRound, LogOut, RefreshCw, Pencil, Trash2, Lock, Inbox, Phone, Smartphone, Mail, Globe, CheckCircle2, AlertTriangle, Copy, Check, Moon, Sun } from 'lucide-react';
import { SEKTORLER, MULKIYETLER, KADEMELER, kademelerForSektor, defaultKademeler } from '@/lib/institution';
import type { Kademe } from '@/lib/institution';
import type { Session } from '@/lib/auth';
import { useDarkMode } from './ThemeToggle';

// GET /api/superadmin kurum satırı.
interface OrgDTO {
  slug: string;
  name: string;
  shortName?: string;
  type?: string;
  sektor?: string;
  mulkiyet?: string;
  active?: boolean;
  code?: string;
  directorUsername?: string;
  branchCount?: number;
  createdAt?: string;
}
// GET /api/superadmin/demo talep satırı.
interface DemoRequestDTO {
  id: string;
  name?: string;
  org?: string;
  phone?: string;
  email?: string;
  ts?: string | number;
  note?: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s.toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-slate-600">{label}</label>
      {children}
    </div>
  );
}

function Input({ id, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      id={id}
      className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
      {...props}
    />
  );
}

// ── Yeni Kurum Modalı ────────────────────────────────────────────────────────

// POST /api/superadmin create yanıtı (başarı ekranı verisi).
interface CreateOrgResult {
  slug?: string;
  code: string;
  domain: string;
  domainProvisioned?: boolean;
  domainWarning?: string;
  error?: string;
}

function NewOrgModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', slug: '', shortName: '', type: 'single',
    sektor: 'dershane', mulkiyet: 'ozel', kademeler: defaultKademeler('dershane'),
    directorUsername: '', directorPassword: '', directorName: '',
    orgAdminUsername: '', orgAdminPassword: '', orgAdminName: '',
  });
  const [slugManual, setSlugManual] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateOrgResult | null>(null); // başarı ekranı: { slug, code, domain, domainProvisioned, domainWarning }
  const [copied, setCopied] = useState(false);

  function set(k: string, v: string) {
    setForm(prev => {
      const next = { ...prev, [k]: v };
      if (k === 'name' && !slugManual) next.slug = slugify(v);
      if (k === 'sektor') {
        // dershane → mülkiyet daima özel; kademe kümesi sektöre göre yenilenir
        next.mulkiyet = v === 'dershane' ? 'ozel' : prev.mulkiyet;
        next.kademeler = defaultKademeler(v);
      }
      return next;
    });
  }

  function toggleKademe(key: Kademe) {
    setForm(prev => {
      const has = prev.kademeler.includes(key);
      return { ...prev, kademeler: has ? prev.kademeler.filter(x => x !== key) : [...prev.kademeler, key] };
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', ...form }),
      });
      const data = (await res.json()) as CreateOrgResult;
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      setResult(data); // formu kapatma — kod + domain durumunu göster
    } finally {
      setLoading(false);
    }
  }

  // Başarı ekranı — kurum kodu + domain (SSL) durumu
  if (result) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
        <div className="modal w-full max-w-md p-6 my-4" role="dialog" aria-modal="true" aria-labelledby="new-org-done">
          <div className="flex flex-col items-center text-center mb-5">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
              style={{ background: 'color-mix(in srgb, #16a34a 14%, transparent)', color: '#16a34a' }}>
              <CheckCircle2 size={26} />
            </div>
            <h2 id="new-org-done" className="text-lg font-semibold">Kurum oluşturuldu</h2>
            <p className="text-sm text-slate-500 mt-0.5">{form.name}</p>
          </div>

          <div className="flex flex-col gap-3">
            {/* Kurum kodu */}
            <div className="card px-4 py-3">
              <p className="text-xs text-slate-500 mb-1">Kurum Kodu (girişte kullanılır)</p>
              <div className="flex items-center justify-between gap-2">
                <code className="font-mono text-lg font-700" style={{ fontWeight: 700, color: '#6366f1' }}>{result.code}</code>
                <button type="button"
                  onClick={() => { navigator.clipboard?.writeText(result.code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="btn-ghost !px-2 !py-1 text-xs flex items-center gap-1">
                  {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Kopyalandı' : 'Kopyala'}
                </button>
              </div>
            </div>

            {/* Domain / SSL durumu */}
            <div className="card px-4 py-3">
              <p className="text-xs text-slate-500 mb-1">Adres</p>
              <a href={`https://${result.domain}`} target="_blank" rel="noopener noreferrer"
                className="font-mono text-sm text-indigo-600 hover:underline break-all">{result.domain}</a>
              {result.domainProvisioned ? (
                <p className="text-xs mt-2 flex items-center gap-1.5" style={{ color: '#16a34a' }}>
                  <CheckCircle2 size={13} /> Domain projeye eklendi — SSL otomatik üretiliyor (~30 sn).
                </p>
              ) : (
                <div className="text-xs mt-2 flex items-start gap-1.5" style={{ color: '#d97706' }}>
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>Domain otomatik eklenemedi{result.domainWarning ? `: ${result.domainWarning}` : ''}. Listeden <strong>Domain’i Sağla</strong> ile tekrar dene (veya elle <code>vercel domains add {result.domain}</code>).</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end mt-5">
            <button type="button" onClick={onCreated} className="btn-primary !px-4 !py-2 text-sm">Tamam</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="modal w-full max-w-md p-6 my-4" role="dialog" aria-modal="true" aria-labelledby="new-org-title">
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
            <p className="text-xs text-slate-400">Subdomain olarak kullanılır: {form.slug || 'slug'}.okulin.com</p>
          </Field>
          <Field label="Kısa Ad" id="org-short">
            <Input id="org-short" value={form.shortName} onChange={e => set('shortName', e.target.value)} placeholder="Çözüm" />
          </Field>
          <Field label="Kurum Tipi" id="org-type">
            <select id="org-type" value={form.type} onChange={e => set('type', e.target.value)}
              className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              <option value="single">Tek Şube (yerel/bağımsız)</option>
              <option value="multi">Çok Şube (zincir/kurumsal)</option>
            </select>
          </Field>

          <hr className="border-slate-200" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Kurum Türü</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sektör *" id="org-sektor">
              <select id="org-sektor" value={form.sektor} onChange={e => set('sektor', e.target.value)}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {SEKTORLER.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </Field>
            <Field label="Mülkiyet *" id="org-mulkiyet">
              <select id="org-mulkiyet" value={form.mulkiyet} onChange={e => set('mulkiyet', e.target.value)}
                disabled={form.sektor === 'dershane'}
                className="border border-slate-300 rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-slate-100 disabled:text-slate-400">
                {MULKIYETLER.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Kademeler *" id="org-kademeler">
            <div className="flex flex-wrap gap-2">
              {KADEMELER.filter(k => kademelerForSektor(form.sektor).includes(k.key)).map(k => {
                const on = form.kademeler.includes(k.key);
                return (
                  <button type="button" key={k.key} onClick={() => toggleKademe(k.key)}
                    className={`px-2.5 py-1 rounded text-xs border transition ${on
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-400'}`}>
                    {k.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-slate-400">Kurumun sahip olduğu kademeleri seç. {form.sektor === 'dershane' ? 'Dershanede İlkokul yok.' : 'Okulda Mezun yok.'}</p>
          </Field>

          <hr className="border-slate-200" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Ana Şube Müdürü</p>
          <Field label="Kullanıcı Adı *" id="dir-user">
            <Input id="dir-user" required value={form.directorUsername} onChange={e => set('directorUsername', e.target.value)} />
          </Field>
          <Field label="Ad Soyad" id="dir-name">
            <Input id="dir-name" value={form.directorName} onChange={e => set('directorName', e.target.value)} />
          </Field>
          <Field label="Şifre *" id="dir-pass">
            <Input id="dir-pass" required type="text" value={form.directorPassword} onChange={e => set('directorPassword', e.target.value)} autoComplete="new-password" />
          </Field>

          {form.type === 'multi' && (
            <>
              <hr className="border-slate-200" />
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Genel Merkez Hesabı (org_admin)</p>
              <Field label="Kullanıcı Adı *" id="oa-user">
                <Input id="oa-user" required value={form.orgAdminUsername} onChange={e => set('orgAdminUsername', e.target.value)} />
              </Field>
              <Field label="Ad Soyad" id="oa-name">
                <Input id="oa-name" value={form.orgAdminName} onChange={e => set('orgAdminName', e.target.value)} />
              </Field>
              <Field label="Şifre *" id="oa-pass">
                <Input id="oa-pass" required type="text" value={form.orgAdminPassword} onChange={e => set('orgAdminPassword', e.target.value)} autoComplete="new-password" />
              </Field>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 justify-end mt-2">
            <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-2 text-sm">İptal</button>
            <button type="submit" disabled={loading} className="btn-primary !px-4 !py-2 text-sm">
              {loading ? 'Oluşturuluyor…' : 'Oluştur'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Müdür Şifre Sıfırla Modalı ───────────────────────────────────────────────

interface OrgModalProps {
  org: OrgDTO;
  onClose: () => void;
  onDone: () => void;
}

function ResetPasswordModal({ org, onClose, onDone }: OrgModalProps) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_director', slug: org.slug, newPassword: pw }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="modal w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="reset-pw-title">
        <h2 id="reset-pw-title" className="text-base font-semibold mb-1">Müdür Şifresi Sıfırla</h2>
        <p className="text-sm text-slate-500 mb-4">{org.name}</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Yeni Şifre *" id="new-pw">
            <Input id="new-pw" required type="text" value={pw} onChange={e => setPw(e.target.value)} autoComplete="new-password" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-2 text-sm">İptal</button>
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

function RenameModal({ org, onClose, onDone }: OrgModalProps) {
  const [name, setName] = useState(org.name);
  const [shortName, setShortName] = useState(org.shortName || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rename', slug: org.slug, name, shortName }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="modal w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="rename-title">
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
            <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-2 text-sm">İptal</button>
            <button type="submit" disabled={loading} className="btn-primary !px-4 !py-2 text-sm">
              {loading ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Kendi Şifresini Değiştir Modalı ─────────────────────────────────────────

function ChangeOwnPasswordModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(k: string, v: string) { setForm(prev => ({ ...prev, [k]: v })); }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (form.next !== form.confirm) { setError('Yeni şifreler eşleşmiyor'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_own_password', currentPassword: form.current, newPassword: form.next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="modal w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="chpw-title">
        <h2 id="chpw-title" className="text-base font-semibold mb-4">Şifremi Değiştir</h2>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Mevcut Şifre *" id="cp-current">
            <Input id="cp-current" required type="password" value={form.current} onChange={e => set('current', e.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="Yeni Şifre *" id="cp-next">
            <Input id="cp-next" required type="password" value={form.next} onChange={e => set('next', e.target.value)} autoComplete="new-password" />
          </Field>
          <Field label="Yeni Şifre (Tekrar) *" id="cp-confirm">
            <Input id="cp-confirm" required type="password" value={form.confirm} onChange={e => set('confirm', e.target.value)} autoComplete="new-password" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-2 text-sm">İptal</button>
            <button type="submit" disabled={loading} className="btn-primary !px-4 !py-2 text-sm">
              {loading ? 'Kaydediliyor…' : 'Değiştir'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── İki Adımlı Doğrulama (2FA) Telefon Modalı ───────────────────────────────

function SetPhoneModal({ hasPhone, onClose, onDone }: { hasPhone: boolean; onClose: () => void; onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_own_phone', phone }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  async function disable2fa() {
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_own_phone', phone: '' }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="modal w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="phone-title">
        <h2 id="phone-title" className="text-base font-semibold mb-1">İki Adımlı Doğrulama (SMS)</h2>
        <p className="text-sm text-slate-500 mb-4">
          {hasPhone
            ? 'Şu an 2FA aktif. Yeni bir telefon girip güncelleyebilir veya kapatabilirsin.'
            : 'Telefon eklersen, tanınmayan bir cihazdan giriş yapıldığında SMS kodu istenir.'}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="Telefon (05XX XXX XX XX)" id="sa-phone">
            <Input id="sa-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0532 123 45 67" />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            {hasPhone && (
              <button type="button" onClick={disable2fa} disabled={loading}
                className="px-3 py-1.5 rounded text-sm text-red-600 hover:bg-red-50 disabled:opacity-50">
                2FA'yı Kapat
              </button>
            )}
            <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-2 text-sm">İptal</button>
            <button type="submit" disabled={loading || !phone.trim()} className="btn-primary !px-4 !py-2 text-sm">
              {loading ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Kurum Sil Onay Modalı ────────────────────────────────────────────────────

function DeleteConfirmModal({ org, onClose, onDone }: OrgModalProps) {
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (confirm !== org.slug) { setError('Slug eşleşmiyor'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: org.slug }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) { setError(data.error || 'Hata'); return; }
      onDone();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="modal w-full max-w-sm p-6" role="dialog" aria-modal="true" aria-labelledby="delete-title">
        <h2 id="delete-title" className="text-base font-semibold text-red-600 mb-1">Kurumu Sil</h2>
        <p className="text-sm text-slate-600 mb-1"><strong>{org.name}</strong> kurumu ve tüm verisi kalıcı olarak silinecek.</p>
        <p className="text-sm text-slate-500 mb-4">Bu işlem <strong>geri alınamaz</strong>. Onaylamak için slug'ı yazın:</p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label={`Slug: ${org.slug}`} id="del-confirm">
            <Input id="del-confirm" required value={confirm} onChange={e => setConfirm(e.target.value)} placeholder={org.slug} />
          </Field>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end mt-1">
            <button type="button" onClick={onClose} className="btn-ghost !px-3 !py-2 text-sm">İptal</button>
            <button type="submit" disabled={loading || confirm !== org.slug}
              className="px-4 py-1.5 rounded text-sm bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">
              {loading ? 'Siliniyor…' : 'Kalıcı Sil'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Demo / İletişim Talepleri ────────────────────────────────────────────────

function DemoRequests() {
  const { data: demoData, isLoading: loading, mutate } = useSWR<{ requests?: DemoRequestDTO[] }>('/api/superadmin/demo');
  const items = demoData?.requests || [];

  async function remove(id: string) {
    await fetch('/api/superadmin/demo', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    mutate({ requests: items.filter(r => r.id !== id) }, { revalidate: false });
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-700 flex items-center gap-2">
          <Inbox size={16} /> Demo Talepleri
          <span className="text-slate-400 font-normal text-sm">({items.length})</span>
        </h2>
        <button onClick={() => mutate()} aria-label="Yenile" className="btn-icon">
          <RefreshCw size={16} />
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 text-center py-6">Yükleniyor…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">Henüz demo talebi yok.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map(r => (
            <div key={r.id} className="card px-4 py-3 flex flex-col sm:flex-row sm:items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-slate-800">{r.name}</span>
                  <span className="text-xs text-slate-400">·</span>
                  <span className="text-sm text-slate-600">{r.org}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1 flex gap-4 flex-wrap items-center">
                  {r.phone && (
                    <a href={`tel:${r.phone}`} className="flex items-center gap-1 hover:text-indigo-600">
                      <Phone size={12} /> {r.phone}
                    </a>
                  )}
                  {r.email && (
                    <a href={`mailto:${r.email}`} className="flex items-center gap-1 hover:text-indigo-600">
                      <Mail size={12} /> {r.email}
                    </a>
                  )}
                  {r.ts && <span>{new Date(r.ts).toLocaleString('tr-TR')}</span>}
                </div>
                {r.note && <p className="text-sm text-slate-600 mt-2 whitespace-pre-wrap">{r.note}</p>}
              </div>
              <button
                onClick={() => remove(r.id)}
                title="Talebi sil"
                aria-label={`${r.name} talebini sil`}
                className="btn-icon btn-icon-danger shrink-0"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Ana Panel ────────────────────────────────────────────────────────────────

type ModalState =
  | { type: 'new' }
  | { type: 'chpw' }
  | { type: 'phone' }
  | { type: 'reset' | 'rename' | 'delete'; org: OrgDTO }
  | null;

interface SuperAdminPanelProps {
  session?: Session | null;
  onLogout: () => void;
}

export default function SuperAdminPanel({ session, onLogout }: SuperAdminPanelProps) {
  const { data: orgsData, isLoading: loading, mutate: loadOrgs } = useSWR<{ orgs?: OrgDTO[]; superadmin?: { hasPhone?: boolean } }>('/api/superadmin');
  const orgs = orgsData?.orgs || [];
  const hasPhone = !!orgsData?.superadmin?.hasPhone;
  const [modal, setModal] = useState<ModalState>(null); // null | {type, org?}
  const [provisioning, setProvisioning] = useState<string | null>(null); // domain ekleniyor (slug)
  const [domainNote, setDomainNote] = useState<{ ok: boolean; text: string } | null>(null); // { ok, text }
  const { dark, toggle: toggleDark } = useDarkMode();

  async function toggleActive(org: OrgDTO) {
    await fetch('/api/superadmin', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle_active', slug: org.slug }),
    });
    loadOrgs();
  }

  // Subdomain'i Vercel projesine (yeniden) ekle — mevcut kurum veya başarısız onboarding için.
  async function provisionDomain(org: OrgDTO) {
    setProvisioning(org.slug);
    setDomainNote(null);
    try {
      const res = await fetch('/api/superadmin', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'provision_domain', slug: org.slug }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; domain?: string; alreadyExists?: boolean };
      if (!res.ok) {
        setDomainNote({ ok: false, text: `${org.slug}.okulin.com eklenemedi: ${data.error || 'hata'}` });
      } else {
        setDomainNote({
          ok: true,
          text: data.alreadyExists
            ? `${data.domain} zaten ekli.`
            : `${data.domain} eklendi — SSL üretiliyor (~30 sn).`,
        });
      }
    } catch {
      setDomainNote({ ok: false, text: 'Bağlantı hatası.' });
    } finally {
      setProvisioning(null);
      setTimeout(() => setDomainNote(null), 6000);
    }
  }

  function closeModal() { setModal(null); }
  function afterAction() { setModal(null); loadOrgs(); }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Header — sabit koyu yüzey (login sayfasıyla aynı marka: kurum-üstü rol, temadan bağımsız kimlik) */}
      <header className="text-white px-4 py-3 flex items-center justify-between shadow"
        style={{ background: 'linear-gradient(135deg,#0f172a,#334155)' }}>
        <div className="flex items-center gap-2">
          <Building2 size={20} />
          <span className="font-semibold">Süper Admin</span>
          <span className="text-slate-300 text-sm ml-2">— {session?.name}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleDark}
            title={dark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
            aria-label={dark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
            className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            {dark ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            onClick={() => setModal({ type: 'phone' })}
            title={hasPhone ? '2FA aktif — telefonu yönet' : '2FA kapalı — telefon ekle'}
            className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            <Smartphone size={15} /> 2FA {hasPhone ? <CheckCircle2 size={13} style={{ color: '#4ade80' }} /> : null}
          </button>
          <button
            onClick={() => setModal({ type: 'chpw' })}
            title="Şifremi değiştir"
            className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            <Lock size={15} /> Şifre
          </button>
          <button
            onClick={onLogout}
            aria-label="Çıkış yap"
            className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white"
          >
            <LogOut size={16} /> Çıkış
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold text-slate-700">
            Kurumlar <span className="text-slate-400 font-normal text-sm">({orgs.length})</span>
          </h1>
          <div className="flex gap-2">
            <button
              onClick={() => loadOrgs()}
              aria-label="Yenile"
              className="btn-icon"
            >
              <RefreshCw size={16} />
            </button>
            <button
              onClick={() => setModal({ type: 'new' })}
              className="btn-primary !px-3 !py-2 flex items-center gap-1.5 text-sm"
            >
              <Plus size={15} /> Yeni Kurum
            </button>
          </div>
        </div>

        {/* Domain işlemi bildirimi */}
        {domainNote && (
          <div className={`mb-3 px-3 py-2 rounded text-sm flex items-center gap-2 ${domainNote.ok ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {domainNote.ok ? <CheckCircle2 size={15} className="shrink-0" /> : <AlertTriangle size={15} className="shrink-0" />}
            {domainNote.text}
          </div>
        )}

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
                className={`card px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 ${!org.active ? 'opacity-60' : ''}`}
              >
                {/* Bilgi */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-slate-800 truncate">{org.name}</span>
                    {org.shortName && <span className="text-xs text-slate-400">({org.shortName})</span>}
                    {org.type === 'multi'
                      ? <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">Çok Şube</span>
                      : <span className="text-xs bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded">Tek Şube</span>
                    }
                    <span className="text-xs bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded">
                      {org.sektor === 'okul' ? 'Okul' : 'Dershane'}{org.mulkiyet === 'devlet' ? ' · Devlet' : ''}
                    </span>
                    {!org.active && (
                      <span className="text-xs bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">Pasif</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap items-center">
                    {org.code && (
                      <button
                        onClick={() => { navigator.clipboard?.writeText(org.code!); }}
                        title="Kurum kodunu kopyala"
                        className="font-mono font-700 px-2 py-0.5 rounded"
                        style={{ fontWeight: 700, color: '#6366f1', background: 'color-mix(in srgb, #6366f1 12%, transparent)' }}>
                        kod: {org.code}
                      </button>
                    )}
                    <span>slug: <code className="font-mono">{org.slug}</code></span>
                    {org.directorUsername && <span>müdür: {org.directorUsername}</span>}
                    {org.type === 'multi' && <span>{org.branchCount} şube</span>}
                    {org.createdAt && <span>{new Date(org.createdAt).toLocaleDateString('tr-TR')}</span>}
                  </div>
                </div>

                {/* Aksiyonlar */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setModal({ type: 'rename', org })}
                    title="Adını düzenle"
                    aria-label={`${org.name} adını düzenle`}
                    className="btn-icon btn-icon-primary"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setModal({ type: 'reset', org })}
                    title="Müdür şifresi sıfırla"
                    aria-label={`${org.name} müdür şifresini sıfırla`}
                    className="btn-icon btn-icon-warning"
                  >
                    <KeyRound size={15} />
                  </button>
                  <button
                    onClick={() => provisionDomain(org)}
                    disabled={provisioning === org.slug}
                    title={`Domain'i sağla: ${org.slug}.okulin.com (Vercel + SSL)`}
                    aria-label={`${org.name} domainini sağla`}
                    className="btn-icon btn-icon-primary"
                  >
                    {provisioning === org.slug
                      ? <RefreshCw size={15} className="animate-spin" />
                      : <Globe size={15} />}
                  </button>
                  <button
                    onClick={() => toggleActive(org)}
                    title={org.active ? 'Pasife al' : 'Aktif et'}
                    aria-label={org.active ? `${org.name} pasife al` : `${org.name} aktif et`}
                    className={`btn-icon ${org.active ? 'btn-icon-danger' : 'btn-icon-success'}`}
                  >
                    {org.active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                  </button>
                  <button
                    onClick={() => setModal({ type: 'delete', org })}
                    title="Kurumu sil"
                    aria-label={`${org.name} sil`}
                    className="btn-icon btn-icon-danger"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <DemoRequests />
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
      {modal?.type === 'delete' && (
        <DeleteConfirmModal org={modal.org} onClose={closeModal} onDone={afterAction} />
      )}
      {modal?.type === 'chpw' && (
        <ChangeOwnPasswordModal onClose={closeModal} onDone={() => { setModal(null); }} />
      )}
      {modal?.type === 'phone' && (
        <SetPhoneModal hasPhone={hasPhone} onClose={closeModal} onDone={() => { setModal(null); loadOrgs(); }} />
      )}
    </div>
  );
}
