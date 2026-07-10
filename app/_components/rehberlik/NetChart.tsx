'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const COLORS = ['#6366f1', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];

// Grafik noktası: name (x etiketi) + full (tooltip başlığı) + seri adı → net değeri.
export interface NetChartDatum {
  name?: string;
  full?: string;
  [series: string]: unknown;
}

interface NetChartProps {
  data: NetChartDatum[];
  series: string[];
  yMax?: number;
}

export default function NetChart({ data, series, yMax }: NetChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-gray-400 text-sm">
        Grafik için en az bir deneme gerekli.
      </div>
    );
  }
  // X eksenini benzersiz index'e bağla — birden çok deneme aynı tarihe (name)
  // sahip olduğunda recharts noktaları karıştırıp tooltip'i kilitliyordu.
  const indexed = data.map((d, i) => ({ ...d, _idx: i }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={indexed} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
          {/* Her seri için yumuşak gradient alan dolgusu (Figma Graphs ilhamı). */}
          <defs>
            {series.map((s, i) => {
              const c = COLORS[i % COLORS.length];
              return (
                <linearGradient key={s} id={`netfill-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={c} stopOpacity={0.02} />
                </linearGradient>
              );
            })}
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #e5e7eb)" vertical={false} />
          <XAxis
            dataKey="_idx"
            type="number"
            domain={[0, indexed.length - 1]}
            ticks={indexed.map((d) => d._idx)}
            tickFormatter={(i) => indexed[i]?.name ?? ''}
            tick={{ fontSize: 12, fill: 'var(--chart-axis, #6b7280)' }}
            axisLine={{ stroke: 'var(--chart-grid, #e5e7eb)' }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: 'var(--chart-axis, #6b7280)' }}
            domain={[0, yMax !== undefined ? yMax : 'auto']}
            allowDecimals={true}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 10,
              border: '1px solid var(--chart-grid, #e5e7eb)',
              fontSize: 13,
              background: 'var(--bg-surface, #fff)',
              color: 'var(--text-primary, #111)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            }}
            labelFormatter={(_, payload) => (payload && payload[0] ? payload[0].payload.full : '')}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Area
              key={s}
              type="monotone"
              dataKey={s}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2.5}
              fill={`url(#netfill-${i})`}
              dot={{ r: 3, strokeWidth: 0, fill: COLORS[i % COLORS.length] }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
