'use client';

import React, { useEffect } from 'react';
import {
  Home, Users, Compass, ClipboardList, Wallet, BookOpen, Bell,
  BarChart2, CreditCard, TrendingDown, ChevronLeft, ChevronRight,
  X, BookMarked, Shield,
} from 'lucide-react';
import { brandGradient } from '@/lib/branding';

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
  // director ya da counselor
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
        ${active ? 'nav-item-active' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800'}
        ${collapsed ? 'justify-center' : ''}
      `}
      style={{ fontWeight: 500 }}
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
  onLogout,
  onSettings,
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
    <div className="flex flex-col h-full">
      {/* Logo / kurum adı */}
      <div className={`flex items-center gap-2.5 px-4 h-14 border-b border-gray-100 shrink-0 ${collapsed ? 'justify-center' : ''}`}>
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
          <span className="font-700 text-gray-900 text-sm leading-tight truncate" style={{ fontWeight: 700 }}>
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
                <p className="px-3 pt-3 pb-1 text-[10px] font-700 text-gray-400 uppercase tracking-widest"
                   style={{ fontWeight: 700 }}>
                  {group}
                </p>
              )}
              {group !== '__top__' && collapsed && <div className="my-2 border-t border-gray-100" />}
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

      {/* Alt: Collapse toggle (yalnız masaüstü) */}
      <div className="shrink-0 px-3 pb-4 hidden md:block">
        <div className="border-t border-gray-100 pt-3">
          <button
            onClick={onCollapse}
            title={collapsed ? 'Menüyü Genişlet' : 'Menüyü Daralt'}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"
            style={{ justifyContent: collapsed ? 'center' : undefined }}
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
        className={`sidebar hidden md:flex flex-col bg-white border-r border-gray-100 h-screen sticky top-0 shrink-0 ${collapsed ? 'w-16' : 'w-64'}`}
      >
        {sidebarContent}
      </aside>

      {/* Mobil overlay drawer */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onMobileClose}
            aria-hidden="true"
          />
          {/* Drawer */}
          <aside className="relative z-10 w-72 max-w-[85vw] bg-white h-full flex flex-col shadow-2xl animate-slide-in-left">
            {/* Kapat butonu */}
            <button
              onClick={onMobileClose}
              aria-label="Menüyü kapat"
              className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100 text-gray-500 z-10"
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
