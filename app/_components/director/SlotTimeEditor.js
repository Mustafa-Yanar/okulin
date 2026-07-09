'use client';

import React, { useMemo, useCallback, useState } from 'react';

// ─── Sabitler ────────────────────────────────────────────────────────────────
const START_MIN = 7 * 60;        // 07:00
const END_MIN   = 23 * 60;       // 23:00
const STEP      = 5;             // 5 dakika adım
const MAX_SLOTS = 16;            // gün başına üst sınır

const GUNLER = [
  { index: 0, label: 'Pazartesi', short: 'Pzt', weekend: false },
  { index: 1, label: 'Salı',      short: 'Sal', weekend: false },
  { index: 2, label: 'Çarşamba',  short: 'Çar', weekend: false },
  { index: 3, label: 'Perşembe',  short: 'Per', weekend: false },
  { index: 4, label: 'Cuma',      short: 'Cum', weekend: false },
  { index: 5, label: 'Cumartesi', short: 'Cmt', weekend: true  },
  { index: 6, label: 'Pazar',     short: 'Paz', weekend: true  },
];

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function toTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// 07:00 → 23:00 arası 5dk adımlı saat seçenekleri
const TIME_OPTIONS = (() => {
  const opts = [];
  for (let min = START_MIN; min <= END_MIN; min += STEP) opts.push(toTime(min));
  return opts;
})();

// Bir slot satırı için makul varsayılan üret: önceki slotun bitişinden 10 dk sonra 35 dk'lık.
function nextDefaultSlot(prevEnd) {
  const start = prevEnd != null ? prevEnd + 10 : 9 * 60;
  const end = start + 35;
  return { start: toTime(Math.min(start, END_MIN - 35)), end: toTime(Math.min(end, END_MIN)) };
}

// count'a göre times dizisini büyüt/küçült (mevcut değerleri koru).
function resizeTimes(times, count) {
  const out = times.slice(0, count);
  let prevEnd = out.length ? toMin(out[out.length - 1].end) : null;
  while (out.length < count) {
    const slot = nextDefaultSlot(prevEnd);
    out.push(slot);
    prevEnd = toMin(slot.end);
  }
  return out;
}

// ─── Tek slot satırı ─────────────────────────────────────────────────────────
function SlotRow({ index, slot, prevEnd, onChange }) {
  const startM = toMin(slot.start);
  const endM   = toMin(slot.end);
  const endError = endM <= startM;
  const overlapError = prevEnd != null && startM < prevEnd;
  const hasError = endError || overlapError;

  const selectStyle = {
    background: 'var(--bg-surface)',
    border: `1px solid ${hasError ? '#ef4444' : 'var(--border-subtle)'}`,
    color: 'var(--text-primary)',
  };

  return (
    <div className="flex items-center gap-1.5">
      <span className="w-5 text-xs text-right tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
        {index + 1}
      </span>
      <select value={slot.start} onChange={e => onChange(index, { ...slot, start: e.target.value })}
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>–</span>
      <select value={slot.end} onChange={e => onChange(index, { ...slot, end: e.target.value })}
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-sm outline-none" style={selectStyle}>
        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}

// ─── Gün kartı ───────────────────────────────────────────────────────────────
function DayCard({ day, config, selected, onToggleSelect, onCountChange, onTimeChange }) {
  const count = config.count;
  const times = config.times;

  const handleRowChange = useCallback((idx, updated) => {
    const next = times.map((s, i) => (i === idx ? updated : s));
    onTimeChange(day.index, next);
  }, [times, onTimeChange, day.index]);

  const errorMsg = useMemo(() => {
    let prevEnd = null;
    for (let i = 0; i < times.length; i++) {
      const sM = toMin(times[i].start);
      const eM = toMin(times[i].end);
      if (eM <= sM) return `${i + 1}. ders: bitiş başlangıçtan sonra olmalı`;
      if (prevEnd != null && sM < prevEnd) return `${i + 1}. ders: önceki dersle çakışıyor`;
      prevEnd = eM;
    }
    return null;
  }, [times]);

  let prevEnd = null;

  return (
    <div className="rounded-xl p-3.5" style={{
      border: `1px solid ${selected ? 'var(--accent, #6366f1)' : 'var(--border-subtle)'}`,
      background: day.weekend ? 'var(--bg-subtle, rgba(99,102,241,0.03))' : 'var(--bg-surface)',
    }}>
      {/* Başlık: gün adı + toplu-seç checkbox */}
      <div className="flex items-center justify-between mb-3">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input type="checkbox" checked={selected} onChange={() => onToggleSelect(day.index)}
            className="w-4 h-4 rounded accent-indigo-500" />
          <span className="text-sm" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{day.label}</span>
        </label>
        {/* Ders sayısı seçici */}
        <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          ders
          <select value={count} onChange={e => onCountChange(day.index, parseInt(e.target.value))}
            className="px-1.5 py-1 rounded-lg text-sm outline-none"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}>
            {Array.from({ length: MAX_SLOTS + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      {count === 0 ? (
        <p className="text-xs py-2 text-center" style={{ color: 'var(--text-muted)' }}>Bu gün kapalı (ders yok)</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {times.map((slot, i) => {
            const row = <SlotRow key={i} index={i} slot={slot} prevEnd={prevEnd} onChange={handleRowChange} />;
            prevEnd = toMin(slot.end);
            return row;
          })}
        </div>
      )}
      {errorMsg && <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{errorMsg}</p>}
    </div>
  );
}

// Süre dropdown seçenekleri (dk)
const ETUT_SURE_OPTS = [];
for (let m = 20; m <= 180; m += 5) ETUT_SURE_OPTS.push(m);
const MOLA_SURE_OPTS = [];
for (let m = 0; m <= 60; m += 5) MOLA_SURE_OPTS.push(m);

// ─── Ana bileşen ─────────────────────────────────────────────────────────────
// Props:
//   days: { 0: {count, times:[{start,end}]}, ..., 6: {...} }
//   onDaysChange(newDays)  — days objesi değiştiğinde
//   etutSuresi, molaSuresi, onMetaChange(key, val)
export default function SlotTimeEditor({ days, etutSuresi = 60, molaSuresi = 10, onDaysChange, onMetaChange }) {
  // Toplu düzenleme: işaretli günler. Bir işaretli gün düzenlenince tümüne uygulanır.
  const [selected, setSelected] = useState(() => new Set());

  const toggleSelect = useCallback((dayIndex) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(dayIndex) ? next.delete(dayIndex) : next.add(dayIndex);
      return next;
    });
  }, []);

  // Bir günü güncelle; kaynak gün işaretliyse tüm işaretli günlere aynı config kopyalanır.
  const applyDay = useCallback((srcDay, newConfig) => {
    const next = { ...days };
    // Kaynak gün işaretli DEĞİLSE yalnız o günü değiştir; işaretliyse tüm işaretlileri.
    const targets = selected.has(srcDay) ? [...selected] : [srcDay];
    for (const d of targets) {
      // times'ı derin kopyala (paylaşımlı referans olmasın)
      next[d] = { count: newConfig.count, times: newConfig.times.map(t => ({ ...t })) };
    }
    onDaysChange(next);
  }, [days, selected, onDaysChange]);

  const handleCountChange = useCallback((dayIndex, count) => {
    const cur = days[dayIndex] || { count: 0, times: [] };
    applyDay(dayIndex, { count, times: resizeTimes(cur.times, count) });
  }, [days, applyDay]);

  const handleTimeChange = useCallback((dayIndex, times) => {
    applyDay(dayIndex, { count: times.length, times });
  }, [applyDay]);

  const selectedCount = selected.size;

  return (
    <div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Her günü ayrı düzenle. Ders sayısını seçince o kadar saat satırı gösterilir (0 = gün kapalı).
      </p>

      {/* Toplu düzenleme bilgi çubuğu */}
      <div className="mb-4 px-3 py-2 rounded-lg text-xs flex items-center gap-2 flex-wrap"
        style={{ background: 'var(--bg-subtle, rgba(99,102,241,0.06))', color: 'var(--text-secondary)' }}>
        <span style={{ fontWeight: 600 }}>Toplu düzenleme:</span>
        {selectedCount > 0
          ? <span>{selectedCount} gün işaretli — işaretli bir günü düzenlersen aynı düzen hepsine uygulanır.</span>
          : <span>Aynı anda birden çok günü düzenlemek için günlerin kutucuğunu işaretle.</span>}
        {selectedCount > 0 && (
          <button type="button" onClick={() => setSelected(new Set())}
            className="ml-auto underline" style={{ color: 'var(--accent, #6366f1)' }}>seçimi temizle</button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {GUNLER.map(day => (
          <DayCard
            key={day.index}
            day={day}
            config={days[day.index] || { count: 0, times: [] }}
            selected={selected.has(day.index)}
            onToggleSelect={toggleSelect}
            onCountChange={handleCountChange}
            onTimeChange={handleTimeChange}
          />
        ))}
      </div>

      {/* Etüt takvimi ayarları */}
      <div className="mt-6 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <h3 className="text-sm mb-1" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Etüt Takvimi Ayarları</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          Etüt süresi formda bitişi ön-doldurur. Mola süresi, ders/etüt arası bırakılması gereken en az boşluktur (uyarı için).
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Etüt süresi
            <select value={etutSuresi} onChange={e => onMetaChange?.('etutSuresi', parseInt(e.target.value))}
              className="input !w-auto !text-sm !py-1.5 !px-2">
              {ETUT_SURE_OPTS.map(m => <option key={m} value={m}>{m} dk</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Mola süresi
            <select value={molaSuresi} onChange={e => onMetaChange?.('molaSuresi', parseInt(e.target.value))}
              className="input !w-auto !text-sm !py-1.5 !px-2">
              {MOLA_SURE_OPTS.map(m => <option key={m} value={m}>{m} dk</option>)}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}
