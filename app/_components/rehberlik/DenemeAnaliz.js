'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import NetChart from './NetChart';
import { calcNet } from '@/lib/deneme/config';

// Bir öğrencinin deneme analizi. studentId verilirse o öğrenci (müdür/öğretmen),
// verilmezse giriş yapan öğrencinin kendisi (/api/deneme/me).
export default function DenemeAnaliz({ studentId }) {
  const [tab, setTab] = useState('liste'); // 'liste' | 'grafik'
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [examType, setExamType] = useState('TYT');

  useEffect(() => {
    const url = studentId
      ? `/api/deneme/student?studentId=${encodeURIComponent(studentId)}`
      : '/api/deneme/me';
    fetch(url, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setPoints(d.points || []))
      .finally(() => setLoading(false));
  }, [studentId]);

  const filtered = useMemo(
    () => points.filter((p) => p.examType === examType),
    [points, examType]
  );

  if (loading) return <div className="text-gray-400 text-sm py-4">Yükleniyor...</div>;

  return (
    <div className="space-y-4">
      {/* TYT/AYT */}
      <div className="inline-flex rounded-lg bg-gray-100 p-1">
        {['TYT', 'AYT'].map((t) => (
          <button
            key={t}
            onClick={() => setExamType(t)}
            className={`px-4 py-1.5 rounded-md text-sm font-600 transition-colors ${
              examType === t ? 'bg-white shadow text-gray-800' : 'text-gray-500'
            }`}
            style={{ fontWeight: 600 }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* İç sekmeler */}
      <div className="inline-flex rounded-lg bg-gray-100 p-1 ml-2">
        {[
          ['liste', 'Denemeler'],
          ['grafik', 'Gelişim Grafiği'],
        ].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-md text-sm font-600 transition-colors ${
              tab === k ? 'bg-white shadow text-gray-800' : 'text-gray-500'
            }`}
            style={{ fontWeight: 600 }}
          >
            {label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="text-gray-400 text-sm py-6 text-center">
          {examType} için henüz sonuç yok.
        </div>
      ) : tab === 'liste' ? (
        <ExamList points={filtered} />
      ) : (
        <GrowthChart points={filtered} />
      )}
    </div>
  );
}

function ExamList({ points }) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="space-y-2">
      {[...points].reverse().map((p) => {
        const open = openId === p.examId;
        return (
          <div key={p.examId} className="border border-gray-100 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenId(open ? null : p.examId)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="text-left">
                <div className="text-sm font-600 text-gray-700" style={{ fontWeight: 600 }}>
                  {p.name}
                </div>
                <div className="text-xs text-gray-400">{p.fullDate}</div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-[10px] text-gray-400">Sıra</div>
                  <div className="text-sm font-700 text-gray-700" style={{ fontWeight: 700 }}>
                    {p.rank}/{p.total}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-gray-400">Net</div>
                  <div className="text-base font-800 text-indigo-600" style={{ fontWeight: 800 }}>
                    {p.toplamNet.toFixed(2)}
                  </div>
                </div>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </div>
            </button>
            {open && <ExamDetail point={p} />}
          </div>
        );
      })}
    </div>
  );
}

// Ders key -> görünen ad (config'le uyumlu kısa eşleme)
const SUBJECT_LABELS = {
  turkce: 'Türkçe', tarih: 'Tarih', cografya: 'Coğrafya', felsefe: 'Felsefe',
  din: 'Din Kültürü', felsefe_secmeli: 'Felsefe (Seçmeli)',
  matematik: 'Matematik', geometri: 'Geometri',
  fizik: 'Fizik', kimya: 'Kimya', biyoloji: 'Biyoloji',
  edebiyat_1: 'Edebiyat-1', tarih_1: 'Tarih-1', cografya_1: 'Coğrafya-1',
  tarih_2: 'Tarih-2', cografya_2: 'Coğrafya-2',
};

function ExamDetail({ point }) {
  const keys = point.subjectKeys || Object.keys(point.results || {});
  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-gray-400 text-xs">
            <th className="text-left font-600 py-1" style={{ fontWeight: 600 }}>Ders</th>
            <th className="text-center font-600 py-1 text-emerald-600" style={{ fontWeight: 600 }}>D</th>
            <th className="text-center font-600 py-1 text-red-600" style={{ fontWeight: 600 }}>Y</th>
            <th className="text-center font-600 py-1" style={{ fontWeight: 600 }}>Boş</th>
            <th className="text-right font-600 py-1 text-indigo-600" style={{ fontWeight: 600 }}>Net</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const r = point.results?.[k];
            if (!r) return null;
            const net = r.net !== undefined ? r.net : calcNet(r.dogru, r.yanlis);
            return (
              <tr key={k} className="border-t border-gray-50">
                <td className="py-1.5 text-gray-700">{SUBJECT_LABELS[k] || k}</td>
                <td className="py-1.5 text-center text-gray-600">{r.dogru}</td>
                <td className="py-1.5 text-center text-gray-600">{r.yanlis}</td>
                <td className="py-1.5 text-center text-gray-400">{r.bos ?? '—'}</td>
                <td className="py-1.5 text-right font-700 text-indigo-700" style={{ fontWeight: 700 }}>
                  {net.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-200">
            <td className="py-1.5 font-700 text-gray-700" style={{ fontWeight: 700 }} colSpan={4}>
              Toplam Net
            </td>
            <td className="py-1.5 text-right font-800 text-indigo-600" style={{ fontWeight: 800 }}>
              {point.toplamNet.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function GrowthChart({ points }) {
  const [mode, setMode] = useState('toplam'); // 'toplam' | 'ders'

  const { chartData, chartSeries } = useMemo(() => {
    if (mode === 'toplam') {
      const data = points.map((p) => ({
        name: p.dateLabel,
        full: `${p.name} (${p.fullDate})`,
        'Toplam Net': p.toplamNet,
      }));
      return { chartData: data, chartSeries: ['Toplam Net'] };
    }
    const groupSet = new Set();
    points.forEach((p) => Object.keys(p.groupNets).forEach((g) => groupSet.add(g)));
    const series = Array.from(groupSet);
    const data = points.map((p) => {
      const point = { name: p.dateLabel, full: `${p.name} (${p.fullDate})` };
      for (const g of series) point[g] = p.groupNets[g] ?? 0;
      return point;
    });
    return { chartData: data, chartSeries: series };
  }, [points, mode]);

  return (
    <div>
      <div className="inline-flex rounded-lg bg-gray-100 p-1 mb-3">
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
      <NetChart data={chartData} series={chartSeries} />
    </div>
  );
}
