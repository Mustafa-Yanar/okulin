'use client';

// Müdür paneli paylaşılan primitifleri ve yardımcıları.
// DirectorPanel ve alt bileşenleri (forms, attendance, history, program, settings)
// bu tek kaynaktan import eder.

import React from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { weekRangeLabel } from '@/lib/constants';

export const GROUPS = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

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

export function Modal({ title, onClose, children, wide, xwide, lockClose }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={lockClose ? undefined : (e => e.target === e.currentTarget && onClose())}>
      <div className={`card-elevated w-full ${xwide ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'} animate-slide-in max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Label({ children }) {
  return <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>{children}</label>;
}

export function FormField({ label, children }) {
  return <div className="mb-4"><Label>{label}</Label>{children}</div>;
}

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

export function WeekNav({ weekKey, onPrev, onNext, canPrev = true, canNext = true }) {
  const { startStr, endStr } = weekRangeLabel(weekKey);
  return (
    <div className="flex items-center gap-1">
      <button onClick={onPrev} disabled={!canPrev}
        className={`btn-ghost !p-2 ${!canPrev ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronLeft size={16} />
      </button>
      <span className="text-xs text-gray-700 text-center whitespace-nowrap">
        {startStr} – {endStr}
      </span>
      <button onClick={onNext} disabled={!canNext}
        className={`btn-ghost !p-2 ${!canNext ? 'opacity-30 cursor-not-allowed' : ''}`}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

export function isSlotPast(weekKey, dayIndex, slotLabel) {
  try {
    const [year, wStr] = weekKey.split('-W');
    const week = parseInt(wStr);
    const jan4 = new Date(parseInt(year), 0, 4);
    const dayOfWeek = jan4.getDay() || 7;
    const mon = new Date(jan4);
    mon.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
    const startStr = (slotLabel || '').split('–')[0]?.split(':') || ['0','0'];
    const hh = parseInt(startStr[0] || '0');
    const mm = parseInt(startStr[1] || '0');
    const slotStart = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + dayIndex, hh, mm);
    return slotStart.getTime() <= Date.now();
  } catch {
    return false;
  }
}

export function guidanceSubjectsFor(cls) {
  if (!cls) return [];
  if (cls.startsWith('7')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  }
  if (cls.startsWith('8')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  }
  let isSayisal = false;
  let isEA = false;
  let grade = 0;
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    isSayisal = n <= 5;
    isEA = n > 5;
    grade = 12;
  } else {
    grade = Math.floor(parseInt(cls) / 100);
    const sec = parseInt(cls.slice(1));
    if (grade === 3) { isSayisal = sec <= 3; isEA = sec > 3; }
    if (grade === 4) { isSayisal = sec <= 5; isEA = sec > 5; }
  }
  if (grade === 1 || grade === 2) {
    return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (grade === 3) {
    if (isSayisal) return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji'];
    return ['Türkçe', 'Matematik', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (isSayisal) {
    return [
      'Türkçe',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik', 'AYT Fizik',
      'TYT Kimya', 'AYT Kimya',
      'TYT Biyoloji', 'AYT Biyoloji',
      'TYT Tarih', 'TYT Coğrafya', 'TYT Felsefe', 'Din Kültürü',
    ];
  }
  if (isEA) {
    return [
      'Türkçe', 'Edebiyat',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik', 'TYT Kimya', 'TYT Biyoloji',
      'TYT Tarih', 'AYT Tarih', 'TYT Coğrafya', 'AYT Coğrafya', 'TYT Felsefe', 'AYT Felsefe', 'Din Kültürü',
    ];
  }
  return [];
}
