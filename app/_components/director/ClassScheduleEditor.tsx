'use client';

// Sınıf ders programı editörü (KATI pencere). Öğretmen program editörünün sınıf
// karşılığı: müdür, her sınıf için hangi gün-slotlarına ders yerleşebileceğini
// tek-tık işaretler. İşaretli (gün, ders no) çiftleri class.slotTemplate'e yazılır
// ve CP-SAT'a windows olarak gider — işaretsiz slota program oluşturucu ders koymaz.
//
// Haftadan bağımsız kalıcı şablon (öğretmen offDays gibi). Etüt/hafta navigasyonu yok.
import React, { useState, useMemo } from 'react';
import { Save } from 'lucide-react';
import { ALL_DAYS, daySlots, type Slot } from '@/lib/constants';
import { useSlotTimes } from '../SlotTimesContext';
import { api, Modal } from './shared';
import type { ShowToast } from '../types';

// class.slotTemplate sözleşmesi: { "gün": [slotNo...] } (1-tabanlı).
type SlotTemplate = Record<string, number[]>;

interface ClassScheduleEditorProps {
  cls: string;
  label?: string;
  initialTemplate?: Record<string | number, number[]> | null;
  onClose: () => void;
  onSaved?: (tpl: SlotTemplate | null) => void;
  showToast?: ShowToast;
}

export default function ClassScheduleEditor({ cls, label, initialTemplate, onClose, onSaved, showToast }: ClassScheduleEditorProps) {
  const { slotTimes } = useSlotTimes();
  const [saving, setSaving] = useState(false);

  // template: { [dayIndex]: Set(slotNo) }
  const [template, setTemplate] = useState<Record<number, Set<number>>>(() => {
    const t: Record<number, Set<number>> = {};
    for (const day of ALL_DAYS) {
      const nos = (initialTemplate && initialTemplate[day.index]) || [];
      t[day.index] = new Set(nos);
    }
    return t;
  });

  // Her günün slotları (7-gün model — kendi count/saatleri).
  const daySlotsMap = useMemo(() => {
    const m: Record<number, Slot[]> = {};
    for (const day of ALL_DAYS) m[day.index] = daySlots(day.index, slotTimes.days?.[day.index]);
    return m;
  }, [slotTimes]);

  const maxSlots = useMemo(
    () => ALL_DAYS.reduce((mx, d) => Math.max(mx, daySlotsMap[d.index].length), 0),
    [daySlotsMap],
  );

  const selectedCount = useMemo(
    () => ALL_DAYS.reduce((s, d) => s + template[d.index].size, 0),
    [template],
  );

  function toggle(dayIndex: number, slotNo: number) {
    setTemplate(prev => {
      const set = new Set(prev[dayIndex]);
      if (set.has(slotNo)) set.delete(slotNo); else set.add(slotNo);
      return { ...prev, [dayIndex]: set };
    });
  }

  // Bir günün tüm slotlarını aç/kapat (başlığa tıkla).
  function toggleDay(dayIndex: number) {
    const slots = daySlotsMap[dayIndex];
    setTemplate(prev => {
      const cur = prev[dayIndex];
      const allOn = slots.length > 0 && slots.every((_, i) => cur.has(i + 1));
      const next = new Set<number>();
      if (!allOn) slots.forEach((_, i) => next.add(i + 1));
      return { ...prev, [dayIndex]: next };
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      const slotTemplate: SlotTemplate = {};
      for (const day of ALL_DAYS) {
        const arr = [...template[day.index]].sort((a, b) => a - b);
        if (arr.length) slotTemplate[String(day.index)] = arr;
      }
      await api('/api/classes', {
        method: 'PATCH',
        body: JSON.stringify({ id: cls, slotTemplate: Object.keys(slotTemplate).length ? slotTemplate : null }),
      });
      showToast?.('Sınıf programı penceresi kaydedildi');
      onSaved?.(Object.keys(slotTemplate).length ? slotTemplate : null);
      onClose();
    } catch (e) {
      showToast?.((e as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`${label || cls.toUpperCase()} – Ders Programı Penceresi`} onClose={onClose} wide>
      <p className="text-[11px] mb-3 px-1" style={{ color: 'var(--text-muted)' }}>
        Bu sınıfa ders yerleştirilebilecek saatleri işaretleyin (mavi = açık). Program
        Oluşturucu yalnızca işaretli saatlere ders koyar. Gün başlığına tıklayarak o günün
        tümünü aç/kapat yapabilirsiniz.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-xs" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
          <thead>
            <tr>
              <th className="text-left py-2 px-2 w-10" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>#</th>
              {ALL_DAYS.map(day => {
                const slots = daySlotsMap[day.index];
                const allOn = slots.length > 0 && slots.every((_, i) => template[day.index].has(i + 1));
                return (
                  <th key={day.index} className="text-center py-1.5 px-1" style={{ fontWeight: 600 }}>
                    <button onClick={() => toggleDay(day.index)}
                      className="w-full rounded-md py-1 px-1 transition-colors"
                      style={{
                        color: day.weekend ? '#6366f1' : 'var(--text-secondary)',
                        background: allOn ? 'color-mix(in srgb,#3b82f6 14%,transparent)' : 'transparent',
                      }}
                      title="O günün tümünü aç/kapat">
                      {day.short}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxSlots }, (_, i) => i + 1).map(slotNo => (
              <tr key={slotNo}>
                <td className="py-1 px-2" style={{ color: 'var(--text-muted)', fontWeight: 500 }}>{slotNo}.</td>
                {ALL_DAYS.map(day => {
                  const slots = daySlotsMap[day.index];
                  const slot = slots[slotNo - 1];
                  if (!slot) return <td key={day.index} className="py-1 px-1" />;
                  const on = template[day.index].has(slotNo);
                  return (
                    <td key={day.index} className="py-0.5 px-1">
                      <button onClick={() => toggle(day.index, slotNo)}
                        className="w-full rounded-md py-1.5 px-1 text-center transition-colors"
                        style={{
                          background: on ? 'color-mix(in srgb,#3b82f6 20%,transparent)' : 'var(--bg-muted,#f1f5f9)',
                          border: on ? '1px solid #3b82f6' : '1px dashed var(--border-subtle)',
                          color: on ? 'var(--text-primary)' : 'var(--text-muted)',
                        }}
                        title={`${slot.start}–${slot.end} — tıkla: ${on ? 'kapat' : 'aç'}`}>
                        <div className="text-[10px] leading-tight" style={{ fontWeight: on ? 600 : 400 }}>
                          {slot.start}
                        </div>
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <span className="text-caption" style={{ color: 'var(--text-muted)' }}>{selectedCount} slot işaretli</span>
        <div className="flex-1" />
        <button className="btn-ghost" onClick={onClose}>İptal</button>
        <button className="btn-primary flex items-center gap-1.5" onClick={handleSave} disabled={saving}>
          <Save size={14} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </Modal>
  );
}
