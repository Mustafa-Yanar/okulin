'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const COLORS = ['#6366f1', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#ca8a04', '#db2777'];

export default function NetChart({ data, series, yMax }) {
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
        <LineChart data={indexed} margin={{ top: 10, right: 16, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="_idx"
            type="number"
            domain={[0, indexed.length - 1]}
            ticks={indexed.map((d) => d._idx)}
            tickFormatter={(i) => indexed[i]?.name ?? ''}
            tick={{ fontSize: 12, fill: '#6b7280' }}
          />
          <YAxis
            tick={{ fontSize: 12, fill: '#6b7280' }}
            domain={[0, yMax !== undefined ? yMax : 'auto']}
            allowDecimals={true}
          />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
            labelFormatter={(_, payload) => (payload && payload[0] ? payload[0].payload.full : '')}
          />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
          {series.map((s, i) => (
            <Line
              key={s}
              type="linear"
              dataKey={s}
              stroke={COLORS[i % COLORS.length]}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
