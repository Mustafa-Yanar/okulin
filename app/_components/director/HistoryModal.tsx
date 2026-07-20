'use client';

// Öğrenci/öğretmen etüt geçmişi modalı (arşiv) + öğrenci devamsızlık sekmesi + yazdırma.
import React, { useState, useEffect, useMemo } from 'react';
import { BookOpen, ClipboardList, Clock } from 'lucide-react';
import { api, Modal } from './shared';
import { useClasses } from '../ClassesContext';
import { classShortUpper } from '@/lib/classCatalog';

// Arşiv satırı (GET /api/archive week.entries elemanı). "Bu hafta" satırları
// canlı slot verisinden kurulur; oradan gelen ek alanlar da opsiyonel taşınır.
interface ArchiveEntry {
  day: number;
  dayLabel: string;
  slotId: string;
  slotLabel: string;
  studentId?: string | null;
  studentName?: string | null;
  studentCls?: string | null;
  teacherId?: string;
  teacherName?: string;
  branch?: string;
  bookedBy?: string | null;
  fixed?: boolean;
}
interface ArchiveWeek {
  weekKey?: string;
  entries: ArchiveEntry[];
  isCurrent?: boolean;
}
// GET /api/attendance/student satırı.
interface AttendanceEntry {
  date: string;
  dayLabel?: string;
  status: string;
  isEtut?: boolean;
  lessonNo?: number;
  slotLabel?: string;
  teacherName?: string;
  branch?: string;
  subBranch?: string;
}
interface AttendanceData {
  entries: AttendanceEntry[];
  summary: { yok: number; gec: number };
}

interface HistoryModalProps {
  target: { type: string; id: string; name: string };
  onClose?: () => void;
  currentWeekKey?: string;
  currentEntries?: ArchiveEntry[];
  inline?: boolean;
}

export default function HistoryModal({ target, onClose, currentWeekKey, currentEntries, inline = false }: HistoryModalProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad
  const isStudent = target.type === 'student';
  const [activeTab, setActiveTab] = useState('etut');
  const [weeks, setWeeks] = useState<ArchiveWeek[]>([]);
  const [loading, setLoading] = useState(true);
  const [attendance, setAttendance] = useState<AttendanceData | null>(null);
  const [attLoading, setAttLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const printRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api<{ weeks?: ArchiveWeek[] }>(`/api/archive?type=${target.type}&id=${target.id}`);
        setWeeks(data.weeks || []);
      } catch (e) {
        setLoadError('Arşiv yüklenemedi: ' + (e as Error).message);
      }
      setLoading(false);
    })();
  }, [target.id, target.type]);

  useEffect(() => {
    if (!isStudent || activeTab !== 'devamsizlik' || attendance !== null) return;
    (async () => {
      setAttLoading(true);
      try {
        const data = await api<AttendanceData>(`/api/attendance/student?studentId=${target.id}`);
        setAttendance(data);
      } catch (e) {
        // Boş-özet fallback davranışı KORUNUR (T6 öncesi davranışla aynı) — yalnız artık
        // hata da loadError ile görünür olur (Faz 4 T6, sessiz-catch temizliği).
        setAttendance({ entries: [], summary: { yok: 0, gec: 0 } });
        setLoadError('Devamsızlık verisi yüklenemedi: ' + (e as Error).message);
      }
      setAttLoading(false);
    })();
  }, [activeTab, isStudent, target.id, attendance]);

  const allWeeks = useMemo(() => {
    const result: ArchiveWeek[] = [];
    const archiveCurrent = currentWeekKey ? weeks.find(w => w.weekKey === currentWeekKey) : undefined;
    const rest = currentWeekKey ? weeks.filter(w => w.weekKey !== currentWeekKey) : weeks;
    // Cari haftanın ETÜT satırları (EtutReservation-kaynaklı, slotId 'etut:' prefix'li — Faz 4 T3)
    // canlı currentEntries'te (SlotBooking-kaynaklı) OLAMAZ → "Bu Hafta" kartına eklenir.
    // Arşivdeki cari-hafta SlotBooking satırları ise currentEntries'in kopyası olurdu → atlanır
    // (çift-kart + çift-satır düzeltmesi; geçmiş haftalar etkilenmez).
    const currentEtut = archiveCurrent?.entries.filter(e => e.slotId.startsWith('etut:')) ?? [];
    // currentEntries (canlı SlotBooking) undefined/boşken arşivin cari-hafta DERS satırları
    // düşmesin (Faz 4 audit-fix FIX-2 B, Gemini YÜKSEK-1 savunmacı bulgu) — çağıran (inline
    // kullanım) currentEntries geçmezse arşivdeki cari-hafta ders satırlarına geri düş.
    const currentSlots = (currentEntries && currentEntries.length > 0)
      ? currentEntries
      : (archiveCurrent?.entries.filter(e => !e.slotId.startsWith('etut:')) ?? []);
    const current = [...currentSlots, ...currentEtut];
    if (current.length > 0) result.push({ weekKey: currentWeekKey, entries: current, isCurrent: true });
    result.push(...rest);
    return result;
  }, [weeks, currentEntries, currentWeekKey]);

  const handlePrint = () => {
    const s = {
      body: 'font-family:Arial,sans-serif;font-size:13px;color:#111;padding:24px;',
      h1: 'font-size:18px;margin:0 0 4px;',
      sub: 'color:#666;font-size:12px;margin-bottom:20px;',
      week: 'margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;',
      weekTitle: 'font-size:13px;font-weight:bold;background-color:#f3f4f6;padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#1f2937;',
      dayTitle: 'font-size:11px;font-weight:bold;color:#4f46e5;margin:10px 0 4px 4px;',
      entry: 'display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background-color:#f9fafb;border:1px solid #f3f4f6;border-radius:6px;margin-bottom:4px;',
      entryLeft: 'font-size:12px;font-weight:600;color:#1f2937;',
      entryRight: 'font-size:11px;color:#6b7280;',
    };
    let html = `<html><head><title>${target.name} – Etüt Geçmişi</title>
    <style>* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }</style>
    </head><body style="${s.body}">`;
    html += `<h1 style="${s.h1}">${target.name}</h1><div style="${s.sub}">Etüt Geçmişi</div>`;
    allWeeks.forEach(week => {
      const badge = week.isCurrent ? ' <span style="font-size:10px;background-color:#e0e7ff;color:#4338ca;padding:2px 8px;border-radius:99px;font-weight:normal;margin-left:6px;">Bu Hafta</span>' : '';
      html += `<div style="${s.week}"><div style="${s.weekTitle}">${weekLabel(week.weekKey)}${badge}</div><div style="padding:8px 10px;">`;
      const byDay: Record<number, { dayLabel: string; entries: ArchiveEntry[] }> = {};
      week.entries.forEach(e => {
        if (!byDay[e.day]) byDay[e.day] = { dayLabel: e.dayLabel, entries: [] };
        byDay[e.day].entries.push(e);
      });
      Object.values(byDay).sort((a,b) => a.entries[0].day - b.entries[0].day).forEach(day => {
        html += `<div style="${s.dayTitle}">${day.dayLabel}</div>`;
        day.entries.sort((a,b) => a.slotId.localeCompare(b.slotId)).forEach(e => {
          const right = target.type === 'teacher'
            ? `${e.studentName} · ${classShortUpper(classes, e.studentCls||'')}`
            : `${e.teacherName} · ${e.branch}`;
          html += `<div style="${s.entry}"><span style="${s.entryLeft}">${e.slotLabel}</span><span style="${s.entryRight}">${right}</span></div>`;
        });
      });
      html += `</div></div>`;
    });
    html += '</body></html>';
    const w = window.open('', '_blank');
    w!.document.write(html);
    w!.document.close();
    setTimeout(() => w!.print(), 300);
  };

  const weekLabel = (wk: string | undefined) => {
    try {
      const [year, week] = wk!.split('-W');
      const jan4 = new Date(parseInt(year), 0, 4);
      const dayOfWeek = jan4.getDay() || 7;
      const monday = new Date(jan4);
      monday.setDate(jan4.getDate() - dayOfWeek + 1 + (parseInt(week) - 1) * 7);
      const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      const fmt = (d: Date) => d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
      return `${fmt(monday)} – ${fmt(sunday)} ${year}`;
    } catch { return wk; }
  };

  const modalTitle = isStudent
    ? `${target.name} – Geçmiş`
    : `${target.name} – Geçmiş Etütler`;

  const etutContent = (
    loading ? (
      <div className="py-12 text-center text-caption">Yükleniyor...</div>
    ) : allWeeks.length === 0 ? (
      <div className="py-12 text-center text-gray-400">
        <Clock size={32} className="mx-auto mb-2 opacity-30" />
        <p>Henüz etüt yok</p>
        <p className="text-caption mt-1">Geçmiş haftalar her Pazar arşivlenir</p>
      </div>
    ) : (
      <>
        <div className="flex justify-end mb-4">
          <button onClick={handlePrint} className="btn-ghost !px-4 !py-2 flex items-center gap-2 text-sm text-brand">
            <BookOpen size={14} /> PDF / Yazdır
          </button>
        </div>
        <div className="space-y-4" ref={printRef}>
          {allWeeks.map(week => {
              const byDay: Record<number, { dayLabel: string; entries: ArchiveEntry[] }> = {};
              week.entries.forEach(e => {
                if (!byDay[e.day]) byDay[e.day] = { dayLabel: e.dayLabel, entries: [] };
                byDay[e.day].entries.push(e);
              });
              const sortedDays = Object.values(byDay).sort((a,b) => a.entries[0].day - b.entries[0].day);
              return (
                <div key={week.weekKey} className="card overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                    <span className="font-700 text-sm text-gray-800" style={{ fontWeight: 700 }}>{weekLabel(week.weekKey)}</span>
                    {week.isCurrent && <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-soft text-brand font-600" style={{ fontWeight: 600 }}>Bu Hafta</span>}
                  </div>
                  <div className="p-3 space-y-3">
                    {sortedDays.map(day => (
                      <div key={day.dayLabel}>
                        <div className="text-xs font-700 text-brand mb-1.5 px-1" style={{ fontWeight: 700 }}>{day.dayLabel}</div>
                        <div className="space-y-1">
                          {day.entries.sort((a,b) => a.slotId.localeCompare(b.slotId)).map((e,i) => (
                            <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 border border-gray-100 text-sm">
                              <div className="flex items-center gap-2">
                                <Clock size={12} className="text-brand shrink-0" />
                                <span className="font-600 text-gray-800 text-xs" style={{ fontWeight: 600 }}>{e.slotLabel}</span>
                              </div>
                              <span className="text-xs text-gray-500">
                                {target.type === 'teacher'
                                  ? `${e.studentName} · ${classShortUpper(classes, e.studentCls||'')}`
                                  : `${e.teacherName} · ${e.branch}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )
    );

  const devamsizlikContent = (
    attLoading || attendance === null ? (
      <div className="py-12 text-center text-caption">Yükleniyor...</div>
    ) : attendance.entries.length === 0 ? (
      <div className="py-12 text-center text-caption">
        <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
        <p>Devamsızlık kaydı yok</p>
        <p className="text-caption mt-1">Yok veya geç olarak işaretlenmiş ders bulunmuyor</p>
      </div>
    ) : (
      <>
        <div className="flex items-center gap-2 mb-4">
          {attendance.summary.yok > 0 && (
            <span className="badge badge-danger">
              {attendance.summary.yok} Yok
            </span>
          )}
          {attendance.summary.gec > 0 && (
            <span className="badge badge-warning">
              {attendance.summary.gec} Geç
            </span>
          )}
          <span className="text-caption ml-1">Toplam {attendance.entries.length} kayıt</span>
        </div>
        <div className="space-y-1.5">
          {(() => {
            const byDate: Record<string, AttendanceEntry[]> = {};
            for (const e of attendance.entries) {
              if (!byDate[e.date]) byDate[e.date] = [];
              byDate[e.date].push(e);
            }
            return Object.entries(byDate).map(([date, items]) => {
              const d = new Date(date);
              const fmtDate = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
              return (
                <div key={date} className="card overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                    <div>
                      <span className="font-700 text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fmtDate}</span>
                      <span className="text-caption ml-2">{items[0].dayLabel}</span>
                    </div>
                  </div>
                  <div className="p-2 space-y-1">
                    {items.map((e, i) => {
                      const statusClass = e.status === 'yok'
                        ? 'bg-red-50 border-red-100 text-red-700'
                        : 'bg-amber-50 border-amber-100 text-amber-700';
                      return (
                        <div key={i} className={`flex items-center justify-between px-3 py-2 rounded-lg border text-sm ${statusClass}`}>
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-700 shrink-0 ${e.status === 'yok' ? 'bg-red-200 text-red-800' : 'bg-amber-200 text-amber-800'}`} style={{ fontWeight: 700 }}>
                              {e.status === 'yok' ? 'YOK' : 'GEÇ'}
                            </span>
                            <span className="text-xs font-600 shrink-0" style={{ fontWeight: 600 }}>{e.isEtut ? 'Etüt' : `${e.lessonNo}. Ders`}</span>
                            {e.slotLabel && <span className="text-xs opacity-70 shrink-0">({e.slotLabel})</span>}
                          </div>
                          <span className="text-xs opacity-70 text-right truncate ml-2">
                            {e.teacherName}{(e.subBranch || e.branch) ? ` · ${e.subBranch || e.branch}` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </>
    )
  );

  const inner = (
    <>
      {isStudent && (
        <div className="pill-tabs mb-4">
          <button
            onClick={() => setActiveTab('etut')}
            className={`pill-tab${activeTab === 'etut' ? ' is-active' : ''}`}>
            <Clock size={13} /> <span>Geçmiş Etütler</span>
          </button>
          <button
            onClick={() => setActiveTab('devamsizlik')}
            className={`pill-tab${activeTab === 'devamsizlik' ? ' is-active' : ''}`}>
            <ClipboardList size={13} /> <span>Devamsızlık Bilgisi</span>
          </button>
        </div>
      )}
      {loadError && (
        <div className="card p-3 mb-3 text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{loadError}</div>
      )}
      {(!isStudent || activeTab === 'etut') && etutContent}
      {isStudent && activeTab === 'devamsizlik' && devamsizlikContent}
    </>
  );

  if (inline) return <div className="py-2">{inner}</div>;
  return <Modal title={modalTitle} onClose={onClose ?? (() => {})} wide>{inner}</Modal>;
}
