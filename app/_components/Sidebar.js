'use client';

import React, { useEffect } from 'react';
import {
  Home, Users, Compass, ClipboardList, Wallet, BookOpen, Bell,
  BarChart2, CreditCard, TrendingDown, ChevronLeft, ChevronRight,
  X, BookMarked,
} from 'lucide-react';
import { brandGradient } from '@/lib/branding';
import ThemeToggle from './ThemeToggle';

// ─── Sekme tanımları ────────────────────────────────────────────────────────────

const DIRECTOR_ITEMS = [
  { group: null,       key: 'overview',    label: 'Genel Bakış',    icon: Home },
  { group: 'Akademik', key: 'teachers',    label: 'Öğretmenler',    icon: Users },
  { group: 'Akademik', key: 'students',    label: 'Rehberlik',      icon: Compass },
  { group: 'Akademik', key: 'yoklama',     label: 'Yoklama',        icon: ClipboardList },
  { group: 'Akademik', key: 'denemeler',   label: 'Denemeler',      icon: BarChart2,  directorOnly: true },
  { group: 'Finans',   key: 'muhasebe',    label: 'Muhasebe',       icon: Wallet,     directorOnly: true },
  { group: 'Sistem',   key: 'kutuphane',   label: 'Kütüphane',      icon: BookOpen },
  { group: 'Sistem',   key: 'duyurular',   label: 'Duyurular',      icon: Bell },
];

const ACCOUNTANT_ITEMS = [
  { group: 'Finans',   key: 'finance',     label: 'Öğrenci Ödemeleri', icon: CreditCard },
  { group: 'Finans',   key: 'expenses',    label: 'Giderler',           icon: TrendingDown },
  { group: 'Yönetim',  key: 'accountants', label: 'Muhasebeciler',      icon: Users },
];

function buildItems(role) {
  if (role === 'accountant') return ACCOUNTANT_ITEMS;
  return DIRECTOR_ITEMS.filter(i => !i.directorOnly || role === 'director');
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
        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-500 transition-all
        ${active
          ? 'nav-item-active'
          : 'hover:bg-[var(--bg-muted)]'
        }
        ${collapsed ? 'justify-center' : ''}
      `}
      style={{
        fontWeight: 500,
        color: active ? undefined : 'var(--text-secondary)',
      }}
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
}) {
  const items = buildItems(session?.role);

  // Mobil açıkken body scroll kilitleme
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [mobileOpen]);

  // Grupları çıkar (sıralamayı koruyarak)
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
      {/* Logo / kurum adı */}
      <div
        className={`flex items-center gap-2.5 px-4 h-14 shrink-0 ${collapsed ? 'justify-center' : ''}`}
        style={{ borderBottom: '1px solid var(--border-subtle)' }}
      >
        {branding?.logoUrl ? (
          <img
            src={branding.logoUrl}
            alt={branding.name}
            className={`object-contain ${collapsed ? 'h-8 w-8' : 'h-9 w-auto max-w-[120px]'}`}
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
        {!collapsed && (
          <span
            className="text-sm leading-tight truncate"
            style={{ fontWeight: 700, color: 'var(--text-primary)' }}
          >
            {branding?.shortName || 'Etüt Takip'}
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {groups.map(group => {
          const groupItems = items.filter(i => (i.group || '__top__') === group);
          return (
            <div key={group}>
              {group !== '__top__' && !collapsed && (
                <p
                  className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest"
                  style={{ fontWeight: 700, color: 'var(--text-muted)' }}
                >
                  {group}
                </p>
              )}
              {group !== '__top__' && collapsed && (
                <div className="my-2" style={{ borderTop: '1px solid var(--border-subtle)' }} />
              )}
              {groupItems.map(item => (
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

      {/* Alt: Theme toggle + Collapse toggle (yalnız masaüstü) */}
      <div className="shrink-0 px-3 pb-4 hidden md:block">
        <div className="pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <ThemeToggle collapsed={collapsed} />
          <button
            onClick={onCollapse}
            title={collapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
            className="mt-1 w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all hover:bg-[var(--bg-muted)]"
            style={{
              color: 'var(--text-muted)',
              justifyContent: collapsed ? 'center' : undefined,
            }}
          >
            {collapsed
              ? <ChevronRight size={16} />
              : <><ChevronLeft size={16} /><span className="text-xs">Daralt</span></>
            }
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Masaüstü sidebar */}
      <aside
        className={`sidebar hidden md:flex flex-col h-screen sticky top-0 shrink-0 ${collapsed ? 'w-16' : 'w-64'}`}
        style={{ borderRight: '1px solid var(--border-subtle)' }}
      >
        {sidebarContent}
      </aside>

      {/* Mobil overlay drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-72 max-w-[85vw] h-full flex flex-col shadow-2xl animate-slide-in-left">
            <button
              onClick={onMobileClose}
              aria-label="Menüyü kapat"
              className="absolute top-3 right-3 p-2 rounded-lg z-10 hover:bg-[var(--bg-muted)]"
              style={{ color: 'var(--text-secondary)' }}
            >
              <X size={18} />
            </button>
            {sidebarContent}
          </aside>
        </div>
      )}
    </>
  );
}
