'use client';

import React, { createContext, useContext, useState } from 'react';
import type { SlotTime } from '@/lib/constants';
import type { DaySlotConfig } from '@/lib/slots';

const DEFAULT_WEEKDAY_TIMES: SlotTime[] = [
  { start: '09:45', end: '10:20' }, { start: '10:30', end: '11:05' },
  { start: '11:15', end: '11:50' }, { start: '12:00', end: '12:35' },
  { start: '13:30', end: '14:05' }, { start: '14:15', end: '14:50' },
  { start: '15:00', end: '15:35' }, { start: '15:45', end: '16:20' },
  { start: '16:30', end: '17:05' }, { start: '17:15', end: '17:50' },
  { start: '18:00', end: '18:35' }, { start: '18:45', end: '19:20' },
];

const DEFAULT_WEEKEND_TIMES: SlotTime[] = [
  { start: '09:30', end: '10:05' }, { start: '10:15', end: '10:50' },
  { start: '11:00', end: '11:35' }, { start: '11:45', end: '12:20' },
  { start: '12:30', end: '13:05' }, { start: '13:15', end: '13:50' },
  { start: '14:30', end: '15:05' }, { start: '15:15', end: '15:50' },
  { start: '16:00', end: '16:35' }, { start: '16:45', end: '17:20' },
  { start: '17:30', end: '18:05' }, { start: '18:15', end: '18:50' },
];

// GET /api/slot-times yanıtı — updateSlotTimes girişi (alanlar eksik olabilir).
export interface SlotTimesInput {
  days?: Record<number, DaySlotConfig>;
  etutSuresi?: number;
  molaSuresi?: number;
}

// Context'te tutulan normalize state: 7-gün + deprecated weekday/weekend türetimi.
export interface SlotTimesState {
  days: Record<number, DaySlotConfig>;
  weekday: SlotTime[];
  weekend: SlotTime[];
  etutSuresi: number;
  molaSuresi: number;
}

interface SlotTimesContextValue {
  slotTimes: SlotTimesState;
  updateSlotTimes: (times: SlotTimesInput) => void;
}

const SlotTimesContext = createContext<SlotTimesContextValue | null>(null);

const DEFAULT_ETUT_SURESI = 60;
const DEFAULT_MOLA_SURESI = 10;

// 7-gün days objesinden varsayılan üret (config gelmeden önceki state).
function defaultDays(): Record<number, DaySlotConfig> {
  const days: Record<number, DaySlotConfig> = {};
  for (let d = 0; d < 5; d++) days[d] = { count: 12, times: DEFAULT_WEEKDAY_TIMES };
  for (let d = 5; d < 7; d++) days[d] = { count: 12, times: DEFAULT_WEEKEND_TIMES };
  return days;
}

// GET yanıtı (yeni: {days}) → context state. Geriye uyum: weekday/weekend'i
// gün0/gün5'ten türet, böylece henüz göç etmemiş tüketiciler (TeacherPanel vb.) kırılmaz.
function buildState(src: SlotTimesInput = {}): SlotTimesState {
  const days = src.days || defaultDays();
  return {
    days,
    weekday: days[0]?.times || DEFAULT_WEEKDAY_TIMES,   // deprecated geriye uyum
    weekend: days[5]?.times || DEFAULT_WEEKEND_TIMES,    // deprecated geriye uyum
    etutSuresi: src.etutSuresi ?? DEFAULT_ETUT_SURESI,
    molaSuresi: src.molaSuresi ?? DEFAULT_MOLA_SURESI,
  };
}

interface SlotTimesProviderProps {
  children: React.ReactNode;
}

export function SlotTimesProvider({ children }: SlotTimesProviderProps) {
  const [slotTimes, setSlotTimesState] = useState<SlotTimesState>(() => buildState());

  const updateSlotTimes = (times: SlotTimesInput) => {
    setSlotTimesState(buildState(times));
  };

  return (
    <SlotTimesContext.Provider value={{ slotTimes, updateSlotTimes }}>
      {children}
    </SlotTimesContext.Provider>
  );
}

export function useSlotTimes(): SlotTimesContextValue {
  const context = useContext(SlotTimesContext);
  if (!context) {
    throw new Error('useSlotTimes must be used within a SlotTimesProvider');
  }
  return context;
}
