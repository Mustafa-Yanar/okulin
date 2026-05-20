'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import NetChart from './NetChart';
import { calcNet, TYT_GROUPS, AYT_CATEGORIES } from '@/lib/deneme/config';

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
        <GrowthChart points={filtered} examType={examType} />
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

// subjectKey -> soru sayısı (tüm TYT + AYT gruplarından düzleştirilmiş)
const SUBJECT_QUESTION_COUNTS = (() => {
  const map = {};
  const allGroups = [
    ...TYT_GROUPS,
    ...Object.values(AYT_CATEGORIES).flatMap((c) => c.groups),
  ];
  allGroups.forEach((g) => {
    g.subjects.forEach((s) => {
      if (!(s.key in map)) map[s.key] = s.questionCount;
    });
  });
  return map;
})();

function GrowthChart({ points, examType }) {
  const [mode, setMode] = useState('toplam'); // 'toplam' | 'ders'

  // Ders bazlı modda görünecek alt dersler: tüm denemelerde geçen subjectKey'ler (sıralı)
  const subjectKeys = useMemo(() => {
    const seen = [];
    points.forEach((p) => {
      (p.subjectKeys || Object.keys(p.results || {})).forEach((k) => {
        if (!seen.includes(k)) seen.push(k);
      });
    });
    return seen;
  }, [points]);

  const [selectedSubject, setSelectedSubject] = useState('');
  // İlk derse otomatik geç (ders moduna ilk girişte)
  const activeSubject = selectedSubject || subjectKeys[0] || '';

  const { chartData, chartSeries, yMax } = useMemo(() => {
    if (mode === 'toplam') {
      const data = points.map((p) => ({
        name: p.dateLabel,
        full: `${p.name} (${p.fullDate})`,
        'Toplam Net': p.toplamNet,
      }));
      return { chartData: data, chartSeries: ['Toplam Net'], yMax: undefined };
    }
    // Ders bazlı: sadece seçili dersin neti, tek seri
    const label = SUBJECT_LABELS[activeSubject] || activeSubject;
    const data = points.map((p) => {
      const r = p.results?.[activeSubject];
      const point = { name: p.dateLabel, full: `${p.name} (${p.fullDate})` };
      point[label] = r ? r.net : null;
      return point;
    });
    const qCount = SUBJECT_QUESTION_COUNTS[activeSubject];
    return { chartData: data, chartSeries: [label], yMax: qCount ?? undefined };
  }, [points, mode, activeSubject]);

  return (
    <div>
      <div className="flex items-center gap-2 flex-wrap mb-3">
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
        {mode === 'ders' && subjectKeys.length > 0 && (
          <select
            value={activeSubject}
            onChange={(e) => setSelectedSubject(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:border-indigo-400 focus:outline-none"
          >
            {subjectKeys.map((k) => (
              <option key={k} value={k}>
                {SUBJECT_LABELS[k] || k}
              </option>
            ))}
          </select>
        )}
      </div>
      <NetChart data={chartData} series={chartSeries} yMax={yMax} />
    </div>
  );
}
