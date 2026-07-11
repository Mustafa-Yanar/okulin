'use client';

// Gizli süper-admin sayfası — hem giriş hem panel BURADA (kurum subdomain'inin
// kökünde değil). Süper-admin kurum-üstü bir roldür; URL gizli yolda kalır,
// kurum giriş ekranından tamamen ayrıdır.
// - Oturum yoksa / süper-admin değilse → gizli giriş formu.
// - Oturum süper-admin ise → SuperAdminPanel (URL değişmez, gizli yolda kalır).

import { useState, useEffect, useCallback } from 'react';
import { ShieldCheck } from 'lucide-react';
import SuperAdminPanel from '../_components/SuperAdminPanel';
import type { Session } from '@/lib/auth';

export default function SuperAdminPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined=yükleniyor, null=yok
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Mevcut oturumu kontrol et (sayfa yenilenince panel açık kalsın).
  const loadSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth');
      const data = (await res.json().catch(() => ({}))) as { session?: Session };
      setSession(data.session && data.session.role === 'superadmin' ? data.session : null);
    } catch {
      setSession(null);
    }
  }, []);
  useEffect(() => { loadSession(); }, [loadSession]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', role: 'superadmin', username, password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; role?: string; name?: string };
      if (!res.ok || data.role !== 'superadmin') {
        setError(data.error || 'Giriş başarısız.');
        setLoading(false);
        return;
      }
      setSession({ role: 'superadmin', id: 'superadmin', name: data.name });
    } catch {
      setError('Bağlantı hatası.');
      setLoading(false);
    }
  }

  async function logout() {
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'logout' }),
      });
    } catch {}
    setSession(null);
    setUsername('');
    setPassword('');
    setLoading(false);
  }

  // Yükleniyor
  if (session === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="text-gray-400 text-sm">Yükleniyor…</div>
      </div>
    );
  }

  // Süper-admin oturumu açık → panel (URL gizli yolda kalır)
  if (session) {
    return <SuperAdminPanel session={session} onLogout={logout} />;
  }

  // Giriş formu
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-base)' }}>
      <div className="card-elevated w-full max-w-sm p-8">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white mb-3"
            style={{ background: 'linear-gradient(135deg,#0f172a,#334155)' }}>
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-lg font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Süper Yönetici</h1>
          <p className="text-caption mt-1">Sistem yönetim girişi</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-label block mb-1.5">Kullanıcı Adı</label>
            <input className={`input ${error ? 'input-error' : ''}`} value={username}
              onChange={e => setUsername(e.target.value)} required autoFocus autoComplete="username" />
          </div>
          <div>
            <label className="text-label block mb-1.5">Şifre</label>
            <input className={`input ${error ? 'input-error' : ''}`} type="password" value={password}
              onChange={e => setPassword(e.target.value)} required autoComplete="current-password" />
          </div>
          {error && <p className="input-hint input-hint--error">{error}</p>}
          <button className="btn-primary w-full mt-2" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
      </div>
    </div>
  );
}
