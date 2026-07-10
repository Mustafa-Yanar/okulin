'use client';

import React from 'react';
import { GraduationCap, Users, Wallet, AlertCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

// GET /api/stats yanıt şekli (app/api/stats/route.ts) — types.ts'te yok, yerel tanım.
interface StatsData {
  studentCount: number;
  teacherCount: number;
  thisMonthCollection: number;
  pendingAmount: number;
}

// COLORS girdisi: kart ikon kutusunun arkaplan + ikon renk sınıfları.
interface ColorPair {
  bg: string;
  icon: string;
}

function fmt(n: number | undefined): string {
  return (n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

interface KPICardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  color: ColorPair;
  loading?: boolean;
}

function KPICard({ icon: Icon, label, value, sub, color, loading }: KPICardProps) {
  return (
    <div className="card card-hover p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-label mb-0.5">{label}</p>
          {loading ? (
            <div className="h-7 w-20 skeleton mt-1" />
          ) : (
            <div className="flex items-baseline gap-1.5 mt-1">
              <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>{value}</span>
              {sub && <span className="text-caption">{sub}</span>}
            </div>
          )}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color.bg}`}>
          <Icon size={18} className={color.icon} />
        </div>
      </div>
    </div>
  );
}

const COLORS = {
  blue:   { bg: 'bg-blue-500/10',   icon: 'text-blue-500' },
  purple: { bg: 'bg-purple-500/10', icon: 'text-purple-500' },
  green:  { bg: 'bg-green-500/10',  icon: 'text-green-500' },
  orange: { bg: 'bg-orange-500/10', icon: 'text-orange-500' },
};

// cards dizisinin eleman şekli (sub yalnız finans kartlarında var).
interface CardDef {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  color: ColorPair;
}

interface KPICardsProps {
  stats?: StatsData | null;
  loading?: boolean;
  showFinance?: boolean;
}

export default function KPICards({ stats, loading, showFinance = true }: KPICardsProps) {
  const cards: CardDef[] = [
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
        // (?? 0) yalnız tip daraltması için: undefined > 0 zaten false idi, davranış birebir aynı.
        sub: (stats?.pendingAmount ?? 0) > 0 ? 'ödeme bekliyor' : undefined,
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
