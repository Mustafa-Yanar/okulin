'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Trash2 } from 'lucide-react';

// ─── Sabitler ────────────────────────────────────────────────────────────────
const START_MIN = 9 * 60;        // 09:00
const END_MIN   = 19 * 60 + 20;  // 19:20
const STEP      = 5;             // 5 dakika adım
const ROW_H     = 14;            // her 5dk satırı piksel yüksekliği
const TOTAL_MIN = END_MIN - START_MIN; // 620 dakika
const TOTAL_ROWS = TOTAL_MIN / STEP;   // 124 satır
const GRID_H    = TOTAL_ROWS * ROW_H;  // 1736px

function toMin(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function toTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minToY(min) {
  return ((min - START_MIN) / STEP) * ROW_H;
}

function yToMin(y) {
  const snapped = Math.round(y / ROW_H) * STEP;
  return Math.max(0, Math.min(TOTAL_MIN - STEP, snapped)) + START_MIN;
}

function slotsOverlap(a, b) {
  return toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end);
}

// ─── Tek slot bloğu ─────────────────────────────────────────────────────────
function SlotBlock({ slot, index, onDelete }) {
  const startMin = toMin(slot.start);
  const endMin   = toMin(slot.end);
  const top    = minToY(startMin);
  const height = minToY(endMin) - top;

  return (
    <div
      className="absolute left-1 right-1 rounded-lg flex items-center justify-between px-2 cursor-pointer select-none group"
      style={{
        top,
        height,
        background: 'color-mix(in srgb, var(--brand, #6366f1) 85%, transparent)',
        border: '1px solid color-mix(in srgb, var(--brand, #6366f1) 100%, transparent)',
        zIndex: 2,
      }}
      onClick={e => { e.stopPropagation(); onDelete(index); }}
      title={`${slot.start} – ${slot.end} (sil)`}
    >
      <span className="text-[11px] font-600 text-white leading-none truncate" style={{ fontWeight: 600 }}>
        {height >= 24 ? `${slot.start}–${slot.end}` : slot.start}
      </span>
      {height >= 28 && (
        <Trash2 size={11} className="text-white/70 opacity-0 group-hover:opacity-100 shrink-0 ml-1" />
      )}
    </div>
  );
}

// ─── Saat etiketi sütunu ────────────────────────────────────────────────────
function TimeAxis() {
  const labels = [];
  for (let min = START_MIN; min <= END_MIN; min += 30) {
    labels.push({ min, label: toTime(min) });
  }
  return (
    <div className="relative shrink-0 w-12" style={{ height: GRID_H }}>
      {labels.map(({ min, label }) => (
        <div
          key={label}
          className="absolute right-2 text-[10px] -translate-y-1/2 select-none"
          style={{ top: minToY(min), color: 'var(--text-muted)' }}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

// ─── Tıklanabilir grid alanı ─────────────────────────────────────────────────
function GridArea({ slots, onSlotsChange, maxSlots = 12 }) {
  const containerRef = useRef(null);
  const dragRef = useRef(null); // { startMin, currentMin, active }
  const [preview, setPreview] = useState(null); // { startMin, endMin } drag önizlemesi

  const getMinFromEvent = useCallback((e) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const y = clientY - rect.top;
    return yToMin(y);
  }, []);

  const handleStart = useCallback((e) => {
    if (slots.length >= maxSlots) return;
    e.preventDefault();
    const min = getMinFromEvent(e);
    if (min === null) return;
    dragRef.current = { startMin: min, currentMin: min, active: true };
    setPreview({ startMin: min, endMin: min + STEP });
  }, [slots.length, maxSlots, getMinFromEvent]);

  const handleMove = useCallback((e) => {
    if (!dragRef.current?.active) return;
    e.preventDefault();
    const min = getMinFromEvent(e);
    if (min === null) return;
    dragRef.current.currentMin = min;
    const s = Math.min(dragRef.current.startMin, min);
    const en = Math.max(dragRef.current.startMin, min) + STEP;
    setPreview({ startMin: s, endMin: Math.min(en, END_MIN) });
  }, [getMinFromEvent]);

  const handleEnd = useCallback(() => {
    if (!dragRef.current?.active) return;
    dragRef.current.active = false;

    if (!preview) { setPreview(null); return; }

    const newSlot = {
      start: toTime(preview.startMin),
      end: toTime(Math.min(preview.endMin, END_MIN)),
    };

    // Minimum 10 dk
    if (toMin(newSlot.end) - toMin(newSlot.start) < 10) {
      setPreview(null);
      return;
    }

    // Overlap kontrolü
    const overlaps = slots.some(s => slotsOverlap(s, newSlot));
    if (overlaps) { setPreview(null); return; }

    const updated = [...slots, newSlot].sort((a, b) => toMin(a.start) - toMin(b.start));
    onSlotsChange(updated);
    setPreview(null);
  }, [preview, slots, onSlotsChange]);

  // Mouse olayları
  useEffect(() => {
    const up = () => handleEnd();
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, [handleEnd]);

  const handleDelete = useCallback((idx) => {
    onSlotsChange(slots.filter((_, i) => i !== idx));
  }, [slots, onSlotsChange]);

  // Grid çizgileri: her 30dk'da belirgin, her 5dk'da çok soluk
  const gridLines = [];
  for (let min = START_MIN; min <= END_MIN; min += STEP) {
    const is30 = (min % 30 === 0);
    const is60 = (min % 60 === 0);
    gridLines.push(
      <div
        key={min}
        className="absolute left-0 right-0 pointer-events-none"
        style={{
          top: minToY(min),
          borderTop: `1px solid ${is60 ? 'var(--border-light)' : is30 ? 'var(--border-subtle)' : 'var(--border-subtle)'}`,
          opacity: is60 ? 1 : is30 ? 0.6 : 0.25,
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 rounded-xl overflow-hidden cursor-crosshair"
      style={{
        height: GRID_H,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        userSelect: 'none',
      }}
      onMouseDown={handleStart}
      onMouseMove={handleMove}
      onTouchStart={handleStart}
      onTouchMove={handleMove}
      onTouchEnd={handleEnd}
    >
      {/* Grid çizgileri */}
      {gridLines}

      {/* Mevcut slotlar */}
      {slots.map((slot, i) => (
        <SlotBlock key={i} slot={slot} index={i} onDelete={handleDelete} />
      ))}

      {/* Drag önizlemesi */}
      {preview && (
        <div
          className="absolute left-1 right-1 rounded-lg pointer-events-none"
          style={{
            top: minToY(preview.startMin),
            height: Math.max(minToY(preview.endMin) - minToY(preview.startMin), ROW_H),
            background: 'color-mix(in srgb, var(--brand, #6366f1) 40%, transparent)',
            border: '2px dashed color-mix(in srgb, var(--brand, #6366f1) 80%, transparent)',
            zIndex: 3,
          }}
        />
      )}

      {/* Dolu uyarısı */}
      {slots.length >= maxSlots && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{ background: 'color-mix(in srgb, var(--bg-base) 70%, transparent)' }}
        >
          <span className="text-xs font-600 px-3 py-1.5 rounded-full"
            style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)', fontWeight: 600 }}>
            Maksimum {maxSlots} slot
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Ana bileşen ─────────────────────────────────────────────────────────────
export default function SlotTimeEditor({ weekday, weekend, onChange }) {
  const [activeType, setActiveType] = useState('weekday');
  const slots = activeType === 'weekday' ? weekday : weekend;

  const handleChange = useCallback((updated) => {
    onChange(activeType, updated);
  }, [activeType, onChange]);

  return (
    <div>
      {/* Sekme toggle */}
      <div className="flex gap-1 p-1 rounded-xl w-fit mb-3" style={{ background: 'var(--bg-muted)' }}>
        {[['weekday', 'Hafta İçi'], ['weekend', 'Hafta Sonu']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveType(key)}
            className="px-4 py-2 rounded-lg text-sm transition-all"
            style={{
              fontWeight: activeType === key ? 600 : 400,
              background: activeType === key ? 'var(--bg-surface)' : 'transparent',
              color: activeType === key ? 'var(--text-primary)' : 'var(--text-secondary)',
              boxShadow: activeType === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {label}
            <span className="ml-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              ({(activeType === 'weekday' ? weekday : weekend).length}/12)
            </span>
          </button>
        ))}
      </div>

      {/* Bilgi notu */}
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Boş alana tıklayıp sürükle → slot ekle · Slot üzerine tıkla → sil · 12 slot tamamlanınca kaydet
      </p>

      {/* Grid */}
      <div className="flex gap-3" style={{ maxHeight: 520, overflow: 'hidden' }}>
        <div className="overflow-y-auto flex gap-0 flex-1" style={{ maxHeight: 520 }}>
          <TimeAxis />
          <GridArea
            slots={slots}
            onSlotsChange={handleChange}
            maxSlots={12}
          />
        </div>
      </div>

      {/* Slot sayısı göstergesi */}
      <div className="flex items-center gap-2 mt-3">
        <div className="flex gap-1">
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="w-3 h-3 rounded-sm"
              style={{
                background: i < slots.length
                  ? 'color-mix(in srgb, var(--brand, #6366f1) 80%, transparent)'
                  : 'var(--bg-muted)',
                border: '1px solid var(--border-subtle)',
              }}
            />
          ))}
        </div>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {slots.length}/12 slot
        </span>
        {slots.length < 12 && (
          <span className="text-xs" style={{ color: '#f59e0b' }}>
            — Kaydetmek için 12 slot gerekli
          </span>
        )}
      </div>
    </div>
  );
}
