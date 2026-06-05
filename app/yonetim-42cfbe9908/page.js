'use client';

// Gizli süper-admin giriş sayfası. URL yalnızca süper-admin tarafından bilinir.
// Normal kurum giriş ekranından (Yönetim kartı) süper-admin DENENMEZ — auth route
// superadmin'i yalnız role:'superadmin' ile (yani buradan) kontrol eder.
// Başarılı girişte oturum cookie'si kurulur, ana sayfa süper-admin paneline yönlendirir.

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';

export default function SuperAdminLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', role: 'superadmin', username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.role !== 'superadmin') {
        setError(data.error || 'Giriş başarısız.');
        setLoading(false);
        return;
      }
      // Oturum kuruldu → kök sayfaya git, App süper-admin panelini gösterir.
      window.location.href = '/';
    } catch {
      setError('Bağlantı hatası.');
      setLoading(false);
    }
  }

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
