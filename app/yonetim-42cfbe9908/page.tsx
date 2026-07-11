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
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');

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
      const data = (await res.json().catch(() => ({}))) as { error?: string; role?: string; name?: string; needsOtp?: boolean; phone?: string };
      if (data.needsOtp) {
        setMaskedPhone(data.phone || '');
        setOtpStep(true);
        setLoading(false);
        return;
      }
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

  async function submitOtp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setOtpError('');
    setOtpLoading(true);
    try {
      const verifyRes = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otpCode, username, role: 'superadmin' }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as { error?: string };
      if (!verifyRes.ok) { setOtpError(verifyData.error || 'Kod yanlış'); setOtpLoading(false); return; }

      const loginRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login', role: 'superadmin', username, password }),
      });
      const loginData = (await loginRes.json().catch(() => ({}))) as { error?: string; role?: string; name?: string };
      if (!loginRes.ok || loginData.role !== 'superadmin') { setOtpError(loginData.error || 'Giriş başarısız'); setOtpLoading(false); return; }
      setSession({ role: 'superadmin', id: 'superadmin', name: loginData.name });
    } catch {
      setOtpError('Bağlantı hatası.');
      setOtpLoading(false);
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
    setOtpStep(false);
    setOtpCode('');
    setMaskedPhone('');
    setOtpError('');
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

  // 2FA adımı — telefon kayıtlıysa ve cihaz tanınmıyorsa
  if (otpStep) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-base)' }}>
        <div className="card-elevated w-full max-w-sm p-8">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'color-mix(in srgb, #0f172a 15%, transparent)' }}>
              <span style={{ fontSize: 28 }}>📱</span>
            </div>
            <h1 className="text-lg font-700 mb-1" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Kimliğini doğrula</h1>
            <p className="text-body-sm">
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{maskedPhone}</span> numaralı telefona SMS gönderdik.
            </p>
            <p className="text-caption mt-1">Gelen kodu girin</p>
          </div>
          <form onSubmit={submitOtp} className="space-y-4">
            <input
              className={`input text-center text-2xl tracking-widest ${otpError ? 'input-error' : ''}`}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              maxLength={6}
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, ''))}
              autoFocus
              required
            />
            {otpError && <p className="input-hint input-hint--error">{otpError}</p>}
            <button className="btn-primary w-full" disabled={otpLoading || otpCode.length < 4}>
              {otpLoading ? 'Doğrulanıyor…' : 'Doğrula ve Giriş Yap'}
            </button>
          </form>
          <button onClick={() => { setOtpStep(false); setOtpCode(''); setOtpError(''); }}
            className="mt-4 w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ← Geri dön
          </button>
        </div>
      </div>
    );
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
