'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { LogOut, User, BookMarked, GraduationCap, Shield, Settings, Wallet, Users, Compass, Menu } from 'lucide-react';
import StudentPanel from './StudentPanel';
import TeacherPanel from './TeacherPanel';
import AccountantPanel from './AccountantPanel';
import ParentPanel from './ParentPanel';
import OrgAdminPanel from './OrgAdminPanel';
import DirectorPanel, { DirectorSettingsInline } from './DirectorPanel';
import ChangePasswordModal from './ChangePasswordModal';
import ForcedPasswordChange from './ForcedPasswordChange';
import Sidebar from './Sidebar';
import Landing from './Landing';
import PullToRefreshIndicator from './PullToRefreshIndicator';
import { usePullToRefresh } from './usePullToRefresh';
import { isPushSupported, subscribeToPush } from '@/lib/push-client';
import { useSlotTimes } from './SlotTimesContext';
import { ClassesProvider } from './ClassesContext';
import { BRANDING_DEFAULTS } from '@/lib/branding';
import LoginScreen from './LoginScreen';
import { Toast } from './ui-components';
import { api } from './client-api';

const SIDEBAR_ROLES = ['director', 'counselor', 'accountant', 'teacher', 'student', 'parent'];
const APP_DOMAIN = process.env.NEXT_PUBLIC_APP_DOMAIN || 'okulin.com';

function isApexHost(host) {
  return host === APP_DOMAIN || host === `www.${APP_DOMAIN}`;
}

export default function AppContent() {
  const [loading, setLoading] = useState(true);
  const [isApex, setIsApex] = useState(undefined); // undefined=karar verilmedi
  const [session, setSession] = useState(null);
  const [directorExists, setDirectorExists] = useState(false);
  const [branding, setBranding] = useState(BRANDING_DEFAULTS);
  const [modules, setModules] = useState(null); // kurum modül aç/kapa; null=henüz yüklenmedi (hepsi açık varsay)
  const [etutCfg, setEtutCfg] = useState(null);  // etüt kuralları (self-rezervasyon vb.)
  const [toast, setToast] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  // Sidebar state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  // Aktif sekme (sidebar rolleri için)
  const [activeTab, setActiveTab] = useState(null);
  const { updateSlotTimes } = useSlotTimes();

  const handleRefresh = useCallback(async () => {
    window.location.reload();
  }, []);
  const { pullDistance, refreshState, setScrollContainerRef, setGestureContainerRef } = usePullToRefresh(handleRefresh);

  useEffect(() => {
    // Apex (okulin.com) → tanıtım sayfası; kurum verisi/oturum çekme.
    const apex = isApexHost(window.location.hostname);
    setIsApex(apex);
    if (apex) { setLoading(false); return; }
    (async () => {
      try {
        const status = await api('/api/auth');
        setDirectorExists(status.directorExists);
        if (status.modules) setModules(status.modules);
        if (status.etut) setEtutCfg(status.etut);
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
          // İlk girişte push izni iste — izin verilmişse sessiz, verilmemişse tarayıcı diyaloğu açılır
          if (isPushSupported()) {
            subscribeToPush().catch(() => {});
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

  if (loading || isApex === undefined) return <div className="min-h-screen flex items-center justify-center"><div className="text-gray-400 text-sm">Yükleniyor...</div></div>;

  // Apex (okulin.com) → tanıtım sayfası (kurum-bağımsız).
  if (isApex) return <Landing />;

  // Oturum yoksa VEYA süper-admin ise → kurum giriş ekranı. Süper-admin kurum-üstü
  // bir roldür; kurum adresinde (kökte) paneli açılmaz, normal giriş ekranı görünür.
  // Süper-admin paneli yalnız gizli /yonetim-... sayfasında render edilir (orası
  // kendi oturum kontrolünü yapar). Böylece kurum adresine gidince yoluna karışmaz.
  if (!session || session.role === 'superadmin') return (
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

  // ── Tüm roller: Sidebar layout ──────────────────────────────────────────────
  const roleLabel = { director: 'Müdür', counselor: 'Rehber', accountant: 'Muhasebeci', teacher: 'Öğretmen', student: 'Öğrenci', parent: 'Veli' };
  const roleColor = { director: '#6366f1', counselor: '#8b5cf6', accountant: '#0891b2', teacher: '#22c55e', student: '#f59e0b', parent: '#db2777' };
  const RoleIcon = { director: Shield, counselor: Compass, accountant: Wallet, teacher: BookMarked, student: GraduationCap, parent: Users };
  const RIcon = RoleIcon[session.role] || User;
  const isDirectorRole = session.role === 'director' || session.role === 'counselor';
  const canChangePassword = ['teacher', 'student', 'parent', 'counselor', 'accountant'].includes(session.role);

  return (
    <ClassesProvider>
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg-base)' }}>
      <Sidebar
        session={session}
        branding={branding}
        modules={modules}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        collapsed={sidebarCollapsed}
        onCollapse={handleCollapse}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
        showToast={showToast}
        onSettings={session.role === 'director' ? () => handleTabChange('ayarlar') : undefined}
      />

      <div ref={setGestureContainerRef} className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* TopBar */}
        <header className="h-14 flex items-center justify-between px-4 shrink-0 z-20"
          style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="btn-icon md:hidden"
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
                {branding.shortName || 'okulin'}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg" style={{ background: 'var(--bg-muted)' }}>
              <RIcon size={13} style={{ color: roleColor[session.role] }} />
              <span className="text-sm hidden sm:inline" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{session.name}</span>
              <span className="text-xs" style={{ fontWeight: 500, color: 'var(--text-muted)' }}>{roleLabel[session.role]}</span>
            </div>
            {canChangePassword && (
              <button onClick={() => setShowChangePassword(true)} title="Şifremi Değiştir" className="btn-ghost !px-2.5 !py-2">
                <Settings size={14} />
              </button>
            )}
            <button onClick={logout} aria-label="Çıkış yap" title="Çıkış yap" className="btn-ghost !px-2.5 !py-2">
              <LogOut size={14} />
            </button>
          </div>
        </header>

        {/* İçerik */}
        <main ref={setScrollContainerRef} className="flex-1 overflow-y-auto p-4 sm:p-6 relative">
          <PullToRefreshIndicator pullDistance={pullDistance} refreshState={refreshState} />
          {isDirectorRole && (
            <>
              {activeTab === 'ayarlar' && session.role === 'director' ? (
                <DirectorSettingsInline
                  current={session.name}
                  showToast={showToast}
                  onSave={newName => setSession(s => ({ ...s, name: newName }))}
                  onBranding={(b) => {
                    setBranding(b);
                    if (b.themeColor) document.documentElement.style.setProperty('--brand', b.themeColor);
                  }}
                />
              ) : (
                <DirectorPanel session={session} showToast={showToast} externalTab={activeTab} onExternalTabChange={handleTabChange} branding={branding} />
              )}
            </>
          )}
          {session.role === 'accountant' && (
            <AccountantPanel session={session} showToast={showToast} externalTab={activeTab} />
          )}
          {session.role === 'teacher' && (
            <TeacherPanel session={session} showToast={showToast} externalTab={activeTab} onExternalTabChange={handleTabChange} />
          )}
          {session.role === 'student' && (
            <StudentPanel session={session} showToast={showToast} externalTab={activeTab} onExternalTabChange={handleTabChange} selfBookingAllowed={etutCfg?.studentSelfBooking !== false} />
          )}
          {session.role === 'parent' && (
            <ParentPanel session={session} showToast={showToast} externalTab={activeTab} onExternalTabChange={handleTabChange} />
          )}
        </main>
      </div>

      {showChangePassword && (
        <ChangePasswordModal showToast={showToast} onClose={() => setShowChangePassword(false)} />
      )}
      <Toast toast={toast} />
    </div>
    </ClassesProvider>
  );
}
