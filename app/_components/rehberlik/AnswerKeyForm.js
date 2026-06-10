'use client';

import { useMemo, useState } from 'react';
import { KeyRound, Check, Save } from 'lucide-react';
import { getTemplate, boxLength } from '@/lib/deneme/template';

// Cevap anahtarı giriş formu (Drive mockup "Cevapanahtarı.png").
// Her kutu = bir ders grubu; cevaplar BOŞLUKSUZ tek string girilir, ders sınırı
// şablondan bilinir. İptal/boş soru için "*" işareti kullanılır.
export default function AnswerKeyForm({ exam, showToast }) {
  const template = getTemplate(exam.examType);
  const kitapciklar = (exam.kitapcikSayisi || 1) === 2 ? ['A', 'B'] : ['A'];
  const [aktif, setAktif] = useState('A');
  const [saving, setSaving] = useState(false);

  // keys: { A: { boxKey: string }, B: {...} } — exam.answerKey'den tohumla
  const [keys, setKeys] = useState(() => {
    const init = {};
    for (const k of kitapciklar) init[k] = { ...(exam.answerKey?.[k] || {}) };
    return init;
  });

  if (!template) return <p className="text-sm text-red-600">Geçersiz sınav türü.</p>;

  function setBox(boxKey, val) {
    setKeys((prev) => ({
      ...prev,
      [aktif]: { ...prev[aktif], [boxKey]: val.toLocaleUpperCase('tr') },
    }));
  }

  async function save() {
    // İstemci tarafı ön doğrulama
    const eksik = template.boxes.filter((b) => {
      const len = String(keys[aktif]?.[b.key] || '').replace(/\s/g, '').length;
      return len !== boxLength(b);
    });
    if (eksik.length) {
      return showToast(
        `Eksik/fazla: ${eksik.map((b) => b.label).join(', ')}`,
        'error'
      );
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/deneme/exams/${exam.id}/answerkey`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ kitapcik: aktif, answers: keys[aktif] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(data.error || 'Kaydedilemedi', 'error');
      showToast(`${aktif} kitapçığı cevap anahtarı kaydedildi`);
    } catch {
      showToast('Sunucuya ulaşılamadı', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound size={18} className="text-indigo-600" />
        <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>Cevap Anahtarı</h3>
      </div>

      {kitapciklar.length > 1 && (
        <div className="pill-tabs">
          {kitapciklar.map((k) => (
            <button
              key={k}
              onClick={() => setAktif(k)}
              className={`pill-tab${aktif === k ? ' is-active' : ''}`}
            >
              <span>{k} Kitapçığı</span>
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {template.boxes.map((box) => (
          <BoxInput
            key={box.key}
            box={box}
            value={keys[aktif]?.[box.key] || ''}
            onChange={(v) => setBox(box.key, v)}
          />
        ))}
      </div>

      <button
        onClick={save}
        disabled={saving}
        className="btn-primary !px-6 !py-2.5 flex items-center gap-2 disabled:opacity-60"
      >
        <Save size={16} /> {saving ? 'Kaydediliyor...' : `${aktif} Kitapçığını Kaydet`}
      </button>
    </div>
  );
}

function BoxInput({ box, value, onChange }) {
  const expected = boxLength(box);
  const clean = useMemo(() => String(value).replace(/\s/g, ''), [value]);
  const ok = clean.length === expected;
  const breakdown = box.subjects.map((s) => `${s.label} ${s.count}`).join(' · ');

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-1">
        <span className="font-700 text-sm" style={{ fontWeight: 700 }}>{box.label}</span>
        <span
          className={`text-xs font-600 flex items-center gap-1 ${ok ? 'text-emerald-600' : 'text-gray-400'}`}
          style={{ fontWeight: 600 }}
        >
          {ok && <Check size={13} />} {clean.length}/{expected}
        </span>
      </div>
      <p className="text-xs text-gray-400 mb-2">{breakdown}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`${box.label} cevapları (örn. ABCDE…)`}
        rows={2}
        spellCheck={false}
        className="input font-mono tracking-wide uppercase"
        style={{ resize: 'vertical', letterSpacing: '0.08em' }}
      />
    </div>
  );
}
