'use client';

import React, { useMemo, useCallback } from 'react';

// ─── Sabitler ────────────────────────────────────────────────────────────────
const START_MIN = 7 * 60;        // 07:00
const END_MIN   = 23 * 60;       // 23:00
const STEP      = 5;             // 5 dakika adım
const SLOT_COUNT = 12;

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

// ─── Tek slot satırı ─────────────────────────────────────────────────────────
function SlotRow({ index, slot, prevEnd, onChange }) {
  const startM = toMin(slot.start);
  const endM   = toMin(slot.end);

  // Hata tespiti (API kurallarıyla birebir)
  const endError    = endM <= startM;
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
      <select
        value={slot.start}
        onChange={e => onChange(index, { ...slot, start: e.target.value })}
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-sm outline-none"
        style={selectStyle}
      >
        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>–</span>
      <select
        value={slot.end}
        onChange={e => onChange(index, { ...slot, end: e.target.value })}
        className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-sm outline-none"
        style={selectStyle}
      >
        {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  );
}

// ─── Gün tipi sütunu (hafta içi / hafta sonu) ────────────────────────────────
function DayColumn({ title, slots, onSlotsChange }) {
  const handleRowChange = useCallback((idx, updated) => {
    const next = slots.map((s, i) => (i === idx ? updated : s));
    onSlotsChange(next);
  }, [slots, onSlotsChange]);

  // İlk hatalı satırın mesajı (kullanıcıya tek özet)
  const errorMsg = useMemo(() => {
    let prevEnd = null;
    for (let i = 0; i < slots.length; i++) {
      const sM = toMin(slots[i].start);
      const eM = toMin(slots[i].end);
      if (eM <= sM) return `${i + 1}. slot: bitiş, başlangıçtan sonra olmalı`;
      if (prevEnd != null && sM < prevEnd) return `${i + 1}. slot: önceki slotla çakışıyor`;
      prevEnd = eM;
    }
    return null;
  }, [slots]);

  let prevEnd = null;

  return (
    <div className="flex-1 min-w-0">
      <h3 className="text-sm mb-2.5" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">
        {slots.map((slot, i) => {
          const row = (
            <SlotRow
              key={i}
              index={i}
              slot={slot}
              prevEnd={prevEnd}
              onChange={handleRowChange}
            />
          );
          prevEnd = toMin(slot.end);
          return row;
        })}
      </div>
      {errorMsg && (
        <p className="text-xs mt-2" style={{ color: '#ef4444' }}>{errorMsg}</p>
      )}
    </div>
  );
}

// Süre dropdown seçenekleri (dk)
const ETUT_SURE_OPTS = [];
for (let m = 20; m <= 180; m += 5) ETUT_SURE_OPTS.push(m);
const MOLA_SURE_OPTS = [];
for (let m = 0; m <= 60; m += 5) MOLA_SURE_OPTS.push(m);

// ─── Ana bileşen ─────────────────────────────────────────────────────────────
export default function SlotTimeEditor({ weekday, weekend, etutSuresi = 60, molaSuresi = 10, onChange, onMetaChange }) {
  return (
    <div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Her slotun başlangıç ve bitiş saatini seç. Her gün tipi için {SLOT_COUNT} slot bulunur.
      </p>

      <div className="flex flex-col sm:flex-row gap-6">
        <DayColumn
          title="Hafta İçi"
          slots={weekday}
          onSlotsChange={slots => onChange('weekday', slots)}
        />
        <DayColumn
          title="Hafta Sonu"
          slots={weekend}
          onSlotsChange={slots => onChange('weekend', slots)}
        />
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
