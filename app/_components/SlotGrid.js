'use client';

import React, { useState, useMemo } from 'react';
import { X } from 'lucide-react';
import {
  allowedBranchesForClass,
  classLabel,
  ALL_DAYS,
  slotsForDay,
  WEEKDAY_SLOTS,
  WEEKEND_SLOTS
} from '@/lib/constants';

// Helper: Modal Component
function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-700 text-gray-900 text-base" style={{ fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Kapat" className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// Helper: FormField
function FormField({ label, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs text-gray-500 font-600 mb-1.5" style={{ fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  );
}

// Helper: Label
function Label({ children }) {
  return (
    <label className="block text-xs text-gray-500 font-600 mb-1.5" style={{ fontWeight: 600 }}>{children}</label>
  );
}

// Helper: ders saati geçip geçmediğini denetleme
function isSlotPast(weekKey, dayIndex, slotLabel) {
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

// SlotCell — desktop'ta <td>, mobile'da <div> olarak sarılır (asDiv prop'u).
// İçindeki tüm <td className="py-1 px-1"> wrapper'ları Wrap ile parametrize edildi.
function SlotCell({ slotData, progEntry, slot, dayIndex, slotIdx, session, teacher, onCellClick, onCancel, weekKey, asDiv = false }) {
  const Wrap = asDiv ? 'div' : 'td';
  const isDirector = session.role === 'director';
  const isPast = isSlotPast(weekKey, dayIndex, slot.label);
  const isLessonFromProg = progEntry?.type === 'ders';
  const isLessonFromGrid = slotData?.lessonType === 'ders';
  const isLesson = isLessonFromProg || isLessonFromGrid;
  const lessonCls = isLessonFromProg ? progEntry.cls : slotData?.cls;
  const lessonSubBranch = isLessonFromProg ? progEntry.subBranch : slotData?.subBranch;
  const lessonIsTemp = slotData?.lessonType === 'ders' && slotData.fixed === false;

  if (slotData.disabled) {
    if (isLesson) {
      const cls = lessonCls ? lessonCls.toUpperCase() : '—';
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
    if (isDirector) {
      if (isPast) {
        return (
          <Wrap className="py-1 px-1">
            <div className="rounded-lg py-2 px-1 text-center text-xs text-gray-200 bg-gray-50 border border-gray-100 select-none" title="Bu saat dilimi geçmiş">✕</div>
          </Wrap>
        );
      }
      return (
        <Wrap className="py-1 px-1">
          <button
            onClick={() => onCellClick(dayIndex, slotIdx, slotData, true)}
            title="Ek slot aç ve rezervasyon yap"
            className="w-full rounded-lg py-2 px-1 text-center border border-dashed border-amber-400 bg-amber-50 hover:border-amber-500 hover:bg-amber-100 transition-colors text-xs text-amber-400 hover:text-amber-600"
          >
            +
          </button>
        </Wrap>
      );
    }
    return (
      <Wrap className="py-1 px-1">
        <div className="rounded-lg py-2 px-1 text-center text-xs text-gray-200 bg-gray-50 border border-gray-100 select-none">✕</div>
      </Wrap>
    );
  }

  if (slotData.booked) {
    const bookedBy = slotData.bookedBy || 'student';
    const canCancel = isDirector ||
      (session.role === 'student' && slotData.studentId === session.id) ||
      (session.role === 'teacher' && teacher.id === session.id && bookedBy === 'teacher');

    const clsDisplay = (slotData.studentCls || '').toUpperCase();

    const colorMap = {
      student: { bg: 'bg-indigo-50', border: 'border-indigo-100', name: 'text-indigo-700', sub: 'text-indigo-400', label: 'Öğrenci' },
      teacher: { bg: 'bg-emerald-50', border: 'border-emerald-100', name: 'text-emerald-700', sub: 'text-emerald-400', label: 'Öğretmen' },
      director: { bg: 'bg-amber-50', border: 'border-amber-100', name: 'text-amber-700', sub: 'text-amber-400', label: 'Müdür' },
    };
    const c = colorMap[bookedBy] || colorMap.student;

    return (
      <Wrap className="py-1 px-1">
        <div className={`rounded-lg py-1.5 px-1 text-center ${c.bg} border ${c.border} relative group overflow-hidden`}>
          <div className={`text-xs font-600 ${c.name} truncate`} style={{ fontWeight: 600 }}>{slotData.studentName}</div>
          <div className={`text-[10px] ${c.sub} truncate`}>{clsDisplay}</div>
          <div className={`text-[9px] ${c.sub} opacity-70`}>{c.label}</div>
          {slotData.fixed && (
            <div className="text-[8px] px-1 py-0.5 rounded bg-violet-100 text-violet-600 font-600 leading-none mt-0.5 inline-block" style={{ fontWeight: 600 }}>SABİT</div>
          )}
          {canCancel && (
            <button onClick={() => onCancel({ teacherId: teacher.id, day: dayIndex, slotId: slot.id, weekKey })}
              className={`absolute top-0.5 right-0.5 p-0.5 rounded hover:bg-red-100 transition-opacity ${isDirector ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
              <X size={10} className="text-red-400" />
            </button>
          )}
        </div>
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
      <button
        onClick={() => onCellClick(dayIndex, slotIdx, slotData)}
        className="w-full rounded-lg py-2 px-1 text-center border border-dashed border-emerald-400 bg-emerald-50 hover:border-emerald-500 hover:bg-emerald-100 transition-colors text-xs text-emerald-500 hover:text-emerald-700"
      >
        +
      </button>
    </Wrap>
  );
}

// MobileDayCard — bir günün tüm slot'larını dikey kart olarak gösterir (mobile).
// Boş, kapalı + geçmiş ve ders olmayan slot'ları gizler (kalabalığı azaltır).
function MobileDayCard({ day, grid, program, teacher, weekKey, session, onCellClick, onCancel }) {
  const slots = slotsForDay(day.index);

  // Hangi slot'lar gösterilsin? Boş + disabled + geçmiş olanları atla.
  const visibleEntries = slots.map((slot, slotIdx) => {
    const slotData = (grid && grid[day.index] && grid[day.index][slotIdx]) || { booked: false, disabled: true };
    const progEntry = program?.[String(day.index)]?.[slot.id];
    const isLesson = progEntry?.type === 'ders' || slotData?.lessonType === 'ders';
    const isPast = isSlotPast(weekKey, day.index, slot.label);
    // Filtre: ders varsa göster; booked ise göster; açık (disabled değil) ise göster;
    // müdür ise kapalı slot'ları da göster (geçmiş hariç).
    const isDirector = session.role === 'director';
    const isAvailable = !slotData.disabled;
    const showForDirector = isDirector && !isPast;
    if (!isLesson && !slotData.booked && !isAvailable && !showForDirector) return null;
    return { slot, slotIdx, slotData, progEntry };
  }).filter(Boolean);

  if (visibleEntries.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className={`px-4 py-2.5 border-b border-gray-100 flex items-center justify-between ${day.weekend ? 'bg-indigo-50/50' : 'bg-gray-50/50'}`}>
        <div>
          <div className={`font-700 text-sm ${day.weekend ? 'text-indigo-700' : 'text-gray-900'}`} style={{ fontWeight: 700 }}>{day.label}</div>
          {day.weekend && <div className="text-[10px] text-indigo-400">Hafta sonu</div>}
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
                slotIdx={slotIdx}
                session={session}
                teacher={teacher}
                onCellClick={onCellClick}
                onCancel={onCancel}
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

export default function SlotGrid({ grid, program, teacher, weekKey, session, students, onBook, onCancel, hideEmptyDays }) {
  const [bookingSlot, setBookingSlot] = useState(null);
  const [searchQ, setSearchQ] = useState('');
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [fixedBooking, setFixedBooking] = useState(false);
  const [bookingBranch, setBookingBranch] = useState('');

  const teacherBranches = teacher.branches || [];
  const bookCls = session.role === 'student' ? session.cls : selectedStudent?.cls;
  const bookableBranches = useMemo(() => {
    if (!bookCls) return teacherBranches;
    const allowed = allowedBranchesForClass(bookCls);
    return teacherBranches.filter(b => allowed.includes(b));
  }, [bookCls, teacher.branches]);

  const filteredStudents = useMemo(() => {
    if (!students) return [];
    const q = searchQ.toLowerCase();
    const allowedGroups = teacher.allowedGroups || [];
    return students.filter(s => {
      if (allowedGroups.length === 0 || !allowedGroups.includes(s.group)) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) ||
        s.cls.toLowerCase().includes(q) ||
        classLabel(s.cls).toLowerCase().includes(q);
    }).slice(0, 20);
  }, [students, searchQ, teacher.allowedGroups]);

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
      const daySlots = slotsForDay(day.index);
      return daySlots.some((_, slotIdx) => {
        const sd = grid[day.index]?.[slotIdx];
        return sd && !sd.disabled;
      });
    });
  }, [grid, program, hideEmptyDays]);

  const handleCellClick = (dayIndex, slotIdx, slotData, isForceOpen = false) => {
    if (slotData.booked) return;
    if (slotData.disabled && !isForceOpen) return;
    const slot = slotsForDay(dayIndex)[slotIdx];
    const day = ALL_DAYS.find(d => d.index === dayIndex);
    setBookingSlot({ dayIndex, slotIdx, slotId: slot.id, slotLabel: slot.label, dayLabel: day.label, forceOpen: isForceOpen });
    setSearchQ('');
    setSelectedStudent(null);
    setFixedBooking(false);
  };

  const confirmBook = async () => {
    if (!bookingSlot) return;
    let studentId = session.role === 'student' ? session.id : selectedStudent?.id;
    if (!studentId) return;
    const branch = bookingBranch || (bookableBranches.length === 1 ? bookableBranches[0] : '');
    if (!branch) return;
    await onBook({ teacherId: teacher.id, day: bookingSlot.dayIndex, slotId: bookingSlot.slotId, studentId, weekKey, forceOpen: bookingSlot.forceOpen, fixed: fixedBooking, branch });
    setBookingSlot(null);
    setBookingBranch('');
  };

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
                <th key={day.index} className={`text-center py-2 px-1 text-xs font-600 ${day.weekend ? 'text-indigo-400' : 'text-gray-500'}`} style={{ fontWeight: 600, width: `calc((100% - 6rem) / ${colCount})` }}>
                  {day.short}
                  {day.weekend && <span className="block text-[9px] text-indigo-300">H.sonu</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(() => {
              const hasWeekday = visibleDays.some(d => !d.weekend);
              const hasWeekend = visibleDays.some(d => d.weekend);
              const maxRows = Math.max(
                hasWeekday ? WEEKDAY_SLOTS.length : 0,
                hasWeekend ? WEEKEND_SLOTS.length : 0,
              );
              return Array.from({ length: maxRows }, (_, rowIdx) => {
                const wdSlot = WEEKDAY_SLOTS[rowIdx];
                const weSlot = WEEKEND_SLOTS[rowIdx];
                const labelSlot = hasWeekday ? wdSlot : weSlot;
                if (!labelSlot) return null;
                return (
                  <tr key={rowIdx} className="border-t border-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-500 font-500 whitespace-nowrap" style={{ fontWeight: 500 }}>
                      {hasWeekday && wdSlot ? wdSlot.label : ''}
                      {hasWeekday && hasWeekend && weSlot ? <span className="block text-[10px] text-indigo-400">{weSlot.label}</span> : ''}
                      {!hasWeekday && weSlot ? weSlot.label : ''}
                    </td>
                    {visibleDays.map(day => {
                      const slots = slotsForDay(day.index);
                      const slot = slots[rowIdx];
                      if (!slot) return <td key={day.index} className="py-1 px-1"><div className="rounded-lg py-2 bg-gray-50 border border-gray-100 text-center text-gray-200 text-xs">—</div></td>;
                      const slotData = (grid && grid[day.index] && grid[day.index][rowIdx]) || { booked: false, disabled: true };
                      const progEntry = program?.[String(day.index)]?.[slot.id];
                      return <SlotCell key={day.index} slotData={slotData} progEntry={progEntry} slot={slot} dayIndex={day.index} slotIdx={rowIdx} session={session} teacher={teacher} onCellClick={handleCellClick} onCancel={onCancel} weekKey={weekKey} />;
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
            grid={grid}
            program={program}
            teacher={teacher}
            weekKey={weekKey}
            session={session}
            onCellClick={handleCellClick}
            onCancel={onCancel}
          />
        ))}
      </div>

      {bookingSlot && (
        <Modal title={`Rezervasyon: ${bookingSlot.dayLabel} ${bookingSlot.slotLabel}`} onClose={() => setBookingSlot(null)}>
          {bookingSlot.forceOpen && (
            <div className="mb-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
              Bu saat şablonda kapalıdır. Yalnızca bu hafta için açılıp rezerve edilecek — şablon değişmez.
            </div>
          )}
          {session.role === 'student' ? (
            <div>
              <p className="text-sm text-gray-600 mb-3"><strong>{teacher.name}</strong> ile etüde kayıt oluyorsunuz.</p>
              {bookableBranches.length > 1 && (
                <div className="mb-4">
                  <Label>Ders seç</Label>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {bookableBranches.map(b => (
                      <button key={b} type="button" onClick={() => setBookingBranch(b)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${bookingBranch===b?'border-indigo-300 bg-indigo-50 text-indigo-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {bookableBranches.length === 1 && (
                <p className="text-sm text-gray-500 mb-4">Ders: <strong>{bookableBranches[0]}</strong></p>
              )}
              <div className="flex gap-3">
                <button className="btn-primary flex-1" onClick={confirmBook}
                  disabled={bookableBranches.length > 1 && !bookingBranch}>Onayla</button>
                <button className="btn-ghost" onClick={() => setBookingSlot(null)}>İptal</button>
              </div>
            </div>
          ) : (
            <div>
              <FormField label="Öğrenci Ara">
                <input className="input" placeholder="İsim, sınıf kodu (701) veya sınıf adı..." value={searchQ}
                  onChange={e => { setSearchQ(e.target.value); setSelectedStudent(null); }} autoFocus />
              </FormField>
              <div className="max-h-52 overflow-y-auto space-y-1 mb-4">
                {filteredStudents.map(s => (
                  <button key={s.id} onClick={() => setSelectedStudent(s)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${selectedStudent?.id === s.id ? 'bg-indigo-50 border border-indigo-200 text-indigo-700' : 'hover:bg-gray-50'}`}>
                    <span className="font-600" style={{ fontWeight: 600 }}>{s.name}</span>
                    <span className="text-gray-400 ml-2 text-xs">{classLabel(s.cls)}</span>
                  </button>
                ))}
                {filteredStudents.length === 0 && searchQ && <p className="text-sm text-gray-400 text-center py-4">Öğrenci bulunamadı</p>}
              </div>
              {selectedStudent && bookableBranches.length > 1 && (
                <div className="mb-4">
                  <Label>Ders seç</Label>
                  <div className="flex gap-2 flex-wrap mt-1">
                    {bookableBranches.map(b => (
                      <button key={b} type="button" onClick={() => setBookingBranch(b)}
                        className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${bookingBranch===b?'border-indigo-300 bg-indigo-50 text-indigo-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedStudent && bookableBranches.length === 0 && (
                <p className="text-xs text-amber-600 mb-3">Bu öğretmenin bu öğrenci sınıfına verebileceği ders yok.</p>
              )}
              {session.role === 'director' && (
                <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                  <input type="checkbox" checked={fixedBooking} onChange={e => setFixedBooking(e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-600" />
                  <span className="text-sm text-gray-700 font-500" style={{ fontWeight: 500 }}>Sabit rezervasyon</span>
                  <span className="text-xs text-gray-400">(her hafta otomatik tekrarlanır)</span>
                </label>
              )}
              <div className="flex gap-3">
                <button className="btn-primary flex-1" onClick={confirmBook}
                  disabled={!selectedStudent || bookableBranches.length === 0 || (bookableBranches.length > 1 && !bookingBranch)}>
                  {selectedStudent ? `${selectedStudent.name} için Rezerve Et` : 'Öğrenci Seçin'}
                </button>
                <button className="btn-ghost" onClick={() => setBookingSlot(null)}>İptal</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
