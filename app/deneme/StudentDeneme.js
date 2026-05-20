'use client';

import { useEffect, useMemo, useState } from 'react';
import NetChart from './NetChart';

export default function StudentDeneme({ session }) {
  const [name, setName] = useState(session.name || '');
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [examType, setExamType] = useState('TYT');
  const [mode, setMode] = useState('toplam'); // 'toplam' | 'ders'

  useEffect(() => {
    fetch('/api/deneme/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (d.name) setName(d.name);
        setPoints(d.points || []);
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => points.filter((p) => p.examType === examType),
    [points, examType]
  );

  const { chartData, chartSeries } = useMemo(() => {
    if (mode === 'toplam') {
      const data = filtered.map((p) => ({
        name: p.dateLabel,
        full: `${p.name} (${p.fullDate})`,
        'Toplam Net': p.toplamNet,
      }));
      return { chartData: data, chartSeries: ['Toplam Net'] };
    }
    const groupSet = new Set();
    filtered.forEach((p) => Object.keys(p.groupNets).forEach((g) => groupSet.add(g)));
    const series = Array.from(groupSet);
    const data = filtered.map((p) => {
      const point = { name: p.dateLabel, full: `${p.name} (${p.fullDate})` };
      for (const g of series) point[g] = p.groupNets[g] ?? 0;
      return point;
    });
    return { chartData: data, chartSeries: series };
  }, [filtered, mode]);

  const stats = useMemo(() => {
    if (filtered.length === 0) return null;
    const nets = filtered.map((p) => p.toplamNet);
    const last = filtered[filtered.length - 1];
    const best = Math.max(...nets);
    const prev = filtered.length > 1 ? filtered[filtered.length - 2].toplamNet : null;
    const trend = prev !== null ? Math.round((last.toplamNet - prev) * 100) / 100 : null;
    return { last, best, trend };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-800 text-gray-900" style={{ fontWeight: 800 }}>
          {name}
        </h1>
        <p className="text-sm text-gray-400">Deneme net gelişimin ve sıralamaların</p>
      </div>

      <div className="inline-flex rounded-lg bg-white border border-gray-200 p-1">
        {['TYT', 'AYT'].map((t) => (
          <button
            key={t}
            onClick={() => setExamType(t)}
            className={`px-5 py-1.5 rounded-md text-sm font-600 transition-colors ${
              examType === t ? 'bg-indigo-600 text-white' : 'text-gray-500'
            }`}
            style={{ fontWeight: 600 }}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Yükleniyor...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">
          {examType} için henüz sonucun yok.
        </div>
      ) : (
        <>
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Son Net" value={stats.last.toplamNet.toFixed(2)} />
              <StatCard label="Son Sıralama" value={`${stats.last.rank}/${stats.last.total}`} />
              <StatCard label="En İyi Net" value={stats.best.toFixed(2)} color="#16a34a" />
              <StatCard
                label="Önceki Denemeye Göre"
                value={
                  stats.trend === null
                    ? '-'
                    : `${stats.trend > 0 ? '+' : ''}${stats.trend.toFixed(2)}`
                }
                color={stats.trend === null ? '#9ca3af' : stats.trend >= 0 ? '#16a34a' : '#dc2626'}
              />
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="font-700 text-gray-700" style={{ fontWeight: 700 }}>
                Net Gelişim Grafiği
              </h2>
              <div className="inline-flex rounded-lg bg-gray-100 p-1">
                {[
                  ['toplam', 'Toplam Net'],
                  ['ders', 'Ders Bazlı'],
                ].map(([m, label]) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 rounded-md text-sm font-600 transition-colors ${
                      mode === m ? 'bg-white shadow text-gray-800' : 'text-gray-500'
                    }`}
                    style={{ fontWeight: 600 }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <NetChart data={chartData} series={chartSeries} />
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 p-4 sm:p-6">
            <h2 className="font-700 text-gray-700 mb-4" style={{ fontWeight: 700 }}>
              Denemelerim ve Sıralamam
            </h2>
            <div className="space-y-2">
              {[...filtered].reverse().map((p) => (
                <div
                  key={p.examId}
                  className="flex items-center justify-between border border-gray-100 rounded-lg px-3 py-2.5"
                >
                  <div>
                    <div className="font-600 text-gray-700 text-sm" style={{ fontWeight: 600 }}>
                      {p.name}
                    </div>
                    <div className="text-xs text-gray-400">{p.fullDate}</div>
                  </div>
                  <div className="flex items-center gap-4 text-right">
                    <div>
                      <div className="text-[10px] text-gray-400">Sıra</div>
                      <div className="text-sm font-700 text-gray-700" style={{ fontWeight: 700 }}>
                        {p.rank}/{p.total}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-gray-400">Toplam Net</div>
                      <div className="text-base font-800 text-indigo-600" style={{ fontWeight: 800 }}>
                        {p.toplamNet.toFixed(2)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color = '#111827' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="text-2xl font-800" style={{ fontWeight: 800, color }}>
        {value}
      </div>
    </div>
  );
}
