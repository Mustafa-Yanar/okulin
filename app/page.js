'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, LogOut, User, BookMarked, GraduationCap, Shield, Settings, Wallet, Users, Compass, Menu, Bell,
} from 'lucide-react';
import StudentPanel from './_components/StudentPanel';
import TeacherPanel from './_components/TeacherPanel';
import AccountantPanel from './_components/AccountantPanel';
import ParentPanel from './_components/ParentPanel';
import SuperAdminPanel from './_components/SuperAdminPanel';
import OrgAdminPanel from './_components/OrgAdminPanel';
import DirectorPanel, { DirectorSettingsModal } from './_components/DirectorPanel';
import ChangePasswordModal from './_components/ChangePasswordModal';
import ForcedPasswordChange from './_components/ForcedPasswordChange';
import NotificationButton from './_components/NotificationButton';
import Sidebar from './_components/Sidebar';
import KPICards from './_components/KPICards';
import { SlotTimesProvider, useSlotTimes } from './_components/SlotTimesContext';
import { ErrorBoundary, GlobalErrorListener } from './_components/ErrorBoundary';
import { BRANDING_DEFAULTS, brandGradient } from '@/lib/branding';

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

function Toast({ toast }) {
  if (!toast) return null;
  const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-indigo-500' };
  return (
    <div className={`fixed bottom-6 left-1/2 z-50 animate-fade-up px-5 py-3 rounded-xl text-white text-sm font-medium shadow-xl -translate-x-1/2 ${colors[toast.type] || colors.success}`}>
      {toast.msg}
    </div>
  );
}

function Label({ children, htmlFor }) {
  return <label htmlFor={htmlFor} className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>{children}</label>;
}
function FormField({ label, children }) {
  const id = React.useId();
  let associatedId;
  const content = React.Children.map(children, child => {
    if (!associatedId && React.isValidElement(child) && !child.props.id) {
      associatedId = id;
      return React.cloneElement(child, { id });
    }
    return child;
  });
  return <div className="mb-4"><Label htmlFor={associatedId}>{label}</Label>{content}</div>;
}

// ─── LOGIN SCREEN ──────────────────────────────────────────────────────────────
const LOGIN_ROLES = [
  { key: 'student',    label: 'Öğrenci',  desc: 'Öğrenci girişi',   icon: GraduationCap, field: 'Kullanıcı Adı', placeholder: 'kullanici_adi',  type: 'text' },
  { key: 'parent',     label: 'Veli',     desc: 'Veli girişi',      icon: Users,         field: 'Telefon',       placeholder: '05XX XXX XX XX', type: 'tel'  },
  { key: 'teacher',    label: 'Öğretmen', desc: 'Öğretmen girişi',  icon: BookMarked,    field: 'Kullanıcı Adı', placeholder: 'kullanici_adi',  type: 'text' },
  { key: 'management', label: 'Yönetim',  desc: 'Müdür / Muhasebe',  icon: Shield,        field: 'Kullanıcı Adı', placeholder: 'kullanici_adi',  type: 'text' },
];

function BrandHeader({ branding, subtitle }) {
  return (
    <div className="text-center mb-7">
      {branding?.logoUrl ? (
        <img src={branding.logoUrl} alt={branding.name}
          className="h-16 w-auto object-contain mx-auto mb-4"
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : (
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: brandGradient(branding?.themeColor) }}>
          <BookOpen size={28} color="white" />
        </div>
      )}
      <h1 className="text-2xl font-800 text-gray-900" style={{ fontWeight: 800 }}>{branding?.shortName || 'Etüt Takip'}</h1>
      <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
    </div>
  );
}

function LoginScreen({ onLogin, directorExists, showToast, branding }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRole, setSelectedRole] = useState(null);
  const isSetup = !directorExists;
  const current = LOGIN_ROLES.find(r => r.key === selectedRole);

  const submitSetup = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'setup_director', username, password, name }) });
      showToast('Müdür hesabı oluşturuldu');
      const status = await api('/api/auth');
      onLogin(status.session);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ action: 'login', username, password, role: selectedRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.correctRole && data.correctRole !== selectedRole) {
          setSelectedRole(data.correctRole);
        }
        throw new Error(data.error || 'Giriş başarısız');
      }
      onLogin(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
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
              {loading ? 'Lütfen bekleyin...' : 'Hesap Oluştur'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!selectedRole) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="card-elevated w-full max-w-md p-8">
          <BrandHeader branding={branding} subtitle="Giriş için kim olduğunuzu seçin" />
          <div className="grid grid-cols-2 gap-3">
            {LOGIN_ROLES.map(r => {
              const Icon = r.icon;
              return (
                <button key={r.key} onClick={() => { setSelectedRole(r.key); setUsername(''); setPassword(''); }}
                  className="group flex flex-col items-center gap-2 p-5 rounded-2xl border-2 border-gray-100 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white transition-transform group-hover:scale-105"
                    style={{ background: brandGradient(branding?.themeColor) }}>
                    <Icon size={22} />
                  </div>
                  <span className="font-700 text-gray-800 text-sm" style={{ fontWeight: 700 }}>{r.label}</span>
                  <span className="text-[11px] text-gray-400 -mt-1">{r.desc}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const Icon = current.icon;
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-elevated w-full max-w-sm p-8">
        <BrandHeader branding={branding} subtitle={`${current.label} girişi`} />
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white" style={{ background: brandGradient(branding?.themeColor) }}>
            <Icon size={17} />
          </div>
          <span className="font-700 text-gray-700" style={{ fontWeight: 700 }}>{current.label}</span>
        </div>
        <form onSubmit={submitLogin} className="space-y-4">
          <FormField label={current.field}>
            <input className="input" type={current.type} value={username} onChange={e => setUsername(e.target.value)} placeholder={current.placeholder} required autoFocus />
          </FormField>
          <FormField label="Şifre">
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </FormField>
          <button className="btn-primary w-full mt-2" disabled={loading}>
            {loading ? 'Lütfen bekleyin...' : 'Giriş Yap'}
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


// ─── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <GlobalErrorListener />
      <SlotTimesProvider>
        <AppContent />
      </SlotTimesProvider>
    </ErrorBoundary>
  );
}

// Sidebar layout kullanan roller
const SIDEBAR_ROLES = ['director', 'counselor', 'accountant'];

function AppContent() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [directorExists, setDirectorExists] = useState(false);
  const [branding, setBranding] = useState(BRANDING_DEFAULTS);
  const [toast, setToast] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDirectorName, setShowDirectorName] = useState(false);
  // KPI stats
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Aktif sekme (sidebar rolleri için)
  const [activeTab, setActiveTab] = useState(null);
  const { updateSlotTimes } = useSlotTimes();

  useEffect(() => {
    (async () => {
      try {
        const status = await api('/api/auth');
        setDirectorExists(status.directorExists);
        if (status.branding) {
          setBranding(status.branding);
          if (status.branding.themeColor) {
            document.documentElement.style.setProperty('--brand', status.branding.themeColor);
          }
        }
        if (status.session) {
          setSession(status.session);
          try {
            const times = await api('/api/slot-times');
            updateSlotTimes(times);
          } catch {}
          if (SIDEBAR_ROLES.includes(status.session.role)) {
            setStatsLoading(true);
            try {
              const s = await api('/api/stats');
              setStats(s);
            } catch {} finally {
              setStatsLoading(false);
            }
          }
        }
      } catch {}
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar tab'ı: URL'den oku (useUrlTab DirectorPanel içinde yönetir —
  // buradaki activeTab yalnızca Sidebar'ın vurgu göstermesi için).
  useEffect(() => {
    if (!session || !SIDEBAR_ROLES.includes(session.role)) return;
    const readTab = () => {
      const p = new URLSearchParams(window.location.search).get('sekme');
      if (p) setActiveTab(p);
    };
    readTab();
    window.addEventListener('popstate', readTab);
    return () => window.removeEventListener('popstate', readTab);
  }, [session]);

  const handleTabChange = useCallback((key) => {
    setActiveTab(key);
    // URL'e yaz — DirectorPanel'in useUrlTab ile senkron kalır
    const params = new URLSearchParams(window.location.search);
    params.set('sekme', key);
    window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
    // popstate tetiklemez (pushState), DirectorPanel mount'ta URL'i okur
  }, []);

  const handleCollapse = useCallback(() => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  }, []);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const logout = async () => {
    await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'logout' }) });
    setSession(null);
    showToast('Çıkış yapıldı');
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-400 text-sm">Yükleniyor...</div></div>;

  if (!session) return (
    <><LoginScreen directorExists={directorExists} branding={branding} onLogin={async (s) => {
      setSession(s);
      try {
        const times = await api('/api/slot-times');
        updateSlotTimes(times);
      } catch {}
    }} showToast={showToast} /><Toast toast={toast} /></>
  );

  if (session.role === 'org_admin') return (
    <><OrgAdminPanel session={session} onLogout={logout} /><Toast toast={toast} /></>
  );

  if (session.role === 'superadmin') return (
    <><SuperAdminPanel session={session} onLogout={logout} /><Toast toast={toast} /></>
  );

  if (session.mustChangePassword) return (
    <>
      <ForcedPasswordChange
        session={session}
        onDone={() => setSession(s => ({ ...s, mustChangePassword: false }))}
        onLogout={logout}
        showToast={showToast}
      />
      <Toast toast={toast} />
    </>
  );

  const isSidebarRole = SIDEBAR_ROLES.includes(session.role);

  // ── Sidebar layout (director / counselor / accountant) ──────────────────────
  if (isSidebarRole) {
    const roleLabel = { director: 'Müdür', accountant: 'Muhasebeci', counselor: 'Rehber' };
    const roleColor = { director: '#6366f1', accountant: '#0891b2', counselor: '#8b5cf6' };
    const RoleIcon = { director: Shield, accountant: Wallet, counselor: Compass };
    const RIcon = RoleIcon[session.role] || User;

    return (
      <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
        <Sidebar
          session={session}
          branding={branding}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          onLogout={logout}
          onSettings={() => setShowDirectorName(true)}
          collapsed={sidebarCollapsed}
          onCollapse={handleCollapse}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* TopBar */}
          <header className="h-14 flex items-center justify-between px-4 shrink-0 z-20"
            style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
            {/* Sol: hamburger (mobil) + kurum adı */}
            <div className="flex items-center gap-3 min-w-0">
              <button
                className="md:hidden p-2 rounded-lg hover:bg-[var(--bg-muted)]"
                style={{ color: 'var(--text-secondary)' }}
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Menüyü aç"
              >
                <Menu size={20} />
              </button>
              <span className="hidden md:block text-sm truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                {branding.name}
              </span>
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.name}
                  className="md:hidden h-8 w-auto object-contain"
                  onError={e => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <span className="md:hidden text-sm truncate" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {branding.shortName || 'Etüt Takip'}
                </span>
              )}
            </div>

            {/* Sağ: user chip + bildirim + ayarlar + çıkış */}
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-muted)' }}>
                <RIcon size={13} style={{ color: roleColor[session.role] }} />
                <span className="text-sm hidden sm:inline" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{session.name}</span>
                <span className="text-xs" style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{roleLabel[session.role]}</span>
              </div>
              <NotificationButton showToast={showToast} />
              <button onClick={() => setShowDirectorName(true)} title="Ayarlar" className="btn-ghost !px-2.5 !py-2">
                <Settings size={14} />
              </button>
              <button onClick={logout} aria-label="Çıkış yap" title="Çıkış yap" className="btn-ghost !px-2.5 !py-2">
                <LogOut size={14} />
              </button>
            </div>
          </header>

          {/* İçerik */}
          <main className="flex-1 overflow-y-auto p-4 sm:p-6">
            {(session.role === 'director' || session.role === 'counselor') && (
              <>
                <KPICards
                  stats={stats}
                  loading={statsLoading}
                  showFinance={session.role === 'director'}
                />
                <DirectorPanel
                  session={session}
                  showToast={showToast}
                  externalTab={activeTab}
                  onExternalTabChange={handleTabChange}
                />
              </>
            )}
            {session.role === 'accountant' && (
              <AccountantPanel session={session} showToast={showToast} externalTab={activeTab} />
            )}
          </main>
        </div>

        {showDirectorName && (
          <DirectorSettingsModal current={session.name} showToast={showToast}
            onClose={() => setShowDirectorName(false)}
            onSave={newName => setSession(s => ({ ...s, name: newName }))}
            onBranding={(b) => {
              setBranding(b);
              if (b.themeColor) document.documentElement.style.setProperty('--brand', b.themeColor);
            }} />
        )}
        <Toast toast={toast} />
      </div>
    );
  }

  // ── Klasik layout (teacher / student / parent) ───────────────────────────────
  const roleLabel = { teacher: 'Öğretmen', student: 'Öğrenci', parent: 'Veli' };
  const roleColor = { teacher: '#22c55e', student: '#f59e0b', parent: '#db2777' };
  const RoleIcon2 = { teacher: BookMarked, student: GraduationCap, parent: Users };
  const Icon2 = RoleIcon2[session.role] || User;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 shadow-sm"
        style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            {branding.logoUrl ? (
              <img src={branding.logoUrl} alt={branding.name}
                className="h-[52px] w-auto object-contain shrink-0"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ) : (
              <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: brandGradient(branding.themeColor) }}>
                <BookOpen size={18} color="white" />
              </div>
            )}
            <span className="text-sm sm:text-base leading-tight truncate" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{branding.name}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-muted)' }}>
              <Icon2 size={14} style={{ color: roleColor[session.role] }} />
              <span className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{session.name}</span>
              <span className="text-sm" style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{roleLabel[session.role]}</span>
            </div>
            <NotificationButton showToast={showToast} />
            <button onClick={() => setShowChangePassword(true)} title="Şifremi Değiştir" className="btn-ghost !px-3 !py-2">
              <Settings size={14} />
            </button>
            <button onClick={logout} aria-label="Çıkış yap" title="Çıkış yap" className="btn-ghost !px-3 !py-2"><LogOut size={14} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {session.role === 'teacher' && <TeacherPanel session={session} showToast={showToast} />}
        {session.role === 'student' && <StudentPanel session={session} showToast={showToast} />}
        {session.role === 'parent' && <ParentPanel session={session} showToast={showToast} />}
      </main>
      {showChangePassword && (
        <ChangePasswordModal showToast={showToast} onClose={() => setShowChangePassword(false)} />
      )}
      <Toast toast={toast} />
    </div>
  );
}
