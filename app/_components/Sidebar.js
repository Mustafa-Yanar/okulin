'use client';

import React, { useEffect } from 'react';
import {
  Users, Compass, ClipboardList, Wallet, BookOpen, Bell,
  CreditCard, TrendingDown, ChevronLeft, ChevronRight,
  BookMarked, Calendar, CalendarDays, GraduationCap, Star, Clock, Settings, LayoutGrid, Contact, NotebookPen, ListChecks, UserPlus, Award,
} from 'lucide-react';
import { brandGradient } from '@/lib/branding';
import ThemeToggle from './ThemeToggle';
import NotificationButton from './NotificationButton';

// ─── Sekme tanımları (rol bazlı) ────────────────────────────────────────────────

const ITEMS_BY_ROLE = {
  director: [
    { group: 'Akademik', key: 'teachers',    label: 'Öğretmen',          icon: Users },
    { group: 'Akademik', key: 'students',    label: 'Sınıf/Öğrenci',     icon: GraduationCap },
    { group: 'Akademik', key: 'rehberlik',   label: 'Rehberlik',         icon: Compass },
    { group: 'Akademik', key: 'veliler',     label: 'Veli',              icon: Contact },
    { group: 'Akademik', key: 'onkayit',     label: 'Ön Kayıt',          icon: UserPlus },
    { group: 'Finans',   key: 'muhasebe',    label: 'Muhasebe',          icon: Wallet },
    { group: 'Sistem',   key: 'kutuphane',   label: 'Kütüphane',         icon: BookOpen },
    { group: 'Sistem',   key: 'duyurular',   label: 'Duyurular',         icon: Bell },
    { group: 'Sistem',   key: 'takvim',      label: 'Etkinlik Takvimi',  icon: CalendarDays },
    { group: 'Sistem',   key: 'formlar',     label: 'Formlar',           icon: ListChecks },
    { group: 'Sistem',   key: 'ders-saatleri', label: 'Ders Saatleri',   icon: Clock },
    { group: 'Sistem',   key: 'ders-programi', label: 'Ders Programı Oluştur', icon: LayoutGrid },
  ],
  counselor: [
    { group: 'Akademik', key: 'teachers',    label: 'Öğretmen',          icon: Users },
    { group: 'Akademik', key: 'students',    label: 'Sınıf/Öğrenci',     icon: GraduationCap },
    { group: 'Akademik', key: 'rehberlik',   label: 'Rehberlik',         icon: Compass },
    { group: 'Akademik', key: 'veliler',     label: 'Veli',              icon: Contact },
    { group: 'Akademik', key: 'onkayit',     label: 'Ön Kayıt',          icon: UserPlus },
    { group: 'Sistem',   key: 'kutuphane',   label: 'Kütüphane',         icon: BookOpen },
    { group: 'Sistem',   key: 'duyurular',   label: 'Duyurular',         icon: Bell },
    { group: 'Sistem',   key: 'takvim',      label: 'Etkinlik Takvimi',  icon: CalendarDays },
    { group: 'Sistem',   key: 'formlar',     label: 'Formlar',           icon: ListChecks },
    { group: 'Sistem',   key: 'ders-programi', label: 'Ders Programı Oluştur', icon: LayoutGrid },
  ],
  accountant: [
    { group: 'Finans',   key: 'finance',     label: 'Öğrenci Ödemeleri', icon: CreditCard },
    { group: 'Finans',   key: 'expenses',    label: 'Giderler',          icon: TrendingDown },
  ],
  teacher: [
    { group: null,       key: 'rezervasyon', label: 'Program',           icon: Calendar },
    { group: null,       key: 'yoklama',     label: 'Yoklama',           icon: ClipboardList },
    { group: null,       key: 'odev',        label: 'Ödevler',           icon: NotebookPen },
    { group: null,       key: 'davranis',    label: 'Davranış',          icon: Award },
    { group: null,       key: 'ogrenciler',  label: 'Öğrenciler',        icon: Users },
    { group: null,       key: 'kutuphane',   label: 'Kütüphane',         icon: BookOpen },
    { group: null,       key: 'duyurular',   label: 'Duyurular',         icon: Bell },
    { group: null,       key: 'takvim',      label: 'Takvim',            icon: CalendarDays },
    { group: null,       key: 'formlar',     label: 'Anketler',          icon: ListChecks },
  ],
  student: [
    { group: null,       key: 'available',   label: 'Müsait Etütler',    icon: Calendar },
    { group: null,       key: 'myBookings',  label: 'Etütlerim',         icon: BookMarked },
    { group: null,       key: 'odev',        label: 'Ödevlerim',         icon: NotebookPen },
    { group: null,       key: 'davranis',    label: 'Davranışım',        icon: Award },
    { group: null,       key: 'rehberlik',   label: 'Rehberlik',         icon: Compass },
    { group: null,       key: 'kutuphane',   label: 'Kütüphane',         icon: BookOpen },
    { group: null,       key: 'duyurular',   label: 'Duyurular',         icon: Bell },
    { group: null,       key: 'takvim',      label: 'Takvim',            icon: CalendarDays },
    { group: null,       key: 'formlar',     label: 'Anketler',          icon: ListChecks },
  ],
  parent: [
    { group: null,       key: 'program',     label: 'Program',           icon: Calendar },
    { group: null,       key: 'odev',        label: 'Ödevler',           icon: NotebookPen },
    { group: null,       key: 'davranis',    label: 'Davranış',          icon: Award },
    { group: null,       key: 'odeme',       label: 'Ödeme',             icon: Wallet },
    { group: null,       key: 'rehberlik',   label: 'Rehberlik',         icon: Star },
    { group: null,       key: 'duyurular',   label: 'Duyurular',         icon: Bell },
    { group: null,       key: 'takvim',      label: 'Takvim',            icon: CalendarDays },
  ],
};

function buildItems(role) {
  return ITEMS_BY_ROLE[role] || [];
}

// ─── Nav öğesi ─────────────────────────────────────────────────────────────────

function NavItem({ item, active, collapsed, onClick }) {
  const Icon = item.icon;
  return (
    <button
      title={collapsed ? item.label : undefined}
      onClick={() => onClick(item.key)}
      aria-current={active ? 'page' : undefined}
      className={`
        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all
        ${active ? 'nav-item-active' : 'hover:bg-[var(--bg-muted)]'}
        ${collapsed ? 'justify-center' : ''}
      `}
      style={{ fontWeight: active ? 600 : 500, color: active ? undefined : 'var(--text-secondary)' }}
    >
      <Icon size={18} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </button>
  );
}

// ─── Ana Sidebar ───────────────────────────────────────────────────────────────

export default function Sidebar({
  session,
  branding,
  activeTab,
  onTabChange,
  collapsed,
  onCollapse,
  mobileOpen,
  onMobileClose,
  showToast,
  onSettings,
}) {
  const items = buildItems(session?.role);

  // Grup akordeon durumu (yalnız gruplu roller: müdür/rehber). Varsayılan: hepsi açık.
  // false = kapalı; absent/true = açık. localStorage'da kalıcı, oturumlar arası korunur.
  const [openGroups, setOpenGroups] = React.useState({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem('okulin:sidebarGroups');
      if (raw) setOpenGroups(JSON.parse(raw));
    } catch {}
  }, []);
  const isGroupOpen = (g) => openGroups?.[g] !== false;
  const toggleGroup = (g) => {
    setOpenGroups(prev => {
      const cur = prev || {};
      const next = { ...cur, [g]: cur[g] === false ? true : false };
      try { localStorage.setItem('okulin:sidebarGroups', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [mobileOpen]);

  const groups = [];
  const seen = new Set();
  for (const item of items) {
    const g = item.group || '__top__';
    if (!seen.has(g)) { seen.add(g); groups.push(g); }
  }

  function handleTabClick(key) {
    onTabChange(key);
    onMobileClose?.();
  }

  const sidebarContent = (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-surface)' }}>
      {/* Logo / kurum adı + zil */}
      <div
        className={`flex items-center h-14 shrink-0 px-3 ${collapsed ? 'justify-center' : 'gap-2'}`}
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {/* Logo */}
        {branding?.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={branding.name}
            className={`object-contain shrink-0 ${collapsed ? 'h-8 w-8' : 'h-9 w-auto max-w-[100px]'}`}
            onError={e => { e.currentTarget.style.display = 'none'; }}
          />
        ) : (
          <div
            className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: brandGradient(branding?.themeColor) }}
          >
            <BookMarked size={16} color="white" />
          </div>
        )}
        {/* Kurum adı + zil + kapat (collapsed'da gizli) */}
        {!collapsed && (
          <>
            <span className="text-sm leading-tight truncate flex-1 min-w-0" style={{ fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
              {branding?.shortName || 'okulin'}
            </span>
            <NotificationButton showToast={showToast} />
          </>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {groups.map(group => {
          const groupItems = items.filter(i => (i.group || '__top__') === group);
          const isTop = group === '__top__';
          const open = isGroupOpen(group);
          return (
            <div key={group}>
              {/* Gruplu + geniş mod: tıklanabilir akordeon başlığı */}
              {!isTop && !collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group)}
                  aria-expanded={open}
                  className="w-full flex items-center justify-between px-3 pt-3 pb-1 rounded-lg hover:bg-[var(--bg-muted)] transition-colors"
                >
                  <span className="text-[10px] uppercase tracking-widest"
                    style={{ fontWeight: 700, color: 'var(--text-muted)' }}>
                    {group}
                  </span>
                  <ChevronRight size={12}
                    style={{ color: 'var(--text-muted)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
                </button>
              )}
              {/* Daraltılmış (ikon rayı) mod: akordeon yok, sadece ayraç */}
              {!isTop && collapsed && (
                <div className="my-2" style={{ borderTop: '1px solid var(--border-subtle)' }} />
              )}
              {(isTop || collapsed || open) && groupItems.map(item => (
                <NavItem
                  key={item.key}
                  item={item}
                  active={activeTab === item.key}
                  collapsed={collapsed}
                  onClick={handleTabClick}
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* Alt: Ayarlar + Theme toggle */}
      <div className="shrink-0 px-3 pb-4">
        <div className="pt-3 space-y-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {onSettings && (
            <button
              onClick={() => { onSettings(); onMobileClose?.(); }}
              title={collapsed ? 'Ayarlar' : undefined}
              aria-current={activeTab === 'ayarlar' ? 'page' : undefined}
              className={`
                w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all
                ${activeTab === 'ayarlar' ? 'nav-item-active' : 'hover:bg-[var(--bg-muted)]'}
                ${collapsed ? 'justify-center' : ''}
              `}
              style={{ fontWeight: activeTab === 'ayarlar' ? 600 : 500, color: activeTab === 'ayarlar' ? undefined : 'var(--text-secondary)' }}
            >
              <Settings size={18} className="shrink-0" />
              {!collapsed && <span className="truncate">Ayarlar</span>}
            </button>
          )}
          <ThemeToggle collapsed={collapsed} />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Masaüstü sidebar */}
      <aside
        className={`sidebar relative hidden md:flex flex-col h-screen sticky top-0 shrink-0 z-30 ${collapsed ? 'w-16' : 'w-64'}`}
        style={{ borderRight: '1px solid var(--border-subtle)' }}
      >
        {sidebarContent}
        {/* Sağ kenarda daralt/genişlet tutamağı (Canva tarzı dikey pill) */}
        <button
          onClick={onCollapse}
          title={collapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
          aria-label={collapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
          className="sidebar-toggle"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-muted)',
          }}
        >
          {collapsed ? <ChevronRight size={16} strokeWidth={2.5} /> : <ChevronLeft size={16} strokeWidth={2.5} />}
        </button>
      </aside>

      {/* Mobil overlay drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onMobileClose} aria-hidden="true" />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full flex flex-col shadow-2xl animate-slide-in-left">
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
