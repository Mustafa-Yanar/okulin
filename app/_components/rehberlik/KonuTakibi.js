'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { topicsFor } from '@/lib/deneme/topics';

// Ders → konu → slider. editable ise yüzdeler değiştirilebilir.
// studentId: müdür/öğretmen başka öğrenci için verir; öğrenci kendi için boş bırakır.
export default function KonuTakibi({ subjects, editable, studentId }) {
  const [topics, setTopics] = useState({}); // { subject: { [idx]: percent } }
  const [loading, setLoading] = useState(true);
  const [openSubject, setOpenSubject] = useState(null);

  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';

  useEffect(() => {
    fetch(`/api/topics${qs}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setTopics(d.topics || {}))
      .finally(() => setLoading(false));
  }, [qs]);

  async function setPercent(subject, idx, percent) {
    // İyimser güncelle
    setTopics((prev) => ({
      ...prev,
      [subject]: { ...(prev[subject] || {}), [idx]: percent },
    }));
    if (!editable) return;
    await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ studentId, subject, topicIndex: idx, percent }),
    });
  }

  if (loading) return <div className="text-caption py-4">Yükleniyor...</div>;

  if (!subjects || subjects.length === 0) {
    return <div className="text-caption py-4">Bu öğrenci için ders bulunamadı.</div>;
  }

  return (
    <div className="space-y-2">
      {subjects.map((subject) => {
        const list = topicsFor(subject);
        if (list.length === 0) return null;
        const subjData = topics[subject] || {};
        const avg = Math.round(
          list.reduce((sum, _, i) => sum + (subjData[i] || 0), 0) / list.length
        );
        const open = openSubject === subject;
        return (
          <div key={subject} className="border border-gray-100 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpenSubject(open ? null : subject)}
              className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                {subject}
              </span>
              <span className="flex items-center gap-2">
                <span className="text-xs font-700 text-indigo-600" style={{ fontWeight: 700 }}>
                  %{avg}
                </span>
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </span>
            </button>
            {open && (
              <div className="px-4 py-3 space-y-3">
                {list.map((topic, i) => {
                  const val = subjData[i] || 0;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-600">{topic}</span>
                        <span
                          className="text-xs font-700 text-gray-500 min-w-[36px] text-right"
                          style={{ fontWeight: 700 }}
                        >
                          %{val}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={val}
                        disabled={!editable}
                        onChange={(e) => setPercent(subject, i, parseInt(e.target.value))}
                        className="w-full accent-indigo-600 disabled:opacity-60"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
