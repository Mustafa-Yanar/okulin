'use client';

// Öğretmen ders programı editörü: Google Calendar tarzı tek takvim görünümü.
// Ders slotları (sabit ID, saatleri sidebar'dan) tek-tık aktif/pasif yapılır;
// etütler serbest saatli "+ Etüt Ekle" ile eklenir (etutSablonlari).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import LoadingBox from '../Loading';
import { Save, Plus, Download, AlertCircle, AlertTriangle } from 'lucide-react';
import SchedulePrint, { type ScheduleDay, type ScheduleLesson } from '../program/SchedulePrint';
import {
  ALL_DAYS, daySlots, getWeekKey, classLabel,
} from '@/lib/constants';
import { classLabelFrom, classShort, coursesForClass } from '@/lib/classCatalog';
import type { ClassRecord } from '@/lib/classes';
import { useSlotTimes } from '../SlotTimesContext';
import { useClasses } from '../ClassesContext';
import { api, Modal, getAdjacentWeek, isSlotPast } from './shared';
import EtutCalendar, { timeToMin, minToTop, durationToHeight } from './EtutCalendar';
import { useConfirm } from '../ConfirmProvider';
import type { ProgramEntry } from '@/lib/slots';
import type { SablonRezDTO } from '@/lib/etut/sablon-service';
// Ders adayları sunucuyla TEK kaynaktan (decideBooking kural 8 aynı fonksiyonları kullanır).
import { levelPoolFrom, etutBranchCandidates } from '@/lib/etut/level-pool-core';
import type { ShowToast, StudentDTO, TeacherDTO } from '../types';

// /api/program ızgarası: gün → slotId → giriş.
type ProgramGrid = Record<string, Record<string, ProgramEntry | null>>;
type PanelStudent = StudentDTO & { group?: string };

// Etüt Ekle formunun ürettiği taslak.
interface EtutDraft {
  dayIndex: number;
  start: string;
  end: string;
  aktif: boolean;
}

interface ProgramEditorProps {
  teacher: TeacherDTO;
  onClose: () => void;
  showToast: ShowToast;
  students?: PanelStudent[];
  inline?: boolean;
}

export default function ProgramEditor({ teacher, onClose, showToast, students, inline = false }: ProgramEditorProps) {
  const confirm = useConfirm();
  const currentWeek = getWeekKey();
  const maxWeek = getAdjacentWeek(getAdjacentWeek(currentWeek, 1), 1);
  const [weekKey, setWeekKey] = useState(currentWeek);
  const [program, setProgram] = useState<ProgramGrid | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [offDays, setOffDays] = useState<number[]>(teacher.offDays || []);
  const [togglingDay, setTogglingDay] = useState<number | null>(null);
  const [dirty, setDirty] = useState<Record<string, ProgramEntry | null>>({});
  // Slota tıklayınca açılan eylem modalı (elle ders ata / müsait işaretle / temizle).
  const [slotModal, setSlotModal] = useState<{ dayIndex: number; slotId: string; slotStart: string } | null>(null);
  const [showPrint, setShowPrint] = useState(false);

  // Etüt şablonları (calendar — serbest saatli, haftaya duyarlı rezervasyon verisiyle)
  const [etutSablonlar, setEtutSablonlar] = useState<SablonRezDTO[]>([]);
  const [showEtutForm, setShowEtutForm] = useState(false);
  const [savingEtut, setSavingEtut] = useState(false);
  const [selectedEtut, setSelectedEtut] = useState<SablonRezDTO | null>(null); // tıklanan etüt (eylem menüsü)

  const { slotTimes } = useSlotTimes();
  const { classes } = useClasses();

  useEffect(() => {
    setLoading(true);
    setDirty({});
    (async () => {
      try {
        const data = await api<{ program?: ProgramGrid }>(`/api/program?teacherId=${teacher.id}&week=${weekKey}`);
        setProgram(data.program || {});
      } catch {
        setProgram({});
      } finally {
        setLoading(false);
      }
    })();
  }, [teacher.id, weekKey]);

  // Etüt şablonlarını + o haftanın efektif rezervasyonlarını yükle (hafta değişince yeniden çeker).
  useEffect(() => {
    (async () => {
      try {
        const d = await api<{ sablonlar?: SablonRezDTO[] }>(`/api/etut-sablon?teacherId=${teacher.id}&week=${weekKey}`);
        setEtutSablonlar(d.sablonlar || []);
      } catch (e) { showToast((e as Error).message, 'error'); setEtutSablonlar([]); }
    })();
  }, [teacher.id, weekKey, showToast]);

  async function saveEtutSablon(sablon: EtutDraft) {
    // Geçmiş gün/saate etüt eklenemez (server de reddeder; burada erken uyarı).
    if (isSlotPast(weekKey, sablon.dayIndex, sablon.start)) {
      showToast('Geçmiş bir gün/saate etüt eklenemez', 'error');
      return;
    }
    setSavingEtut(true);
    try {
      const r = await api<{ sablonlar?: SablonRezDTO[] }>('/api/etut-sablon', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, weekKey, sablon }) });
      setEtutSablonlar(r.sablonlar || []);
      setShowEtutForm(false);
      showToast('Etüt eklendi');
    } catch (e) { showToast((e as Error).message, 'error'); }
    finally { setSavingEtut(false); }
  }

  async function deleteEtutSablon(id: string) {
    try {
      const r = await api<{ sablonlar?: SablonRezDTO[] }>('/api/etut-sablon', { method: 'DELETE', body: JSON.stringify({ teacherId: teacher.id, id, weekKey }) });
      setEtutSablonlar(r.sablonlar || []);
      setSelectedEtut(null);
      showToast('Etüt silindi');
    } catch (e) { showToast((e as Error).message, 'error'); }
  }

  async function toggleEtutSablon(id: string, scope: string, aktif: boolean) {
    try {
      const r = await api<{ sablonlar?: SablonRezDTO[] }>('/api/etut-sablon', {
        method: 'PUT',
        body: JSON.stringify({ teacherId: teacher.id, id, scope, weekKey, aktif }),
      });
      setEtutSablonlar(r.sablonlar || []);
      setSelectedEtut(null);
      showToast(aktif ? 'Etüt aktifleştirildi' : (scope === 'week' ? 'Etüt bu hafta pasifleştirildi' : 'Etüt pasifleştirildi'));
    } catch (e) { showToast((e as Error).message, 'error'); }
  }

  async function assignEtutSablon(id: string, student: { id: string; name: string; cls: string } | null, scope: 'WEEK' | 'RECURRING', branch?: string) {
    try {
      const r = await api<{ sablonlar?: SablonRezDTO[] }>('/api/etut-sablon', {
        method: 'PATCH',
        body: JSON.stringify({ teacherId: teacher.id, id, student, branch, scope, weekKey }),
      });
      const list = r.sablonlar || [];
      setEtutSablonlar(list);
      setSelectedEtut(list.find(s => s.id === id) || null);
      showToast(student ? (scope === 'RECURRING' ? 'Öğrenci atandı (her hafta)' : 'Öğrenci atandı (bu hafta)') : 'Atama kaldırıldı');
    } catch (e) { showToast((e as Error).message, 'error'); }
  }

  // Bir etüt şablonu bu hafta efektif aktif mi? (kalıcı aktif + bu hafta pasif listesinde değil)
  function etutAktifThisWeek(sb: SablonRezDTO): boolean {
    if (sb.aktif === false) return false;
    if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
    return true;
  }

  const canPrev = weekKey !== currentWeek;
  const canNext = weekKey !== maxWeek;

  function getEntry(dayIndex: number, slotId: string): ProgramEntry | null {
    return program?.[String(dayIndex)]?.[slotId] || null;
  }

  function setEntry(dayIndex: number, slotId: string, entry: ProgramEntry) {
    setProgram(prev => ({
      ...prev,
      [String(dayIndex)]: {
        ...(prev?.[String(dayIndex)] || {}),
        [slotId]: entry,
      },
    }));
    setDirty(prev => ({ ...prev, [`${dayIndex}:${slotId}`]: entry }));
  }

  function clearEntry(dayIndex: number, slotId: string) {
    setProgram(prev => {
      const day = { ...(prev?.[String(dayIndex)] || {}) };
      delete day[slotId];
      return { ...prev, [String(dayIndex)]: day };
    });
    setDirty(prev => ({ ...prev, [`${dayIndex}:${slotId}`]: null }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const diff: Record<string, Record<string, ProgramEntry | null>> = {};
      for (const [key, entry] of Object.entries(dirty)) {
        const [dayIdx, slotId] = key.split(':');
        if (!diff[dayIdx]) diff[dayIdx] = {};
        diff[dayIdx][slotId] = entry;
      }
      await api('/api/program', { method: 'POST', body: JSON.stringify({ teacherId: teacher.id, weekKey, program: diff }) });
      showToast('Program kaydedildi ve uygulandı');
      onClose();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleOffDay(dayIndex: number) {
    const isCurrentlyOff = offDays.includes(dayIndex);
    const willBeOff = !isCurrentlyOff;
    if (willBeOff) {
      const dayProg = program?.[String(dayIndex)] || {};
      const hasEntries = Object.values(dayProg).some(e => e && e.type);
      if (hasEntries) {
        if (!(await confirm({ message: 'Bu güne tanımlı ders/etüt var. İzin günü yapılırsa hepsi silinecek.', confirmLabel: 'Devam Et' }))) return;
      }
    }
    setTogglingDay(dayIndex);
    try {
      const res = await api<{ offDays?: number[] }>('/api/teachers', {
        method: 'PUT',
        body: JSON.stringify({ action: 'toggle_off_day', id: teacher.id, dayIndex, off: willBeOff }),
      });
      setOffDays(res.offDays || []);
      if (willBeOff) {
        setProgram(prev => {
          const next = { ...(prev || {}) };
          delete next[String(dayIndex)];
          return next;
        });
        setDirty(prev => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (k.startsWith(`${dayIndex}:`)) delete next[k];
          }
          return next;
        });
      }
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setTogglingDay(null);
    }
  }

  const allowedStudents = students
    ? students.filter(s => !teacher.allowedGroups?.length || teacher.allowedGroups.includes(s.group || ''))
    : [];

  // O günün, [start,end) aralığıyla çakışan efektif AKTİF etüt şablonu var mı?
  // (mola payı hariç — ders slotuyla birebir saat çakışmasını engelliyoruz.)
  function cakisanAktifEtut(dayIndex: number, slotStart: string, slotEnd: string): SablonRezDTO | undefined {
    const s = timeToMin(slotStart), e = timeToMin(slotEnd);
    return etutSablonlar.find(sb =>
      sb.dayIndex === dayIndex &&
      etutAktifThisWeek(sb) &&
      timeToMin(sb.start) < e && timeToMin(sb.end) > s
    );
  }

  // Ders slotu tek-tık toggle: pasif (boş) → aktif (available); aktif → pasif.
  // Geçmiş slot düzenlenemez. Kayıt "Kaydet ve Uygula" ile toplu (dirty/diff).
  // Çift yönlü çakışma: o saate aktif etüt varsa ders aktif EDİLEMEZ (kapatma serbest).
  function handleSlotClick(dayIndex: number, slotId: string, slotLabel: string) {
    if (isSlotPast(weekKey, dayIndex, slotLabel)) return;
    const slots = daySlots(dayIndex, slotTimes.days?.[dayIndex]);
    const slot = slots.find(x => x.id === slotId);
    const entry = getEntry(dayIndex, slotId);
    // Boş slota (ders/müsait eklenecek) o saatte aktif etüt varsa engelle.
    if (!entry && slot) {
      const c = cakisanAktifEtut(dayIndex, slot.start, slot.end);
      if (c) {
        showToast(`Bu saatte aktif etüt var (${c.start}–${c.end}). Önce etüdü iptal/pasif yapın.`, 'error');
        return;
      }
    }
    // Eylem modalı: elle sınıf+ders ata / müsait işaretle / temizle.
    setSlotModal({ dayIndex, slotId, slotStart: slot?.start || slotLabel });
  }

  const offSet = new Set(offDays);
  const hiddenDayIndexes = offDays;

  const offDayBar = (
    <div className="flex flex-wrap items-center gap-1 mb-3 px-1">
      <span className="text-[10px] text-gray-400 mr-1">İzin günleri:</span>
      {ALL_DAYS.map(day => {
        const isOff = offSet.has(day.index);
        const busy = togglingDay === day.index;
        return (
          <button key={day.index}
            onClick={() => !busy && toggleOffDay(day.index)}
            disabled={busy}
            className={`text-[10px] px-2 py-1 rounded-full border transition-colors ${isOff ? 'bg-rose-100 border-rose-200 text-rose-700' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'} ${busy ? 'opacity-50' : ''}`}
            title={isOff ? 'İzin günü — tıklayarak aç' : 'Tıklayarak izin günü yap'}>
            {day.short} {isOff && '×'}
          </button>
        );
      })}
    </div>
  );

  if (loading) {
    const inner = <>{offDayBar}<LoadingBox height="h-32" /></>;
    if (inline) return <div className="py-2">{inner}</div>;
    return <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>{inner}</Modal>;
  }

  // Öğretmenin haftalık dersleri → PDF çıktısı verisi (dolu 'ders' slotları).
  const teacherDays: ScheduleDay[] = ALL_DAYS.map(day => {
    const slots = daySlots(day.index, slotTimes.days?.[day.index]);
    const lessons: ScheduleLesson[] = [];
    for (const slot of slots) {
      const e = getEntry(day.index, slot.id);
      if (e?.type === 'ders' && e.cls) lessons.push({ main: classLabelFrom(classes, e.cls, classLabel), sub: e.branch || e.subBranch || '', time: slot.label, slotId: slot.id });
    }
    return { dayIndex: day.index, dayLabel: day.short, weekend: day.weekend, lessons };
  });

  const content = (
    <>
      {offDayBar}

      <p className="text-[11px] mb-3 px-1" style={{ color: 'var(--text-muted)' }}>
        Ders saatine tıkla → sınıf + ders ata (elle program) ya da "müsait" işaretle (çözücü için). Boş saatlere "Etüt Ekle" ile serbest etüt koy.
      </p>

      <EtutCalendar
        weekKey={weekKey}
        currentWeek={currentWeek}
        canPrev={canPrev}
        canNext={canNext}
        onPrev={() => canPrev && setWeekKey(getAdjacentWeek(weekKey, -1))}
        onNext={() => canNext && setWeekKey(getAdjacentWeek(weekKey, 1))}
        hiddenDayIndexes={hiddenDayIndexes}
        headerRight={
          <div className="flex gap-2">
            <button className="btn-ghost !px-3 !py-1.5 text-sm flex items-center gap-1.5" onClick={() => setShowPrint(true)}>
              <Download size={14} /> PDF
            </button>
            <button className="btn-primary !px-3 !py-1.5 text-sm flex items-center gap-1.5" onClick={() => setShowEtutForm(true)}>
              <Plus size={14} /> Etüt Ekle
            </button>
          </div>
        }
        renderDayContent={(day) => {
          const blocks = [];
          // 1) Ders slotları — o günün ders SAYISI kadar çizilir (7-gün model, her gün
          //    kendi count/saatleri). Aktif (available) mavi dolu, pasif soluk/boş.
          //    Tıkla → aç/kapat toggle. Geçmiş slot düzenlenemez.
          const slots = daySlots(day.index, slotTimes.days?.[day.index]);
          for (const slot of slots) {
            const entry = getEntry(day.index, slot.id);
            const isDers = entry?.type === 'ders';          // program-solve yerleşimi (sınıf atanmış)
            const aktif = entry?.type === 'available';       // öğretmen müsaitlik işareti
            const dolu = isDers || aktif;
            const past = isSlotPast(weekKey, day.index, slot.label);
            // Pasif (boş) slot + o saatte aktif etüt → ders eklenemez (bloklu). Dolu slot etüdü zaten engelliyor.
            const etutEngel = !dolu && cakisanAktifEtut(day.index, slot.start, slot.end);
            const top = minToTop(timeToMin(slot.start));
            const height = Math.max(durationToHeight(timeToMin(slot.end) - timeToMin(slot.start)), 16);
            const dersAd = isDers ? classLabelFrom(classes, entry?.cls || '', classLabel) : '';
            const dersBrans = isDers ? (entry?.branch || entry?.subBranch || '') : '';
            blocks.push(
              <button key={`slot-${slot.id}`}
                onClick={() => handleSlotClick(day.index, slot.id, slot.label)}
                disabled={past || !!etutEngel}
                className={`absolute left-0.5 right-0.5 rounded-md px-1 overflow-hidden text-left transition-colors ${dolu || etutEngel ? '' : 'ders-slot-bos'}`}
                style={{
                  top, height, zIndex: 1,
                  // Atanan ders (sınıf yerleşmiş) → dolu mor, öne çıkar.
                  // Boş/müsait ders saati → soluk mavi + kesikli, geri planda.
                  background: isDers ? 'color-mix(in srgb, var(--brand,#6366f1) 20%, transparent)'
                    : aktif ? 'color-mix(in srgb, #3b82f6 8%, transparent)'
                    : 'var(--bg-muted, #f1f5f9)',
                  border: isDers ? '1.5px solid var(--brand,#6366f1)'
                    : aktif ? '1px dashed #93c5fd'
                    : '1px dashed var(--border-subtle)',
                  borderLeft: isDers ? '4px solid var(--brand,#6366f1)'
                    : aktif ? '3px dashed #60a5fa'
                    : '1px dashed var(--border-subtle)',
                  opacity: past ? 0.4 : etutEngel ? 0.5 : 1,
                  cursor: isDers ? 'default' : past || etutEngel ? 'not-allowed' : 'pointer',
                }}
                title={past ? 'Geçmiş saat — düzenlenemez'
                  : isDers ? `${slot.start}–${slot.end} · ${dersAd}${dersBrans ? ' — ' + dersBrans : ''} (Ders Programı Oluştur'dan yerleşti)`
                  : aktif ? `${slot.start}–${slot.end} · Boş ders saati (müsait) — tıkla: kapat`
                  : etutEngel ? `${slot.start}–${slot.end} — bu saatte aktif etüt var, ders eklenemez`
                  : `${slot.start}–${slot.end} — tıkla: ders saati aç`}>
                {isDers ? (
                  <div className="text-[11px] leading-tight truncate">
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{dersAd || 'Ders'}</span>
                    {dersBrans && <span className="text-indigo-800" style={{ fontWeight: 600 }}>{' · '}{dersBrans}</span>}
                  </div>
                ) : aktif ? (
                  <div className="text-[11px] leading-tight truncate">
                    <span className="text-blue-700" style={{ fontWeight: 700 }}>Boş</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{' · '}{slot.start}</span>
                  </div>
                ) : (
                  <div className="text-[10px] leading-tight truncate" style={{ color: 'var(--text-secondary)' }}>
                    {etutEngel ? '' : height >= 28 ? `${slot.start} +` : '+'}
                  </div>
                )}
              </button>
            );
          }
          // 2) Etüt şablonları (serbest saatli, turkuaz aktif / gri pasif, tıkla→menü)
          //    zIndex ders bloklarının üstünde — pasif slotla çakışsa da tıklanabilir.
          for (const sb of etutSablonlar) {
            if (sb.dayIndex !== day.index) continue;
            const top = minToTop(timeToMin(sb.start));
            const height = Math.max(durationToHeight(timeToMin(sb.end) - timeToMin(sb.start)), 18);
            const aktif = etutAktifThisWeek(sb);
            blocks.push(
              <button key={`etut-${sb.id}`}
                onClick={() => setSelectedEtut(sb)}
                className="absolute left-0.5 right-0.5 rounded-md px-1 overflow-hidden text-left"
                style={{
                  top, height, zIndex: 5,
                  background: aktif ? 'color-mix(in srgb, var(--time-etut) 22%, transparent)' : 'color-mix(in srgb, #94a3b8 16%, transparent)',
                  borderLeft: `3px solid ${aktif ? 'var(--time-etut)' : '#94a3b8'}`,
                  opacity: aktif ? 1 : 0.7,
                }}
                title={`Etüt ${sb.start}–${sb.end}${aktif ? '' : ' (pasif)'} · tıkla: seçenekler`}>
                <div className="text-[9px] leading-tight truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                  {sb.studentName ? `${sb.studentName}${sb.rezScope === 'RECURRING' ? ' ↻' : ''}` : 'Etüt'}{aktif ? '' : ' (pasif)'}
                </div>
                {height >= 28 && <div className="text-[8px] leading-tight" style={{ color: 'var(--text-muted)' }}>{sb.start}–{sb.end}</div>}
              </button>
            );
          }
          return blocks;
        }}
      />

      <div className="flex gap-3 mt-4">
        <button className="btn-primary flex-1 flex items-center justify-center gap-1.5" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Kaydediliyor...' : `Kaydet ve Uygula${Object.keys(dirty).length ? ` (${Object.keys(dirty).length})` : ''}`}
        </button>
        {!inline && <button className="btn-ghost" onClick={onClose}>İptal</button>}
      </div>

      {selectedEtut && (
        <EtutEylemModal
          sablon={selectedEtut}
          aktif={etutAktifThisWeek(selectedEtut)}
          allowedStudents={allowedStudents}
          teacherBranches={teacher.branches || []}
          onClose={() => setSelectedEtut(null)}
          onToggle={toggleEtutSablon}
          onAssign={assignEtutSablon}
          onDelete={deleteEtutSablon}
        />
      )}

      {slotModal && (
        <SlotDersModal
          dayIndex={slotModal.dayIndex}
          slotStart={slotModal.slotStart}
          entry={getEntry(slotModal.dayIndex, slotModal.slotId)}
          classes={classes}
          branches={teacher.branches || []}
          allowedGroups={teacher.allowedGroups || []}
          onAta={(cls, branch) => { setEntry(slotModal.dayIndex, slotModal.slotId, { type: 'ders', cls, branch, fixed: true }); setSlotModal(null); }}
          onMusait={() => { setEntry(slotModal.dayIndex, slotModal.slotId, { type: 'available', fixed: true }); setSlotModal(null); }}
          onTemizle={() => { clearEntry(slotModal.dayIndex, slotModal.slotId); setSlotModal(null); }}
          onClose={() => setSlotModal(null)}
        />
      )}

      {showEtutForm && (
        <EtutEkleForm
          weekKey={weekKey}
          defaultSure={slotTimes.etutSuresi || 60}
          molaSure={slotTimes.molaSuresi ?? 10}
          saving={savingEtut}
          busyRangesForDay={(dayIndex) => {
            // O günün meşgul aralıkları: SADECE aktif (available) ders slotları + etüt şablonları.
            // Pasif/boş ders slotları meşgul değil → o saatlere etüt eklenebilir.
            const ranges: { start: string; end: string; label: string }[] = [];
            const slots = daySlots(dayIndex, slotTimes.days?.[dayIndex]);
            for (const slot of slots) {
              const entry = getEntry(dayIndex, slot.id);
              if (entry?.type === 'available') ranges.push({ start: slot.start, end: slot.end, label: 'ders' });
            }
            for (const sb of etutSablonlar) {
              if (sb.dayIndex === dayIndex) ranges.push({ start: sb.start, end: sb.end, label: 'etüt' });
            }
            return ranges;
          }}
          onClose={() => setShowEtutForm(false)}
          onSave={saveEtutSablon}
        />
      )}

      {showPrint && (
        <SchedulePrint
          title="Ders Programı"
          subtitle={teacher.name}
          days={teacherDays}
          onClose={() => setShowPrint(false)}
        />
      )}
    </>
  );

  if (inline) return <div className="py-2">{content}</div>;
  return <Modal title={`${teacher.name} – Program`} onClose={onClose} xwide>{content}</Modal>;
}

// ─── Etüt Ekle formu ─────────────────────────────────────────────────────────
// Gün + başlangıç + bitiş (serbest süre). Başlangıç seçilince bitiş, kurum
// varsayılan etüt süresiyle ön-doldurulur (kullanıcı değiştirebilir).
const ETUT_TIME_OPTS = (() => {
  const opts: string[] = [];
  for (let min = 7 * 60; min <= 23 * 60; min += 5) {
    const h = Math.floor(min / 60), m = min % 60;
    opts.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return opts;
})();

function addMinutesToTime(t: string, addMin: number): string {
  const [h, m] = t.split(':').map(Number);
  let total = h * 60 + m + addMin;
  total = Math.min(total, 23 * 60); // calendar sınırı
  const hh = Math.floor(total / 60), mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

interface EtutEkleFormProps {
  defaultSure: number;
  molaSure?: number;
  busyRangesForDay?: (dayIndex: number) => { start: string; end: string; label: string }[];
  weekKey: string;
  saving: boolean;
  onClose: () => void;
  onSave: (draft: EtutDraft) => void;
}

function EtutEkleForm({ defaultSure, molaSure = 10, busyRangesForDay, weekKey, saving, onClose, onSave }: EtutEkleFormProps) {
  // Geçmiş günleri engelle: gösterilen hafta içinde günü/saati geçmiş slotlara etüt eklenemez.
  // İlk seçilebilir gün = bugün veya sonrası (gösterilen hafta currentWeek ise hafta içi geçmiş günler kapanır).
  const firstValidDay = useMemo(() => {
    const d = ALL_DAYS.find(d => !isSlotPast(weekKey, d.index, '23:59'));
    return d ? d.index : ALL_DAYS[0].index;
  }, [weekKey]);

  const [dayIndex, setDayIndex] = useState(firstValidDay);
  const [start, setStart] = useState('15:00');
  const [end, setEnd] = useState(addMinutesToTime('15:00', defaultSure));
  const [ignoreMola, setIgnoreMola] = useState(false);

  // Seçili gün+saat geçmişte mi?
  const isPast = isSlotPast(weekKey, dayIndex, start);

  const handleStartChange = (v: string) => {
    setStart(v);
    setEnd(addMinutesToTime(v, defaultSure)); // bitişi otomatik öner
  };

  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const invalid = toMin(end) <= toMin(start);

  // Çakışma + mola kontrolü
  const { overlap, molaWarnings } = useMemo(() => {
    const sMin = toMin(start), eMin = toMin(end);
    const ranges = busyRangesForDay ? busyRangesForDay(dayIndex) : [];
    let overlap = false;
    const molaWarnings: string[] = [];
    for (const r of ranges) {
      const rs = toMin(r.start), re = toMin(r.end);
      // Üst üste binme (çakışma)
      if (sMin < re && rs < eMin) { overlap = true; continue; }
      // Mola: bu blok bizim önümüzde bitiyorsa, aradaki boşluk molaSure'den az mı?
      if (re <= sMin && sMin - re < molaSure) {
        molaWarnings.push(`${r.start}–${r.end} ${r.label} bitiminden sonra ${sMin - re} dk var (en az ${molaSure} dk olmalı).`);
      }
      // Mola: bu blok bizden sonra başlıyorsa, aradaki boşluk molaSure'den az mı?
      if (eMin <= rs && rs - eMin < molaSure) {
        molaWarnings.push(`${r.start}–${r.end} ${r.label} başlangıcından önce ${rs - eMin} dk var (en az ${molaSure} dk olmalı).`);
      }
    }
    return { overlap, molaWarnings };
  }, [dayIndex, start, end, molaSure, busyRangesForDay]);

  const hasMola = molaWarnings.length > 0;
  // Çakışma ve geçmiş gün/saat asla geçilemez; mola uyarısı "yoksay" ile geçilebilir.
  const blocked = invalid || overlap || isPast || (hasMola && !ignoreMola);

  return (
    <Modal title="Yeni Etüt" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="text-label block mb-1">Gün</label>
          <select value={dayIndex} onChange={e => { setDayIndex(parseInt(e.target.value)); setIgnoreMola(false); }} className="input">
            {ALL_DAYS.map(d => {
              const dayPast = isSlotPast(weekKey, d.index, '23:59'); // o günün tamamı geçti mi
              return <option key={d.index} value={d.index} disabled={dayPast}>{d.label}{dayPast ? ' (geçmiş)' : ''}</option>;
            })}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-label block mb-1">Başlangıç</label>
            <select value={start} onChange={e => { handleStartChange(e.target.value); setIgnoreMola(false); }} className="input">
              {ETUT_TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-label block mb-1">Bitiş</label>
            <select value={end} onChange={e => { setEnd(e.target.value); setIgnoreMola(false); }} className="input">
              {ETUT_TIME_OPTS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {invalid && <p className="text-xs" style={{ color: '#ef4444' }}>Bitiş saati başlangıçtan sonra olmalı.</p>}
        {!invalid && isPast && (
          <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-danger)' }}><AlertCircle size={13} className="shrink-0" /> Geçmiş bir gün/saate etüt eklenemez — ileri bir zaman seçin.</p>
        )}
        {!invalid && !isPast && overlap && (
          <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-danger)' }}><AlertCircle size={13} className="shrink-0" /> Bu saat aralığı mevcut bir ders/etütle çakışıyor — değiştirin.</p>
        )}
        {!invalid && !isPast && !overlap && hasMola && (
          <div className="rounded-lg p-2.5" style={{ background: 'color-mix(in srgb, #f59e0b 12%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 35%, transparent)' }}>
            <p className="text-xs mb-1 flex items-center gap-1.5" style={{ color: 'var(--color-warning)', fontWeight: 600 }}><AlertTriangle size={13} className="shrink-0" /> Yeterli mola yok:</p>
            {molaWarnings.map((w, i) => <p key={i} className="text-[11px]" style={{ color: '#b45309' }}>• {w}</p>)}
            <label className="flex items-center gap-1.5 text-xs mt-2 cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={ignoreMola} onChange={e => setIgnoreMola(e.target.checked)} />
              Uyarıyı yoksay
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={onClose}>İptal</button>
          <button className="btn-primary !px-5" disabled={saving || blocked}
            onClick={() => onSave({ dayIndex, start, end, aktif: true })}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

interface EtutEylemModalProps {
  sablon: SablonRezDTO;
  aktif: boolean;
  allowedStudents?: PanelStudent[];
  teacherBranches?: string[];
  onClose: () => void;
  onToggle: (id: string, scope: string, aktif: boolean) => void;
  onAssign: (id: string, student: { id: string; name: string; cls: string } | null, scope: 'WEEK' | 'RECURRING', branch?: string) => void;
  onDelete: (id: string) => void;
}

// ─── Etüt eylem modalı (tıklanan etüt: aktif/pasif/sil) ──────────────────────
function EtutEylemModal({ sablon, aktif, allowedStudents = [], teacherBranches = [], onClose, onToggle, onAssign, onDelete }: EtutEylemModalProps) {
  const { classes } = useClasses(); // s_ şube kimliği → kayıtlı ad (öğrenci seçici) + düzey havuzu
  const confirm = useConfirm();
  const gun = ALL_DAYS.find(d => d.index === sablon.dayIndex)?.label || '';
  // Pasifleştirme onayı: "sadece bu hafta" varsayılan İŞARETLİ
  const [pasifMode, setPasifMode] = useState(false); // pasifleştirme onayı gösteriliyor mu
  const [sadeceBuHafta, setSadeceBuHafta] = useState(true);
  // Yeni atama kapsamı: kalıcı (her hafta) DEFAULT.
  const [assignScope, setAssignScope] = useState<'WEEK' | 'RECURRING'>('RECURRING');
  // Çok-branşlı öğretmende ders seçimi (denetim B9): tek aday varsa sorulmaz, seçimle
  // birlikte anında atanır (eski tek-tık davranışı korunur); birden fazlaysa ders seçici
  // açılır ve "Ata" ile gönderilir. Sunucu kuralı decideBooking kural 8 ile AYNI kaynaktan
  // (etutBranchCandidates) hesaplanır — istemci sunucunun reddedeceği dersi teklif etmez.
  const [selStudent, setSelStudent] = useState('');
  const [selBranch, setSelBranch] = useState('');

  const levelClasses = useMemo(() => classes.map(c => ({ group: c.group, dersler: c.dersler })), [classes]);
  const candidatesFor = useCallback((s: PanelStudent) =>
    etutBranchCandidates(teacherBranches, levelPoolFrom(levelClasses, s.group || '')),
    [teacherBranches, levelClasses]);
  // Atanabilir öğrenciler: en az bir ders adayı olanlar (grup süzmesi zaten allowedStudents'ta).
  // Adayı olmayan öğrenci seçilseydi sunucu 400 verirdi — listede hiç göstermemek dürüst olan.
  const eligibleStudents = useMemo(() => allowedStudents.filter(s => candidatesFor(s).length > 0),
    [allowedStudents, candidatesFor]);
  const secili = eligibleStudents.find(s => s.id === selStudent) || null;
  const cands = secili ? candidatesFor(secili) : [];

  function assign(s: PanelStudent, branch: string) {
    onAssign(sablon.id, { id: s.id, name: s.name, cls: s.cls || '' }, assignScope, branch);
  }

  function handleStudentSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const sid = e.target.value;
    setSelStudent(sid);
    setSelBranch('');
    if (!sid) return; // boş seçenek artık kaldırma yapmaz — select yalnız atama içindir
    const s = eligibleStudents.find(x => x.id === sid);
    if (!s) return;
    const c = candidatesFor(s);
    if (c.length === 1) assign(s, c[0]); // tek aday → anında ata (eski davranış)
  }

  return (
    <Modal title={`${gun} ${sablon.start}–${sablon.end} Etüt`} onClose={onClose}>
      <div className="space-y-3">
        <div className="text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
          Durum:
          <span className="px-2 py-0.5 rounded-full text-xs" style={{ fontWeight: 600,
            background: aktif ? 'color-mix(in srgb,#14b8a6 18%,transparent)' : 'color-mix(in srgb,#94a3b8 18%,transparent)',
            color: aktif ? '#0f766e' : '#475569' }}>
            {aktif ? '● Aktif' : '○ Pasif'}
          </span>
        </div>

        {/* Öğrenci ataması (birebir) */}
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>Öğrenci (birebir)</label>
          <div className="flex gap-3 text-sm mb-1.5" role="radiogroup" aria-label="Atama kapsamı">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={assignScope === 'RECURRING'} onChange={() => setAssignScope('RECURRING')} />
              Her hafta (kalıcı)
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={assignScope === 'WEEK'} onChange={() => setAssignScope('WEEK')} />
              Sadece bu hafta
            </label>
          </div>
          <select value={selStudent || sablon.studentId || ''} onChange={handleStudentSelect}
            className="input !text-sm !py-1.5 w-full">
            <option value="">— Öğrenci seç —</option>
            {eligibleStudents.map(s => (
              <option key={s.id} value={s.id}>{s.name}{s.cls ? ` · ${classShort(classes, s.cls)}` : ''}</option>
            ))}
          </select>
          {secili && cands.length > 1 && (
            <div className="mt-2 space-y-2">
              <select value={selBranch} onChange={e => setSelBranch(e.target.value)}
                className="input !text-sm !py-1.5 w-full">
                <option value="">— Ders seç —</option>
                {cands.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
              <button className="btn-primary w-full justify-center" disabled={!selBranch}
                onClick={() => assign(secili, selBranch)}>Ata</button>
            </div>
          )}
          {sablon.studentName && (
            <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: '#0f766e' }}>
              Atandı: {sablon.studentName}
              <span className="px-1.5 py-0.5 rounded-full text-[10px]" style={{ fontWeight: 600,
                background: 'color-mix(in srgb,#0f766e 14%,transparent)', color: '#0f766e' }}>
                {sablon.rezScope === 'RECURRING' ? 'Her hafta' : 'Bu hafta'}
              </span>
            </p>
          )}
          {sablon.studentId && (
            sablon.rezScope === 'RECURRING' ? (
              <div className="flex gap-2 mt-2">
                <button className="btn-ghost flex-1 justify-center" onClick={() => onAssign(sablon.id, null, 'WEEK')}>Bu haftayı iptal et</button>
                <button className="btn-ghost flex-1 justify-center text-red-500 hover:bg-red-50" onClick={() => onAssign(sablon.id, null, 'RECURRING')}>Seriyi iptal et</button>
              </div>
            ) : (
              <button className="btn-ghost w-full justify-center text-red-500 hover:bg-red-50 mt-2" onClick={() => onAssign(sablon.id, null, 'WEEK')}>Atamayı kaldır (bu hafta)</button>
            )
          )}
        </div>

        {!pasifMode ? (
          <div className="flex flex-col gap-2">
            {aktif ? (
              <button className="btn-ghost w-full justify-center" onClick={() => setPasifMode(true)}>Pasif Yap</button>
            ) : (
              // Kalıcı pasifse (aktif:false) tümünü aç; sadece bu hafta pasifse o haftayı aç
              <button className="btn-ghost w-full justify-center"
                onClick={() => onToggle(sablon.id, sablon.aktif === false ? 'all' : 'week', true)}>
                Aktif Yap
              </button>
            )}
            <button className="btn-ghost w-full justify-center text-red-500 hover:bg-red-50"
              onClick={async () => { if (await confirm('Bu etüt kalıcı olarak silinsin mi?')) onDelete(sablon.id); }}>
              Sil
            </button>
          </div>
        ) : (
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-muted)' }}>
            <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={sadeceBuHafta} onChange={e => setSadeceBuHafta(e.target.checked)} />
              Sadece bu hafta
            </label>
            <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
              {sadeceBuHafta
                ? 'Etüt yalnızca bu hafta pasifleşir, sonraki haftalarda tekrar açık olur.'
                : 'İşaret kaldırıldı — etüt bu hafta ve sonraki tüm haftalarda pasif olur.'}
            </p>
            <div className="flex justify-end gap-2 mt-3">
              <button className="btn-ghost" onClick={() => setPasifMode(false)}>Vazgeç</button>
              <button className="btn-primary !px-5"
                onClick={() => onToggle(sablon.id, sadeceBuHafta ? 'week' : 'all', false)}>
                Onayla
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Slot eylem modalı: elle sınıf+ders ata / müsait işaretle / temizle ──────
// Çözücüyü hiç çalıştırmadan programı elle kurmak için: slota tıkla → sınıf+ders seç.
// Kurallar (çakışma/izin/mezun hafta içi) sunucuda POST /api/program sırasında uygulanır.
function SlotDersModal({ dayIndex, slotStart, entry, classes, branches, allowedGroups, onAta, onMusait, onTemizle, onClose }: {
  dayIndex: number; slotStart: string; entry: ProgramEntry | null;
  classes: ClassRecord[]; branches: string[]; allowedGroups: string[];
  onAta: (cls: string, branch: string) => void; onMusait: () => void; onTemizle: () => void; onClose: () => void;
}) {
  const dayLabel = ALL_DAYS.find(d => d.index === dayIndex)?.label || '';
  const inGroup = (c: ClassRecord) => !allowedGroups.length || allowedGroups.includes(c.group);
  // Bir dersi ALABİLEN sınıflar: o sınıfın ders listesinde (coursesForClass) ders var
  // + öğretmenin grupları. Sınıfın dersleri tanımsızsa (null) kısıt uygulanmaz.
  const classesForBranch = (b: string) => classes.filter(c => {
    if (!inGroup(c)) return false;
    const cs = coursesForClass(classes, c.id);
    return !cs || cs.includes(b);
  });
  // Bir sınıfın öğretmence VERİLEBİLİR dersleri: sınıf dersleri ∩ öğretmen branşları.
  const branchesForCls = (id: string) => {
    const cs = coursesForClass(classes, id);
    return cs ? branches.filter(b => cs.includes(b)) : branches;
  };
  const [branch, setBranch] = useState(entry?.branch || branches[0] || '');
  const [cls, setCls] = useState(entry?.cls || classesForBranch(entry?.branch || branches[0] || '')[0]?.id || '');

  // Çift yönlü eligibility: ders seçilince sınıflar, sınıf seçilince dersler filtrelenir.
  const eligibleClasses = classesForBranch(branch);
  const eligibleBranches = cls ? branchesForCls(cls) : branches;

  const onBranchChange = (nb: string) => {
    setBranch(nb);
    const ok = classesForBranch(nb);
    if (!cls || !ok.some(c => c.id === cls)) setCls(ok[0]?.id || ''); // sınıf artık uymuyorsa düzelt
  };
  const onClsChange = (nc: string) => {
    setCls(nc);
    const okB = branchesForCls(nc);
    if (!branch || !okB.includes(branch)) setBranch(okB[0] || ''); // ders artık uymuyorsa düzelt
  };
  return (
    <Modal title={`${dayLabel} ${slotStart} — Ders Saati`} onClose={onClose}>
      <div className="space-y-3">
        {entry?.type === 'ders' && (
          <p className="text-xs px-2 py-1.5 rounded" style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
            Şu an atanmış: <b style={{ fontWeight: 700 }}>{classLabelFrom(classes, entry.cls || '', classLabel)}</b>{entry.branch ? ` · ${entry.branch}` : ''}
          </p>
        )}
        <div>
          <label className="text-label block mb-1">Sınıf</label>
          <select className="input" value={cls} onChange={e => onClsChange(e.target.value)}>
            {eligibleClasses.length === 0 && <option value="">— bu dersi alan sınıf yok —</option>}
            {eligibleClasses.map(c => <option key={c.id} value={c.id}>{c.ad}</option>)}
          </select>
        </div>
        <div>
          <label className="text-label block mb-1">Ders</label>
          <select className="input" value={branch} onChange={e => onBranchChange(e.target.value)}>
            {eligibleBranches.length === 0 && <option value="">— bu sınıfın alabildiği ders yok —</option>}
            {eligibleBranches.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <button className="btn-primary w-full" disabled={!cls || !branch} onClick={() => onAta(cls, branch)}>
          Ders Olarak Ata
        </button>
        <div className="flex gap-2 pt-2" style={{ borderTop: '1px solid var(--border-light)' }}>
          <button className="btn-ghost flex-1 !text-xs" onClick={onMusait}>Boş Ders Saati (müsait)</button>
          {entry && <button className="btn-ghost !text-xs text-red-500 hover:bg-red-50" onClick={onTemizle}>Temizle</button>}
        </div>
      </div>
    </Modal>
  );
}
