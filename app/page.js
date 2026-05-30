'use client';

import React, { useState, useEffect } from 'react';
import {
  BookOpen, LogOut, User, BookMarked, GraduationCap, Shield, Settings, Wallet
} from 'lucide-react';
import StudentPanel from './_components/StudentPanel';
import TeacherPanel from './_components/TeacherPanel';
import AccountantPanel from './_components/AccountantPanel';
import DirectorPanel, { DirectorSettingsModal } from './_components/DirectorPanel';
import ChangePasswordModal from './_components/ChangePasswordModal';
import ForcedPasswordChange from './_components/ForcedPasswordChange';
import NotificationButton from './_components/NotificationButton';
import { SlotTimesProvider, useSlotTimes } from './_components/SlotTimesContext';
import { ErrorBoundary, GlobalErrorListener } from './_components/ErrorBoundary';

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
function LoginScreen({ onLogin, directorExists, showToast }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode] = useState(directorExists ? 'login' : 'setup');

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'setup') {
        await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'setup_director', username, password, name }) });
        showToast('Müdür hesabı oluşturuldu');
        const status = await api('/api/auth');
        onLogin(status.session);
      } else {
        const data = await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'login', username, password }) });
        onLogin(data);
      }
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="card-elevated w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}>
            <BookOpen size={28} color="white" />
          </div>
          <h1 className="text-2xl font-800 text-gray-900" style={{ fontWeight: 800 }}>Etüt Takip</h1>
          <p className="text-sm text-gray-500 mt-1">{mode === 'setup' ? 'Müdür hesabı oluşturun' : 'Hesabınıza giriş yapın'}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === 'setup' && (
            <FormField label="Ad Soyad">
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Gökhan Özyurt" required />
            </FormField>
          )}
          <FormField label="Kullanıcı Adı">
            <input className="input" value={username} onChange={e => setUsername(e.target.value)} placeholder="kullanici_adi" required />
          </FormField>
          <FormField label="Şifre">
            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
          </FormField>
          <button className="btn-primary w-full mt-2" disabled={loading}>
            {loading ? 'Lütfen bekleyin...' : mode === 'setup' ? 'Hesap Oluştur' : 'Giriş Yap'}
          </button>
        </form>
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

function AppContent() {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);
  const [directorExists, setDirectorExists] = useState(false);
  const [toast, setToast] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showDirectorName, setShowDirectorName] = useState(false);
  const { updateSlotTimes } = useSlotTimes();

  useEffect(() => {
    (async () => {
      try {
        const status = await api('/api/auth');
        setDirectorExists(status.directorExists);
        if (status.session) {
          setSession(status.session);
          // Slot saatlerini Context'e yükle
          try {
            const times = await api('/api/slot-times');
            updateSlotTimes(times);
          } catch {}
        }
      } catch {}
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <><LoginScreen directorExists={directorExists} onLogin={async (s) => {
      setSession(s);
      try {
        const times = await api('/api/slot-times');
        updateSlotTimes(times);
      } catch {}
    }} showToast={showToast} /><Toast toast={toast} /></>
  );

  // Zorunlu şifre değiştirme: ilk giriş veya müdür sıfırlamasından sonra
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

  const roleLabel = { director:'Müdür', teacher:'Öğretmen', student:'Öğrenci', accountant:'Muhasebeci' };
  const roleColor = { director:'#6366f1', teacher:'#22c55e', student:'#f59e0b', accountant:'#0891b2' };
  const RoleIcon = { director:Shield, teacher:BookMarked, student:GraduationCap, accountant:Wallet };
  const Icon = RoleIcon[session.role] || User;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/logo.png" alt="Akyazı Çözüm Özel Öğretim Kursu"
              className="h-[52px] w-auto object-contain shrink-0"
              onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            <span className="font-800 text-gray-900 text-sm sm:text-base leading-tight truncate" style={{ fontWeight:800 }}>Akyazı Çözüm Özel Öğretim Kursu</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background:'#f3f4f6' }}>
              <Icon size={14} style={{ color:roleColor[session.role] }} />
              <span className="text-sm font-600 text-gray-700" style={{ fontWeight:600 }}>{session.name}</span>
              <span className="text-sm font-500 text-gray-400" style={{ fontWeight:500 }}>{roleLabel[session.role]}</span>
            </div>
            <NotificationButton showToast={showToast} />
            {(session.role === 'teacher' || session.role === 'student') && (
              <button onClick={() => setShowChangePassword(true)} title="Şifremi Değiştir" className="btn-ghost !px-3 !py-2">
                <Settings size={14} />
              </button>
            )}
            {session.role === 'director' && (
              <button onClick={() => setShowDirectorName(true)} title="Ayarlar" className="btn-ghost !px-3 !py-2">
                <Settings size={14} />
              </button>
            )}
            <button onClick={logout} className="btn-ghost !px-3 !py-2"><LogOut size={14} /></button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {session.role==='director' && <DirectorPanel session={session} showToast={showToast} />}
        {session.role==='teacher' && <TeacherPanel session={session} showToast={showToast} />}
        {session.role==='student' && <StudentPanel session={session} showToast={showToast} />}
        {session.role==='accountant' && <AccountantPanel session={session} showToast={showToast} />}
      </main>
      {showChangePassword && (
        <ChangePasswordModal showToast={showToast} onClose={() => setShowChangePassword(false)} />
      )}
      {showDirectorName && (
        <DirectorSettingsModal current={session.name} showToast={showToast}
          onClose={() => setShowDirectorName(false)}
          onSave={newName => setSession(s => ({ ...s, name: newName }))} />
      )}
      <Toast toast={toast} />
    </div>
  );
}
