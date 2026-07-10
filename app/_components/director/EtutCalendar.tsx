'use client';

// Etüt Takvimi — Google Calendar tarzı zaman şeridi (sıfırdan, kütüphane yok).
// Faz 2: boş iskelet (saat ekseni 07-23, gün sütunları, tarihli + hafta gezinme).
// Ders blokları (Faz 3) ve etüt blokları (Faz 4) bu zemine eklenecek.

import React, { useMemo, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ALL_DAYS, weekRangeLabel, type DayInfo } from '@/lib/constants';

// ─── Zaman ekseni sabitleri ──────────────────────────────────────────────────
export const CAL_START_HOUR = 7;   // 07:00
export const CAL_END_HOUR   = 23;  // 23:00
const HOUR_PX = 48;                // her saat satırı yüksekliği (px)
const TOTAL_HOURS = CAL_END_HOUR - CAL_START_HOUR;
const GRID_HEIGHT = TOTAL_HOURS * HOUR_PX;

// Takvim günü: DayInfo + o haftadaki tarih bilgisi.
export type CalDay = DayInfo & { dateNum: number | ''; isToday: boolean };

// "HH:MM" → günün başından dakika
export function timeToMin(t: string): number {
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// dakika → calendar içinde top (px). CAL_START_HOUR referans alınır.
export function minToTop(min: number): number {
  return ((min - CAL_START_HOUR * 60) / 60) * HOUR_PX;
}

// süre (dk) → yükseklik (px)
export function durationToHeight(durMin: number): number {
  return (durMin / 60) * HOUR_PX;
}

// Hafta anahtarından her günün tarihini (gün sayısı) hesapla → [{index, day, dateNum}]
function daysWithDates(weekKey: string): CalDay[] {
  try {
    const [year, wStr] = String(weekKey).split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(parseInt(year), 0, 4);
    const dow = jan4.getDay() || 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dow + 1 + (week - 1) * 7);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return ALL_DAYS.map(d => {
      const dt = new Date(monday);
      dt.setDate(monday.getDate() + d.index);
      dt.setHours(0, 0, 0, 0);
      return { ...d, dateNum: dt.getDate(), isToday: dt.getTime() === today.getTime() };
    });
  } catch {
    return ALL_DAYS.map(d => ({ ...d, dateNum: '' as const, isToday: false }));
  }
}

interface CalWeekNavProps {
  weekKey: string;
  currentWeek?: string | null;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
}

// ─── Hafta gezinme barı ──────────────────────────────────────────────────────
function WeekNav({ weekKey, currentWeek, canPrev, canNext, onPrev, onNext }: CalWeekNavProps) {
  const r = weekRangeLabel(weekKey);
  return (
    <div className="flex items-center gap-2 mb-3 w-fit">
      <button onClick={onPrev} disabled={!canPrev}
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <div className="text-xs text-center min-w-[150px]" style={{ color: 'var(--text-secondary)' }}>
        <div className="font-600" style={{ fontWeight: 600 }}>{`${r.startStr} – ${r.endStr} ${r.yearStr}`}</div>
        {weekKey === currentWeek
          ? <div className="text-[10px] text-indigo-500 mt-0.5">Bu hafta</div>
          : <div className="text-[10px] text-amber-600 mt-0.5">İleri hafta — bu haftaya uygulanır</div>}
      </div>
      <button onClick={onNext} disabled={!canNext}
        className={`btn-ghost !p-2 ${!canNext ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

interface EtutCalendarProps {
  weekKey: string;
  currentWeek?: string | null;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  headerRight?: ReactNode;
  renderDayContent?: (day: CalDay) => ReactNode;
  hiddenDayIndexes?: number[];
}

// ─── Ana bileşen ─────────────────────────────────────────────────────────────
// Props (Faz 2): weekKey, currentWeek, canPrev, canNext, onPrev, onNext, headerRight
// renderDayContent(day) → o günün sütununa absolute konumlu blokları döndürür (Faz 3+).
export default function EtutCalendar({
  weekKey,
  currentWeek,
  canPrev = true,
  canNext = true,
  onPrev,
  onNext,
  headerRight = null,
  renderDayContent,
  hiddenDayIndexes = [],
}: EtutCalendarProps) {
  const days = useMemo(() => {
    const hidden = new Set(hiddenDayIndexes);
    return daysWithDates(weekKey).filter(d => !hidden.has(d.index));
  }, [weekKey, hiddenDayIndexes]);

  // Saat etiketleri (07:00 … 23:00)
  const hourLabels: string[] = [];
  for (let h = CAL_START_HOUR; h <= CAL_END_HOUR; h++) {
    hourLabels.push(`${String(h).padStart(2, '0')}:00`);
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <WeekNav
          weekKey={weekKey}
          currentWeek={currentWeek}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={onPrev}
          onNext={onNext}
        />
        {headerRight}
      </div>

      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--border-subtle)' }}>
        <div className="min-w-[640px]">
          {/* Gün başlıkları */}
          <div className="flex sticky top-0 z-10" style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
            <div className="shrink-0 w-12" />
            {days.map(d => (
              <div key={d.index} className="flex-1 text-center py-2 min-w-0">
                <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{d.short}</div>
                <div className="text-base" style={{ fontWeight: 600, color: d.isToday ? 'var(--brand,#6366f1)' : 'var(--text-primary)' }}>
                  {d.dateNum}
                </div>
              </div>
            ))}
          </div>

          {/* Grid: saat ekseni + gün sütunları */}
          <div className="flex" style={{ height: GRID_HEIGHT, position: 'relative' }}>
            {/* Saat ekseni */}
            <div className="shrink-0 w-12 relative" style={{ background: 'var(--bg-surface)' }}>
              {hourLabels.map((label, i) => (
                <div key={label} className="absolute right-1.5 text-[10px] -translate-y-1/2"
                  style={{ top: i * HOUR_PX, color: 'var(--text-muted)' }}>
                  {label}
                </div>
              ))}
            </div>

            {/* Gün sütunları */}
            {days.map(d => (
              <div key={d.index} className="flex-1 relative min-w-0"
                style={{ borderLeft: '1px solid var(--border-subtle)' }}>
                {/* Saat çizgileri */}
                {hourLabels.map((_, i) => (
                  <div key={i} className="absolute left-0 right-0 pointer-events-none"
                    style={{ top: i * HOUR_PX, borderTop: '1px solid var(--border-subtle)', opacity: 0.5 }} />
                ))}
                {/* Bloklar (Faz 3+) */}
                {renderDayContent && renderDayContent(d)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
