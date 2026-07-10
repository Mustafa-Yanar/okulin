'use client';

// Panel-bağımsız paylaşılan istemci yardımcıları — TEK kaynak.
// Eskiden api()/getAdjacentWeek()/isSlotPast()/WeekNav kopyaları 5+ panelde
// tekrar ediyordu; hepsi buradan import eder (teknik borç dalgası-1, madde 6).
// Müdür paneline özgü UI primitifleri (Modal, SectionHeader...) director/shared.js'te.

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { weekRangeLabel } from '@/lib/constants';

// Ortak API fetcher — JSON gönderir, hata mesajını fırlatır.
export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

// weekKey'i n hafta ileri/geri taşır (ISO-8601, jan4 tabanlı — sunucu getMondayOfWeek
// ile aynı matematik). Not: eski panel kopyaları Jan-1 tabanlıydı; 1 Ocak'ın Cuma/Cmt/
// Pazar'a denk geldiği yıllarda 1 hafta kayıyordu — konsolidasyonda doğru sürüm esas alındı.
export function getAdjacentWeek(weekKey, delta) {
  try {
    const [year, wStr] = weekKey.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(parseInt(year), 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7 + delta * 7);

    const d = new Date(mon);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
  } catch {
    return weekKey;
  }
}

// Slotun başlangıç anı geçti mi? (yerel saat; slotLabel "HH:MM–HH:MM")
export function isSlotPast(weekKey, dayIndex, slotLabel) {
  try {
    const [year, wStr] = weekKey.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(parseInt(year), 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    const startStr = (slotLabel || '').split('–')[0]?.split(':') || ['0', '0'];
    const hh = parseInt(startStr[0] || '0');
    const mm = parseInt(startStr[1] || '0');
    const slotStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + dayIndex, hh, mm);
    return slotStart.getTime() <= Date.now();
  } catch {
    return false;
  }
}

// Hafta gezinme çubuğu: ‹ 25 Mayıs – 31 Mayıs ›
export function WeekNav({ weekKey, onPrev, onNext, canPrev = true, canNext = true }) {
  const { startStr, endStr } = weekRangeLabel(weekKey);
  return (
    <div className="flex items-center gap-1">
      <button onClick={onPrev} disabled={!canPrev} aria-label="Önceki hafta"
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <span className="text-caption text-center whitespace-nowrap">
        {startStr} – {endStr}
      </span>
      <button onClick={onNext} disabled={!canNext} aria-label="Sonraki hafta"
        className={`btn-ghost !p-2 ${!canNext ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
