'use client';

import React, { useMemo } from 'react';
import { ALL_DAYS, daySlots as buildDaySlots } from '@/lib/constants';
import type { DayInfo, Slot } from '@/lib/constants';
import type { SlotCell as SlotCellData, ProgramEntry } from '@/lib/slots';
import { useClasses } from './ClassesContext';
import { useSlotTimes } from './SlotTimesContext';
import { classShortUpper } from '@/lib/classCatalog';
import { isSlotPast } from './shared';

// SALT-GÖRÜNTÜLEME grid (2026-07-22 denetim B3): rezervasyon etkileşimi (öğrenci atama
// modalı, iptal butonu, forceOpen) KALDIRILDI — etüt rezervasyonu tek kapıdan yürür
// (öğretmen "Etütler" sekmesi → /api/etut-sablon/rezervasyon). Bu grid yalnız haftalık
// DERS programını ve açık/kapalı saatleri gösterir. Tek tüketici: TeacherPanel.

// /api/slots grid yanıtı: gün → slotIdx → hücre. Program: gün → slotId → giriş.
type TeacherGrid = Record<number, SlotCellData[]>;
type ProgramGrid = Record<string, Record<string, ProgramEntry | null>>;

interface SlotCellProps {
  slotData: SlotCellData;
  progEntry?: ProgramEntry | null;
  slot: Slot;
  dayIndex: number;
  weekKey: string;
  asDiv?: boolean;
}

// SlotCell — desktop'ta <td>, mobile'da <div> olarak sarılır (asDiv prop'u).
function SlotCell({ slotData, progEntry, slot, dayIndex, weekKey, asDiv = false }: SlotCellProps) {
  const { classes } = useClasses(); // s_ UUID şube kimliklerini kayıtlı ada çevirmek için
  const Wrap = asDiv ? 'div' : 'td';
  const isPast = isSlotPast(weekKey, dayIndex, slot.label);
  const isLessonFromProg = progEntry?.type === 'ders';
  const isLessonFromGrid = slotData?.lessonType === 'ders';
  const isLesson = isLessonFromProg || isLessonFromGrid;
  const lessonCls = isLessonFromProg ? progEntry?.cls : slotData?.cls;
  const lessonSubBranch = isLessonFromProg ? progEntry?.subBranch : slotData?.subBranch;
  const lessonIsTemp = slotData?.lessonType === 'ders' && slotData.fixed === false;

  if (isLesson) {
    const cls = lessonCls ? classShortUpper(classes, lessonCls) : '—';
    const subShort = lessonSubBranch === 'TYT Matematik' ? 'TYT' : lessonSubBranch === 'AYT Matematik' ? 'AYT' : lessonSubBranch === 'Geometri' ? 'Geo' : lessonSubBranch;
    return (
      <Wrap className="py-1 px-1">
        <div className={`rounded-lg py-1.5 px-1 text-center bg-blue-50 border select-none ${lessonIsTemp ? 'border-dashed border-blue-300' : 'border-blue-100'}`}>
          <div className="text-[10px] font-600 text-blue-700 truncate" style={{ fontWeight: 600 }}>{cls}</div>
          {subShort && <div className="text-[9px] text-blue-500 truncate">{subShort}</div>}
          <div className="text-[9px] text-blue-400">{lessonIsTemp ? 'Geçici ders' : 'Ders'}</div>
        </div>
      </Wrap>
    );
  }

  if (slotData.disabled) {
    if (slotData.eventBlocked) {
      return (
        <Wrap className="py-1 px-1">
          <div className="rounded-lg py-2 px-1 text-center text-[10px] text-rose-700 bg-rose-100 border border-rose-200 select-none truncate" title={slotData.eventTitle || 'Etkinlik'}>
            {slotData.eventTitle || 'Etkinlik'}
          </div>
        </Wrap>
      );
    }
    return (
      <Wrap className="py-1 px-1">
        <div className="rounded-lg py-2 px-1 text-center text-xs text-gray-200 bg-gray-50 border border-gray-100 select-none">✕</div>
      </Wrap>
    );
  }

  if (isPast) {
    return (
      <Wrap className="py-1 px-1">
        <div className="rounded-lg py-2 px-1 text-center text-xs text-gray-200 bg-gray-50 border border-gray-100 select-none" title="Bu saat dilimi geçmiş">✕</div>
      </Wrap>
    );
  }

  return (
    <Wrap className="py-1 px-1">
      <div className="rounded-lg py-2 px-1 text-center border border-dashed border-emerald-200 bg-emerald-50/50 text-[10px] text-emerald-500 select-none">Açık</div>
    </Wrap>
  );
}

interface MobileDayCardProps {
  day: DayInfo;
  slots: Slot[];
  grid?: TeacherGrid | null;
  program?: ProgramGrid | null;
  weekKey: string;
}

// MobileDayCard — bir günün tüm slot'larını dikey kart olarak gösterir (mobile).
// Boş, kapalı + geçmiş ve ders olmayan slot'ları gizler (kalabalığı azaltır).
function MobileDayCard({ day, slots, grid, program, weekKey }: MobileDayCardProps) {

  // Hangi slot'lar gösterilsin? Kapalı/geçmiş olanları atla; ders veya açık saat göster.
  const visibleEntries = slots.map((slot, slotIdx) => {
    const slotData = (grid && grid[day.index] && grid[day.index][slotIdx]) || { booked: false, disabled: true };
    const progEntry = program?.[String(day.index)]?.[slot.id];
    const isLesson = progEntry?.type === 'ders' || slotData?.lessonType === 'ders';
    const isAvailable = !slotData.disabled;
    if (!isLesson && !isAvailable) return null;
    return { slot, slotIdx, slotData, progEntry };
  }).filter((x): x is NonNullable<typeof x> => Boolean(x));

  if (visibleEntries.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between ${day.weekend ? 'bg-brand-soft' : 'bg-gray-50/50'}`}>
        <div>
          <div className={`font-700 text-sm ${day.weekend ? 'text-brand' : 'text-gray-900'}`} style={{ fontWeight: 700 }}>{day.label}</div>
          {day.weekend && <div className="text-[10px] text-brand">Hafta sonu</div>}
        </div>
        <span className="text-xs text-gray-400">{visibleEntries.length} slot</span>
      </div>
      <div className="divide-y divide-gray-50">
        {visibleEntries.map(({ slot, slotIdx, slotData, progEntry }) => (
          <div key={slot.id} className="px-3 py-2 flex items-center gap-3">
            <div className="text-[11px] text-gray-500 font-500 whitespace-nowrap w-20 shrink-0" style={{ fontWeight: 500 }}>
              {slot.label}
            </div>
            <div className="flex-1 min-w-0">
              <SlotCell
                slotData={slotData}
                progEntry={progEntry}
                slot={slot}
                dayIndex={day.index}
                weekKey={weekKey}
                asDiv
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface SlotGridProps {
  grid?: TeacherGrid | null;
  program?: ProgramGrid | null;
  weekKey: string;
  hideEmptyDays?: boolean;
}

export default function SlotGrid({ grid, program, weekKey, hideEmptyDays }: SlotGridProps) {
  const { slotTimes } = useSlotTimes();
  // Her gün için slot listesi (7-gün model: gün-başına farklı sayı/saat).
  const daySlotsMap = useMemo(() => {
    const map: Record<number, Slot[]> = {};
    for (const day of ALL_DAYS) map[day.index] = buildDaySlots(day.index, slotTimes.days?.[day.index]);
    return map;
  }, [slotTimes]);

  const visibleDays = useMemo(() => {
    if (!hideEmptyDays) return ALL_DAYS;
    if (program && Object.keys(program).length > 0) {
      return ALL_DAYS.filter(day => {
        const dayProg = program[String(day.index)] || {};
        return Object.values(dayProg).some(entry => entry && entry.type);
      });
    }
    if (!grid) return ALL_DAYS;
    return ALL_DAYS.filter(day => {
      const slots = daySlotsMap[day.index] || [];
      return slots.some((_, slotIdx) => {
        const sd = grid[day.index]?.[slotIdx];
        return sd && !sd.disabled;
      });
    });
  }, [grid, program, hideEmptyDays, daySlotsMap]);

  const colCount = visibleDays.length;

  return (
    <div>
      {/* DESKTOP: tablo görünümü (md ve üstü) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm table-fixed">
          <thead>
            <tr>
              <th className="text-left py-2 px-3 text-xs text-gray-400 font-600 w-24" style={{ fontWeight: 600 }}>Saat</th>
              {visibleDays.map(day => (
                <th key={day.index} className={`text-center py-2 px-1 text-xs font-600 ${day.weekend ? 'text-brand' : 'text-gray-500'}`} style={{ fontWeight: 600, width: `calc((100% - 6rem) / ${colCount})` }}>
                  {day.short}
                  {day.weekend && <span className="block text-[9px] text-brand">H.sonu</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              // 7-gün model: her günün slot sayısı farklı olabilir. Satır sayısı = görünen
              // günlerin en fazla slotu. Her hücre KENDİ gününün slotunu kullanır; label
              // sütunu ilk görünen günün o satırdaki saatini referans gösterir (kaba).
              const maxRows = Math.max(0, ...visibleDays.map(d => (daySlotsMap[d.index] || []).length));
              return Array.from({ length: maxRows }, (_, rowIdx) => {
                const refSlot = visibleDays.map(d => (daySlotsMap[d.index] || [])[rowIdx]).find(Boolean);
                return (
                  <tr key={rowIdx} className="border-t border-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-500 font-500 whitespace-nowrap" style={{ fontWeight: 500 }}>
                      {refSlot ? refSlot.label : ''}
                    </td>
                    {visibleDays.map(day => {
                      const slot = (daySlotsMap[day.index] || [])[rowIdx];
                      if (!slot) return <td key={day.index} className="py-1 px-1"><div className="rounded-lg py-2 bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs">—</div></td>;
                      const slotData = (grid && grid[day.index] && grid[day.index][rowIdx]) || { booked: false, disabled: true };
                      const progEntry = program?.[String(day.index)]?.[slot.id];
                      return <SlotCell key={day.index} slotData={slotData} progEntry={progEntry} slot={slot} dayIndex={day.index} weekKey={weekKey} />;
                    })}
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>

      {/* MOBILE: gün gün dikey kart listesi (md altı) */}
      <div className="md:hidden space-y-3">
        {visibleDays.map(day => (
          <MobileDayCard
            key={day.index}
            day={day}
            slots={daySlotsMap[day.index] || []}
            grid={grid}
            program={program}
            weekKey={weekKey}
          />
        ))}
      </div>
    </div>
  );
}
