'use client';

import { useState, useEffect, useMemo } from 'react';
import { Save } from 'lucide-react';
import LoadingBox from './Loading';
import { api } from './shared';
import { guidanceSubjectsFor } from './student-logic';
import type { Session } from '@/lib/auth';
import type { ShowToast } from './types';

// Öğrencinin haftalık D/Y/B girişleri — inputlar boş string de taşır.
type GuidanceEntries = Record<string, { correct?: number | string; wrong?: number | string; empty?: number | string }>;

interface StudentGuidancePanelProps {
  session: Session;
  showToast: ShowToast;
}

// ─── STUDENT GUIDANCE PANEL ────────────────────────────────────────────────────
export default function StudentGuidancePanel({ session, showToast }: StudentGuidancePanelProps) {
  const subjects = useMemo(() => guidanceSubjectsFor(session.cls), [session.cls]);
  const [entries, setEntries] = useState<GuidanceEntries>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api<{ entries?: GuidanceEntries; reviewed?: boolean; submittedAt?: string | null }>('/api/guidance');
        setEntries(data.entries || {});
        setReviewed(!!data.reviewed);
        setSubmittedAt(data.submittedAt || null);
      } catch (e) { showToast((e as Error).message, 'error'); }
      setLoading(false);
    })();
  }, []);

  function setVal(subject: string, field: 'correct' | 'wrong' | 'empty', value: string) {
    const v = value === '' ? '' : Math.max(0, parseInt(value) || 0);
    setEntries(prev => ({
      ...prev,
      [subject]: { ...(prev[subject] || { correct: '', wrong: '', empty: '' }), [field]: v },
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, { correct: number; wrong: number; empty: number }> = {};
      for (const [subject, val] of Object.entries(entries)) {
        if (!val) continue;
        const c = parseInt(String(val.correct)) || 0;
        const w = parseInt(String(val.wrong)) || 0;
        const em = parseInt(String(val.empty)) || 0;
        if (c === 0 && w === 0 && em === 0) continue;
        payload[subject] = { correct: c, wrong: w, empty: em };
      }
      await api('/api/guidance', { method: 'POST', body: JSON.stringify({ entries: payload }) });
      setReviewed(false);
      setSubmittedAt(new Date().toISOString());
      showToast('Rehberlik bilgileri kaydedildi');
    } catch (e) {
      showToast((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <LoadingBox height="h-48" />;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-700 text-gray-800" style={{ fontWeight: 700 }}>Bu Haftaki Soru Sayıları</h3>
          <p className="text-xs text-gray-400 mt-0.5">Her ders için çözdüğün soru sayılarını gir, hafta sonunda müdür inceleyecek.</p>
        </div>
        {submittedAt && (
          <span className={`text-[10px] px-2.5 py-1 rounded-full font-600 ${reviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`} style={{ fontWeight: 600 }}>
            {reviewed ? 'İncelendi' : 'İnceleme bekliyor'}
          </span>
        )}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left text-xs text-gray-500 font-600 py-2.5 px-3" style={{ fontWeight: 600 }}>Ders</th>
              <th className="text-center text-xs text-emerald-600 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Doğru</th>
              <th className="text-center text-xs text-red-600 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Yanlış</th>
              <th className="text-center text-xs text-gray-500 font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Boş</th>
              <th className="text-center text-xs text-brand font-600 py-2.5 px-2" style={{ fontWeight: 600 }}>Toplam</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map(subject => {
              const val = entries[subject] || { correct: '', wrong: '', empty: '' };
              const total = (parseInt(String(val.correct)) || 0) + (parseInt(String(val.wrong)) || 0) + (parseInt(String(val.empty)) || 0);
              return (
                <tr key={subject} className="border-t border-gray-50">
                  <td className="px-3 py-2 text-sm text-gray-700 font-500" style={{ fontWeight: 500 }}>{subject}</td>
                  <td className="px-2 py-2"><input type="number" min="0" inputMode="numeric" value={val.correct} onChange={e => setVal(subject, 'correct', e.target.value)}
                    className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1.5 focus:border-emerald-400 focus:outline-none" /></td>
                  <td className="px-2 py-2"><input type="number" min="0" inputMode="numeric" value={val.wrong} onChange={e => setVal(subject, 'wrong', e.target.value)}
                    className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1.5 focus:border-red-400 focus:outline-none" /></td>
                  <td className="px-2 py-2"><input type="number" min="0" inputMode="numeric" value={val.empty} onChange={e => setVal(subject, 'empty', e.target.value)}
                    className="w-16 text-center text-sm border border-gray-200 rounded-lg py-1.5 focus:border-gray-400 focus:outline-none" /></td>
                  <td className="px-2 py-2 text-center text-sm font-700 text-brand" style={{ fontWeight: 700 }}>{total > 0 ? total : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-4">
        <button onClick={handleSave} disabled={saving}
          className="btn-primary w-full sm:w-auto !px-6 !py-2.5 flex items-center justify-center gap-1.5">
          <Save size={14} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}

// ─── STUDENT EXPANDED VIEW (Rehberlik Details) ──────────────────────────────────
export function StudentGuidancePanelWrapper({ session, showToast }: StudentGuidancePanelProps) {
  return <StudentGuidancePanel session={session} showToast={showToast} />;
}
