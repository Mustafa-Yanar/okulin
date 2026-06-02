'use client';

import React from 'react';
import { GraduationCap, Users, Wallet, AlertCircle } from 'lucide-react';

function fmt(n) {
  return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function KPICard({ icon: Icon, label, value, sub, color, loading }) {
  return (
    <div className="card p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between">
        <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${color.bg}`}>
          <Icon size={17} className={color.icon} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 w-24 rounded-lg animate-pulse" style={{ background: 'var(--bg-muted)' }} />
      ) : (
        <div className="flex items-baseline gap-2">
          <span className="text-2xl" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{value}</span>
          {sub && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sub}</span>}
        </div>
      )}
    </div>
  );
}

const COLORS = {
  blue:   { bg: 'bg-blue-500/10',   icon: 'text-blue-500' },
  purple: { bg: 'bg-purple-500/10', icon: 'text-purple-500' },
  green:  { bg: 'bg-green-500/10',  icon: 'text-green-500' },
  orange: { bg: 'bg-orange-500/10', icon: 'text-orange-500' },
};

export default function KPICards({ stats, loading, showFinance = true }) {
  const cards = [
    {
      icon: GraduationCap,
      label: 'Aktif Öğrenci',
      value: loading ? '—' : String(stats?.studentCount ?? 0),
      color: COLORS.blue,
    },
    {
      icon: Users,
      label: 'Öğretmen',
      value: loading ? '—' : String(stats?.teacherCount ?? 0),
      color: COLORS.purple,
    },
    ...(showFinance ? [
      {
        icon: Wallet,
        label: 'Bu Ay Tahsilat',
        value: loading ? '—' : `₺${fmt(stats?.thisMonthCollection)}`,
        color: COLORS.green,
      },
      {
        icon: AlertCircle,
        label: 'Vadesi Geçen',
        value: loading ? '—' : `₺${fmt(stats?.pendingAmount)}`,
        sub: stats?.pendingAmount > 0 ? 'ödeme bekliyor' : undefined,
        color: COLORS.orange,
      },
    ] : []),
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {cards.map(card => (
        <KPICard key={card.label} {...card} loading={loading} />
      ))}
    </div>
  );
}
