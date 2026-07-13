'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, BarChart3, TrendingUp, Users } from 'lucide-react';
import LoadingBox from '../Loading';
import EmptyState from '../EmptyState';
import NetChart, { type NetChartDatum } from './NetChart';
import { kisalt } from './SonucListesi';
import { useClasses } from '../ClassesContext';
import { classShortUpper } from '@/lib/classCatalog';
import type { ShowToast } from '../types';

// ── /api/deneme/class-report DTO'ları (lib/deneme/report buildClassReport/Trend) ──
interface ClassAggDTO {
  cls: string;
  count: number;
  subjects: Record<string, number>;
  toplamNet: number;
  puan: number | null;
  rank: number;
}
interface ClassReportListDTO {
  key: string;
  label: string;
  subjects: { key: string; label: string }[];
  classes: ClassAggDTO[];
  ortalama: { subjects: Record<string, number>; toplamNet: number; puan: number | null };
}
interface TrendPointDTO {
  examId: string;
  name: string;
  date: string | null;
  dateLabel: string;
  classAvgs: Record<string, number>;
  schoolAvg: number;
}
interface ClassReportDTO {
  type: string;
  exams: { id: string; name: string; date: string | null }[];
  selectedId: string | null;
  comparison: { exam: { id: string; name: string } | null; lists: ClassReportListDTO[] } | null;
  trend: { classes: string[]; points: TrendPointDTO[] } | null;
}

const TYPES = ['TYT', 'AYT', 'LGS'];
const SCHOOL = 'Okul Ort';

// recharts dataKey nokta içeren adı iç-yol (a.b) sayar; sınıf adı "12.A" ya da nokta
// içeren etiketler seriyi bozar. Noktayı görsel eşdeğeriyle (·) değiştir.
function safeSeries(name: string): string {
  return name.replace(/\./g, '·');
}

interface SinifRaporuProps {
  showToast: ShowToast;
  onBack: () => void;
}

// Müdür/rehber: sınıf bazlı karşılaştırma + gelişim trendi. Yalnız hesaplanmış sınavlar.
export default function SinifRaporu({ showToast, onBack }: SinifRaporuProps) {
  const [type, setType] = useState('TYT');
  const [examId, setExamId] = useState<string | null>(null);
  const [data, setData] = useState<ClassReportDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeList, setActiveList] = useState(0);

  const load = useCallback(async (t: string, exId: string | null) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ type: t });
      if (exId) qs.set('examId', exId);
      const res = await fetch(`/api/deneme/class-report?${qs.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) {
        showToast('Rapor yüklenemedi', 'error');
        setData(null);
        return;
      }
      const d = (await res.json()) as ClassReportDTO;
      setData(d);
      setExamId(d.selectedId);
      setActiveList(0);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // Tür değişince sıfırdan yükle (seçili sınav sunucudan gelir).
  useEffect(() => { load(type, null); }, [type, load]);

  function pickExam(id: string) {
    setExamId(id);
    load(type, id);
  }

  const lists = data?.comparison?.lists || [];
  const list = lists[activeList] || null;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 flex items-center gap-1 hover:text-gray-700">
        <ChevronLeft size={15} /> Sınavlar
      </button>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="pill-tabs">
          {TYPES.map((t) => (
            <button key={t} onClick={() => setType(t)} className={`pill-tab${type === t ? ' is-active' : ''}`}>
              <span>{t}</span>
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <LoadingBox height="h-40" />
      ) : !data || data.exams.length === 0 ? (
        <EmptyState
          compact
          icon={BarChart3}
          title={`${type} için hesaplanmış sınav yok`}
          description="Bir sınavın sonuçlarını hesapladıktan sonra sınıf karşılaştırması ve trend burada görünür."
        />
      ) : (
        <>
          {/* Sınıf karşılaştırması — seçili sınav */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h3 className="flex items-center gap-2 text-sm text-gray-600" style={{ fontWeight: 700 }}>
                <Users size={15} className="text-brand" /> Sınıf Karşılaştırması
              </h3>
              <select
                value={examId || ''}
                onChange={(e) => pickExam(e.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm bg-white focus:border-[color:var(--brand)] focus:outline-none"
              >
                {data.exams.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.date ? ` · ${new Date(e.date).toLocaleDateString('tr-TR')}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {lists.length > 1 && (
              <div className="pill-tabs">
                {lists.map((l, i) => (
                  <button key={l.key} onClick={() => setActiveList(i)} className={`pill-tab${activeList === i ? ' is-active' : ''}`}>
                    <span>{l.label}</span>
                  </button>
                ))}
              </div>
            )}

            {list && list.classes.length > 0 ? (
              <SinifTablosu list={list} />
            ) : (
              <div className="card p-8 text-center text-gray-400 text-sm">
                Bu sınavda sınıfı eşleşmiş öğrenci yok.
              </div>
            )}
          </section>

          {/* Sınıf gelişim trendi — türdeki tüm hesaplanmış sınavlar */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-sm text-gray-600" style={{ fontWeight: 700 }}>
              <TrendingUp size={15} className="text-emerald-500" /> Sınıf Gelişim Trendi
              <span className="text-xs text-gray-400" style={{ fontWeight: 400 }}>(ortalama toplam net)</span>
            </h3>
            <TrendGrafik trend={data.trend} />
          </section>
        </>
      )}
    </div>
  );
}

function SinifTablosu({ list }: { list: ClassReportListDTO }) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (rapor tablosu)
  const subjects = list.subjects;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm whitespace-nowrap">
        <thead className="bg-gray-50 text-gray-500">
          <tr>
            <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>#</th>
            <th className="text-left px-3 py-2" style={{ fontWeight: 600 }}>Sınıf</th>
            <th className="text-right px-2 py-2" style={{ fontWeight: 600 }}>Öğr.</th>
            {subjects.map((s) => (
              <th key={s.key} className="text-right px-2 py-2" style={{ fontWeight: 600 }} title={s.label}>{kisalt(s.label)}</th>
            ))}
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Ort. Net</th>
            <th className="text-right px-3 py-2" style={{ fontWeight: 600 }}>Ort. Puan</th>
          </tr>
        </thead>
        <tbody>
          {list.classes.map((c) => (
            <tr key={c.cls} className="border-t border-gray-50">
              <td className="px-3 py-1.5 text-gray-400">{c.rank}</td>
              <td className="px-3 py-1.5 text-gray-700" style={{ fontWeight: 600 }}>{classShortUpper(classes, c.cls)}</td>
              <td className="px-2 py-1.5 text-right text-gray-400">{c.count}</td>
              {subjects.map((s) => (
                <td key={s.key} className="px-2 py-1.5 text-right text-gray-500">{(c.subjects[s.key] ?? 0).toFixed(2)}</td>
              ))}
              <td className="px-3 py-1.5 text-right text-gray-700" style={{ fontWeight: 600 }}>{c.toplamNet.toFixed(2)}</td>
              <td className="px-3 py-1.5 text-right text-brand" style={{ fontWeight: 700 }}>{c.puan != null ? c.puan.toFixed(2) : '—'}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-gray-200 bg-gray-50/60">
            <td className="px-3 py-2 text-gray-400" colSpan={3} style={{ fontWeight: 600 }}>Okul Ortalaması</td>
            {subjects.map((s) => (
              <td key={s.key} className="px-2 py-2 text-right text-gray-500">{(list.ortalama.subjects[s.key] ?? 0).toFixed(2)}</td>
            ))}
            <td className="px-3 py-2 text-right text-gray-600" style={{ fontWeight: 600 }}>{(list.ortalama.toplamNet ?? 0).toFixed(2)}</td>
            <td className="px-3 py-2 text-right text-brand" style={{ fontWeight: 600 }}>{list.ortalama.puan != null ? list.ortalama.puan.toFixed(2) : '—'}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function TrendGrafik({ trend }: { trend: ClassReportDTO['trend'] }) {
  const { chartData, series } = useMemo(() => {
    if (!trend || trend.points.length === 0) return { chartData: [] as NetChartDatum[], series: [] as string[] };
    const data: NetChartDatum[] = trend.points.map((p) => {
      const d: NetChartDatum = { name: p.dateLabel, full: `${p.name}${p.date ? ` (${new Date(p.date).toLocaleDateString('tr-TR')})` : ''}` };
      for (const cls of trend.classes) {
        const v = p.classAvgs[cls];
        d[safeSeries(cls)] = v != null ? v : null; // o sınavda o sınıfın öğrencisi yoksa boşluk
      }
      d[SCHOOL] = p.schoolAvg;
      return d;
    });
    return { chartData: data, series: [...trend.classes.map(safeSeries), SCHOOL] };
  }, [trend]);

  if (!trend || trend.points.length < 2) {
    return (
      <div className="card p-8 text-center text-gray-400 text-sm">
        Trend için en az iki hesaplanmış sınav gerekli.
      </div>
    );
  }
  return (
    <div className="card p-3">
      <NetChart data={chartData} series={series} />
    </div>
  );
}
