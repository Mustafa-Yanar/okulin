'use client';
import LoadingBox from '../Loading';

import React, { useState, useEffect } from 'react';
import { BookOpen, Check } from 'lucide-react';

// Helper API Fetcher
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

export default function StudentGuidanceView({ studentId, onReviewed, readOnly, branchFilter }) {
  const [weeks, setWeeks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(null);

  async function load() {
    try {
      const d = await api(`/api/guidance?listAll=1&studentId=${studentId}`);
      setWeeks(d.weeks || []);
    } catch {
      setWeeks([]);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [studentId]);

  async function approve(weekKey) {
    setApproving(weekKey);
    try {
      await api('/api/guidance', { method: 'PUT', body: JSON.stringify({ studentId, weekKey }) });
      setWeeks(ws => ws.map(w => w.weekKey === weekKey ? { ...w, reviewed: true, reviewedAt: new Date().toISOString() } : w));
      if (onReviewed) onReviewed();
    } catch {} finally {
      setApproving(null);
    }
  }

  if (loading) return <LoadingBox height="h-32" />;
  if (weeks.length === 0) return (
    <div className="py-8 text-center text-gray-400">
      <BookOpen size={28} className="mx-auto mb-2 opacity-30" />
      <p className="text-sm">Henüz rehberlik kaydı yok</p>
    </div>
  );

  const weekLabelFn = wk => {
    try {
      const [year, week] = wk.split('-W');
      const jan4 = new Date(parseInt(year), 0, 4);
      const dow = jan4.getDay() || 7;
      const mon = new Date(jan4);
      mon.setDate(jan4.getDate() - dow + 1 + (parseInt(week) - 1) * 7);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const fmt = d => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      return `${fmt(mon)} – ${fmt(sun)} ${year}`;
    } catch { return wk; }
  };

  return (
    <div className="space-y-3">
      {weeks.map(w => {
        let entries = Object.entries(w.entries || {});
        if (branchFilter) entries = entries.filter(([subject]) => branchFilter(subject));
        let totalSolved = 0;
        entries.forEach(([, v]) => {
          totalSolved += (v.correct || 0) + (v.wrong || 0) + (v.empty || 0);
        });
        return (
          <div key={w.weekKey} className="card overflow-hidden">
            <div className="px-3 py-2.5 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-700 text-sm text-gray-800" style={{ fontWeight: 700 }}>{weekLabelFn(w.weekKey)}</span>
                {w.reviewed
                  ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-600 shrink-0" style={{ fontWeight: 600 }}>Onaylı</span>
                  : <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-600 shrink-0" style={{ fontWeight: 600 }}>İnceleme bekliyor</span>}
              </div>
              {!w.reviewed && !readOnly && (
                <button onClick={() => approve(w.weekKey)} disabled={approving === w.weekKey}
                  className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1 shrink-0">
                  <Check size={12} /> {approving === w.weekKey ? 'Onaylanıyor…' : 'Onayla'}
                </button>
              )}
            </div>
            {entries.length === 0 ? (
              <p className="px-3 py-3 text-xs text-gray-400">Bu hafta için kayıt yok.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-white">
                    <th className="text-left text-[10px] uppercase text-gray-400 font-600 py-1.5 px-3" style={{ fontWeight: 600 }}>Ders</th>
                    <th className="text-center text-[10px] uppercase text-emerald-600 font-600 py-1.5 px-2" style={{ fontWeight: 600 }}>D</th>
                    <th className="text-center text-[10px] uppercase text-red-600 font-600 py-1.5 px-2" style={{ fontWeight: 600 }}>Y</th>
                    <th className="text-center text-[10px] uppercase text-gray-500 font-600 py-1.5 px-2" style={{ fontWeight: 600 }}>B</th>
                    <th className="text-center text-[10px] uppercase text-indigo-600 font-600 py-1.5 px-2" style={{ fontWeight: 600 }}>Toplam</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map(([subject, v]) => {
                    const total = (v.correct || 0) + (v.wrong || 0) + (v.empty || 0);
                    return (
                      <tr key={subject} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 px-3 text-xs text-gray-700 font-500" style={{ fontWeight: 500 }}>{subject}</td>
                        <td className="py-1.5 px-2 text-xs text-center text-emerald-700 font-600" style={{ fontWeight: 600 }}>{v.correct || 0}</td>
                        <td className="py-1.5 px-2 text-xs text-center text-red-700 font-600" style={{ fontWeight: 600 }}>{v.wrong || 0}</td>
                        <td className="py-1.5 px-2 text-xs text-center text-gray-600">{v.empty || 0}</td>
                        <td className="py-1.5 px-2 text-xs text-center text-indigo-700 font-700" style={{ fontWeight: 700 }}>{total}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-gray-50">
                    <td className="py-1.5 px-3 text-xs font-700 text-gray-700" style={{ fontWeight: 700 }}>Toplam</td>
                    <td colSpan={4} className="py-1.5 px-2 text-[11px] text-center text-indigo-700 font-700" style={{ fontWeight: 700 }}>{totalSolved} soru</td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}
