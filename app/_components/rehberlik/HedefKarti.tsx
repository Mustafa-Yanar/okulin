'use client';

import { useEffect, useState } from 'react';
import { Target, Check, Pencil } from 'lucide-react';
import LoadingBox from '../Loading';

// GET /api/hedef yanıtı.
interface HedefData {
  weekly: number;
  thisWeekSolved: number;
  history: { weekKey: string; solved: number }[];
}

interface HedefKartiProps {
  studentId?: string;
  editable?: boolean;
}

// Haftalık soru çözüm hedefi kartı. guidance verisini tüketir (çoğaltmaz).
// "Çözülen" = D+Y+B toplamı (Haftalık Çözülen Sorular kartının verisiyle aynı kaynak).
// editable: hedef konabilir/güncellenebilir mi (öğrenci kendi, müdür/rehber herkes).
// studentId: başka öğrenci için; öğrenci kendi için boş.
export default function HedefKarti({ studentId, editable }: HedefKartiProps) {
  const [data, setData] = useState<HedefData | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const qs = studentId ? `?studentId=${encodeURIComponent(studentId)}` : '';

  function load() {
    fetch(`/api/hedef${qs}`, { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d: HedefData | null) => {
        setData(d);
        setVal(d?.weekly ? String(d.weekly) : '');
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  async function save() {
    setSaving(true);
    setMsg('');
    const weekly = parseInt(val) || 0;
    const res = await fetch('/api/hedef', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ studentId: studentId || undefined, weekly }),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(false);
      setMsg(weekly === 0 ? 'Hedef kaldırıldı' : 'Hedef kaydedildi');
      load();
      setTimeout(() => setMsg(''), 2500);
    } else {
      setMsg('Kaydedilemedi');
    }
  }

  if (loading) return <LoadingBox height="h-24" />;
  if (!data) return <div className="text-caption py-4">Hedef bilgisi yüklenemedi.</div>;

  const { weekly, thisWeekSolved, history } = data;
  const hasGoal = weekly > 0;
  const pct = hasGoal ? Math.min(100, Math.round((thisWeekSolved / weekly) * 100)) : 0;
  const reached = hasGoal && thisWeekSolved >= weekly;
  const maxHist = Math.max(weekly || 0, ...history.map((h) => h.solved), 1);

  return (
    <div className="space-y-4">
      {/* Bu haftanın ilerlemesi */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="flex items-center gap-1.5 text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
            <Target size={16} style={{ color: 'var(--brand, #6366f1)' }} />
            Bu Hafta
          </span>
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{thisWeekSolved}</strong>
            {hasGoal ? ` / ${weekly} soru` : ' soru'}
          </span>
        </div>
        {hasGoal ? (
          <>
            <div className="w-full rounded-full overflow-hidden" style={{ height: 10, background: 'var(--bg-muted)' }}>
              <div
                className="h-full rounded-full transition"
                style={{
                  width: `${pct}%`,
                  background: reached ? 'var(--color-success, #16a34a)' : 'var(--brand, #6366f1)',
                }}
              />
            </div>
            <div className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {reached ? `Hedef tamam — %${pct}` : `%${pct} tamamlandı`}
            </div>
          </>
        ) : (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Henüz haftalık hedef belirlenmedi.
          </div>
        )}
      </div>

      {/* Mini trend (son haftalar) */}
      {history.length > 0 && (
        <div>
          <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>Son haftalar</div>
          <div className="flex items-end gap-1.5" style={{ height: 56 }}>
            {history.slice().reverse().map((h) => {
              const barPct = Math.max(6, Math.round((h.solved / maxHist) * 100));
              const ok = hasGoal && h.solved >= weekly;
              return (
                <div key={h.weekKey} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${h.weekKey}: ${h.solved} soru`}>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{h.solved}</span>
                  <div
                    className="w-full rounded-t"
                    style={{
                      height: `${barPct}%`,
                      background: ok ? 'var(--color-success, #16a34a)' : 'color-mix(in srgb, var(--brand, #6366f1) 55%, transparent)',
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Düzenleme */}
      {editable && (
        <div className="pt-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder="Haftalık soru hedefi"
                className="input flex-1"
              />
              <button onClick={save} disabled={saving} className="btn-primary whitespace-nowrap">
                <Check size={15} className="inline -mt-0.5 mr-1" />
                {saving ? '...' : 'Kaydet'}
              </button>
              <button
                onClick={() => { setEditing(false); setVal(weekly ? String(weekly) : ''); }}
                className="text-sm px-2"
                style={{ color: 'var(--text-muted)' }}
              >
                İptal
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-sm font-600"
              style={{ fontWeight: 600, color: 'var(--brand, #6366f1)' }}
            >
              <Pencil size={14} />
              {hasGoal ? 'Hedefi düzenle' : 'Hedef belirle'}
            </button>
          )}
          {msg && <div className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>{msg}</div>}
          <div className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Hedefi 0 yaparsanız kaldırılır.
          </div>
        </div>
      )}
    </div>
  );
}
