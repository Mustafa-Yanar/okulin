'use client';

import React, { useState } from 'react';
import { Lock, LogOut, ShieldCheck } from 'lucide-react';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

// Zorunlu şifre değiştirme ekranı.
// İlk girişte (mustChangePassword:true) veya müdür şifre sıfırlamasından sonra gösterilir.
// Kapatılamaz — kullanıcı ya yeni şifre belirler ya çıkış yapar.
export default function ForcedPasswordChange({ session, onDone, onLogout, showToast }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next !== next2) { showToast('Yeni şifreler eşleşmiyor', 'error'); return; }
    if (next.length < 6) { showToast('Şifre en az 6 karakter olmalı', 'error'); return; }
    if (next === current) { showToast('Yeni şifre eskisinden farklı olmalı', 'error'); return; }
    setLoading(true);
    try {
      await api('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'change_password', password: current, newPassword: next }),
      });
      showToast('Şifreniz belirlendi, hoş geldiniz');
      onDone();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-elevated w-full max-w-md p-8">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
            <ShieldCheck size={28} color="white" />
          </div>
          <h1 className="text-xl" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>Hoş geldin, {session.name}</h1>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            Devam etmeden önce kendine ait yeni bir şifre belirlemen gerekiyor.
            Bu adımı atlayamazsın — yeni şifreni iki kez yazıp kaydet.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Sana verilen geçici şifre
            </label>
            <input
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Karttaki / liste şifresi"
              aria-label="Sana verilen geçici şifre"
              required
              autoFocus
              autoComplete="current-password"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Yeni şifre
            </label>
            <input
              className="input"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              placeholder="En az 6 karakter"
              aria-label="Yeni şifre"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wide mb-1.5" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
              Yeni şifre (tekrar)
            </label>
            <input
              className="input"
              type="password"
              value={next2}
              onChange={(e) => setNext2(e.target.value)}
              placeholder="Aynısını tekrar yaz"
              aria-label="Yeni şifre (tekrar)"
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          <button
            type="submit"
            className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
            disabled={loading}
          >
            <Lock size={16} />
            {loading ? 'Kaydediliyor...' : 'Şifremi belirle ve devam et'}
          </button>
        </form>

        <div className="mt-6 pt-4 text-center" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Şifreni bilmiyorsan ya da bir sorun yaşıyorsan</p>
          <button
            onClick={onLogout}
            className="text-xs inline-flex items-center gap-1 hover:opacity-75 transition-opacity"
            style={{ color: 'var(--text-secondary)' }}
          >
            <LogOut size={12} />
            Çıkış yap ve müdüre başvur
          </button>
        </div>
      </div>
    </div>
  );
}
