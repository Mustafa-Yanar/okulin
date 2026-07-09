'use client';

import React, { createContext, useContext, useState } from 'react';

const DEFAULT_WEEKDAY_TIMES = [
  { start: '09:45', end: '10:20' }, { start: '10:30', end: '11:05' },
  { start: '11:15', end: '11:50' }, { start: '12:00', end: '12:35' },
  { start: '13:30', end: '14:05' }, { start: '14:15', end: '14:50' },
  { start: '15:00', end: '15:35' }, { start: '15:45', end: '16:20' },
  { start: '16:30', end: '17:05' }, { start: '17:15', end: '17:50' },
  { start: '18:00', end: '18:35' }, { start: '18:45', end: '19:20' },
];

const DEFAULT_WEEKEND_TIMES = [
  { start: '09:30', end: '10:05' }, { start: '10:15', end: '10:50' },
  { start: '11:00', end: '11:35' }, { start: '11:45', end: '12:20' },
  { start: '12:30', end: '13:05' }, { start: '13:15', end: '13:50' },
  { start: '14:30', end: '15:05' }, { start: '15:15', end: '15:50' },
  { start: '16:00', end: '16:35' }, { start: '16:45', end: '17:20' },
  { start: '17:30', end: '18:05' }, { start: '18:15', end: '18:50' },
];

const SlotTimesContext = createContext(null);

const DEFAULT_ETUT_SURESI = 60;
const DEFAULT_MOLA_SURESI = 10;

// 7-gün days objesinden varsayılan üret (config gelmeden önceki state).
function defaultDays() {
  const days = {};
  for (let d = 0; d < 5; d++) days[d] = { count: 12, times: DEFAULT_WEEKDAY_TIMES };
  for (let d = 5; d < 7; d++) days[d] = { count: 12, times: DEFAULT_WEEKEND_TIMES };
  return days;
}

// GET yanıtı (yeni: {days}) → context state. Geriye uyum: weekday/weekend'i
// gün0/gün5'ten türet, böylece henüz göç etmemiş tüketiciler (TeacherPanel vb.) kırılmaz.
function buildState(src = {}) {
  const days = src.days || defaultDays();
  return {
    days,
    weekday: days[0]?.times || DEFAULT_WEEKDAY_TIMES,   // deprecated geriye uyum
    weekend: days[5]?.times || DEFAULT_WEEKEND_TIMES,    // deprecated geriye uyum
    etutSuresi: src.etutSuresi ?? DEFAULT_ETUT_SURESI,
    molaSuresi: src.molaSuresi ?? DEFAULT_MOLA_SURESI,
  };
}

export function SlotTimesProvider({ children }) {
  const [slotTimes, setSlotTimesState] = useState(() => buildState());

  const updateSlotTimes = (times) => {
    setSlotTimesState(buildState(times));
  };

  return (
    <SlotTimesContext.Provider value={{ slotTimes, updateSlotTimes }}>
      {children}
    </SlotTimesContext.Provider>
  );
}

export function useSlotTimes() {
  const context = useContext(SlotTimesContext);
  if (!context) {
    throw new Error('useSlotTimes must be used within a SlotTimesProvider');
  }
  return context;
}
