import React, { useState } from 'react';
import { GraduationCap, Users, BookMarked, Shield } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BrandHeader, FormField } from './ui-components';
import { brandGradient, type Branding } from '@/lib/branding';
import { api } from './client-api';
import type { Session } from '@/lib/auth';
import type { ShowToast } from './types';

interface LoginRole {
  key: string;
  label: string;
  desc: string;
  icon: LucideIcon;
  field: string;
  placeholder: string;
  type: string;
}

const LOGIN_ROLES: LoginRole[] = [
  { key: 'student',    label: 'Öğrenci',  desc: 'Öğrenci girişi',   icon: GraduationCap, field: 'Kullanıcı Adı', placeholder: 'kullanici_adi',  type: 'text' },
  { key: 'parent',     label: 'Veli',     desc: 'Veli girişi',      icon: Users,         field: 'Telefon',       placeholder: '05XX XXX XX XX', type: 'tel'  },
  { key: 'teacher',    label: 'Öğretmen', desc: 'Öğretmen girişi',  icon: BookMarked,    field: 'Kullanıcı Adı', placeholder: 'kullanici_adi',  type: 'text' },
  { key: 'management', label: 'Yönetim',  desc: 'Müdür / Muhasebe',  icon: Shield,        field: 'Kullanıcı Adı', placeholder: 'kullanici_adi',  type: 'text' },
];

// POST /api/auth login yanıtı: başarıda session alanları, OTP akışında needsOtp/phone.
type LoginResponse = Session & { error?: string; correctRole?: string; needsOtp?: boolean; phone?: string };

interface LoginScreenProps {
  onLogin: (session: Session) => void;
  directorExists?: boolean;
  showToast: ShowToast;
  branding?: Branding | null;
}

export default function LoginScreen({ onLogin, directorExists, showToast, branding }: LoginScreenProps) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [otpStep, setOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const isSetup = !directorExists;
  const current = LOGIN_ROLES.find(r => r.key === selectedRole);

  const submitSetup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'setup_director', username, password, name }) });
      showToast('Müdür hesabı oluşturuldu');
      const status = await api<{ session: Session }>('/api/auth');
      onLogin(status.session);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const submitLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'login', username, password, role: selectedRole }),
      });
      const data = (await res.json().catch(() => ({}))) as LoginResponse;
      if (!res.ok) {
        if (data.correctRole && data.correctRole !== selectedRole) {
          setSelectedRole(data.correctRole);
        }
        throw new Error(data.error || 'Giriş başarısız');
      }
      if (data.needsOtp) {
        setMaskedPhone(data.phone || '');
        setOtpStep(true);
        return;
      }
      onLogin(data);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const submitOtp = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOtpLoading(true);
    try {
      const verifyRes = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code: otpCode, username, role: selectedRole }),
      });
      const verifyData = (await verifyRes.json().catch(() => ({}))) as { error?: string };
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Kod yanlış');

      const loginRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'login', username, password, role: selectedRole }),
      });
      const loginData = (await loginRes.json().catch(() => ({}))) as LoginResponse;
      if (!loginRes.ok) throw new Error(loginData.error || 'Giriş başarısız');
      onLogin(loginData);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setOtpLoading(false);
    }
  };

  if (isSetup) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card-elevated w-full max-w-sm p-8">
          <BrandHeader branding={branding} subtitle="Müdür hesabı oluşturun" />
          <form onSubmit={submitSetup} className="space-y-4">
            <FormField label="Ad Soyad">
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Gökhan Özyurt" required />
            </FormField>
            <FormField label="Kullanıcı Adı">
              <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="kullanici_adi" required />
            </FormField>
            <FormField label="Şifre">
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </FormField>
            <button className="btn-primary w-full mt-2" disabled={loading}>
              {loading ? 'Giriş yapılıyor…' : 'Hesap Oluştur'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (selectedRole && otpStep) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card-elevated w-full max-w-sm p-8">
          <BrandHeader branding={branding} subtitle="Kimliğini doğrula" />
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 15%, transparent)' }}>
              <span style={{ fontSize: 28 }}>📱</span>
            </div>
            <p className="text-body-sm">
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{maskedPhone}</span> numaralı telefona SMS gönderdik.
            </p>
            <p className="text-caption mt-1">Gelen kodu girin</p>
          </div>
          <form onSubmit={submitOtp} className="space-y-4">
            <input
              className="input text-center text-2xl tracking-widest"
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
            <button className="btn-primary w-full" disabled={otpLoading || otpCode.length < 4}>
              {otpLoading ? 'Doğrulanıyor…' : 'Doğrula ve Giriş Yap'}
            </button>
          </form>
          <button onClick={() => { setOtpStep(false); setOtpCode(''); }}
            className="mt-4 w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors">
            ← Geri dön
          </button>
        </div>
      </div>
    );
  }

  if (!selectedRole) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card-elevated w-full max-w-md p-8">
          <BrandHeader branding={branding} subtitle="Nasıl giriş yapacaksınız?" />
          <div className="grid grid-cols-2 gap-3">
            {LOGIN_ROLES.map(r => {
              const Icon = r.icon;
              return (
                <button key={r.key} onClick={() => { setSelectedRole(r.key); setUsername(''); setPassword(''); }}
                  className="role-card flex flex-col items-center gap-2.5 p-5 w-full">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white"
                    style={{ background: brandGradient(branding?.themeColor) }}>
                    <Icon size={22} />
                  </div>
                  <span className="text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{r.label}</span>
                  <span className="text-[11px]" style={{ color: 'var(--text-muted)', marginTop: -4 }}>{r.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const Icon = current!.icon;
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-elevated w-full max-w-sm p-8">
        <BrandHeader branding={branding} subtitle={`${current!.label} girişi`} />
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ background: brandGradient(branding?.themeColor) }}>
            <Icon size={17} />
          </div>
          <span className="font-700 text-gray-700" style={{ fontWeight: 700 }}>{current!.label}</span>
        </div>
        <form onSubmit={submitLogin} className="space-y-4">
          <FormField label={current!.field}>
            <input className="input" type={current!.type} value={username} onChange={e => setUsername(e.target.value)} placeholder={current!.placeholder} required autoFocus />
          </FormField>
          <FormField label="Şifre">
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </FormField>
          <button className="btn-primary w-full mt-2" disabled={loading}>
            {loading ? 'Giriş yapılıyor…' : 'Giriş Yap'}
          </button>
        </form>
        <button onClick={() => setSelectedRole(null)}
          className="mt-4 w-full text-center text-xs text-gray-400 hover:text-gray-600 transition-colors">
          ← Farklı rolle giriş
        </button>
      </div>
    </div>
  );
}
