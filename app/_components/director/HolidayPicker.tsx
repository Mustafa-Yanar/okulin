'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { CalendarOff, Plus, Trash2 } from 'lucide-react';
import { api } from '../shared';
import { useConfirm } from '../ConfirmProvider';
import type { ShowToast } from '../types';

interface EtkinlikDTO {
  id: string;
  title: string;
  type: string;
  startDate: string;
}

interface EtkinlikResponse {
  etkinlikler?: EtkinlikDTO[];
}

interface HolidayPickerProps {
  showToast?: ShowToast;
}

const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const DOW = ['Paz','Pzt','Sal','Çar','Per','Cum','Cmt'];

function fmt(ymd: string): string {
  const d = new Date(ymd + 'T00:00:00');
  if (isNaN(d.getTime())) return ymd;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${DOW[d.getDay()]}`;
}

// Tatil günlerini "Etkinlik" takvimi üzerinden (type='tatil') yönetir — ayrı bir depo değil,
// aynı kaynağı Ders Saatleri modülünden çoklu-gün seçimiyle besler.
export default function HolidayPicker({ showToast }: HolidayPickerProps) {
  const confirm = useConfirm();
  const { data, mutate } = useSWR<EtkinlikResponse>('/api/etkinlik');
  const holidays = useMemo(
    () => (data?.etkinlikler || []).filter(ev => ev.type === 'tatil').sort((a, b) => a.startDate.localeCompare(b.startDate)),
    [data],
  );
  const existingDates = useMemo(() => new Set(holidays.map(h => h.startDate)), [holidays]);
  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  function addDraft() {
    if (!draft) return;
    if (existingDates.has(draft) || picked.includes(draft)) { showToast?.('Bu tarih zaten listede', 'error'); return; }
    setPicked(p => [...p, draft].sort());
    setDraft('');
  }
  function removeDraft(d: string) { setPicked(p => p.filter(x => x !== d)); }

  async function save() {
    if (picked.length === 0) return;
    setBusy(true);
    try {
      await api('/api/etkinlik', { method: 'POST', body: JSON.stringify({ action: 'bulkTatil', dates: picked }) });
      showToast?.(`${picked.length} tatil günü eklendi`);
      setPicked([]);
      mutate();
    } catch (e) { showToast?.((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  async function removeExisting(h: EtkinlikDTO) {
    if (!(await confirm(`${fmt(h.startDate)} tatil günü kaldırılsın mı?`))) return;
    try {
      await api(`/api/etkinlik?id=${encodeURIComponent(h.id)}`, { method: 'DELETE' });
      mutate({ etkinlikler: (data?.etkinlikler || []).filter(x => x.id !== h.id) }, { revalidate: false });
      showToast?.('Tatil günü kaldırıldı');
    } catch (e) { showToast?.((e as Error).message, 'error'); }
  }

  return (
    <div className="rounded-xl p-4 mt-4" style={{ background: 'var(--bg-surface-2)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center gap-2 mb-3">
        <CalendarOff size={18} className="text-brand" />
        <h3 className="font-700" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Tatil Günleri</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Seçilen günlerde ders/etüt slotları otomatik pasifleşir. Birden çok gün seçip topluca kaydedebilirsiniz.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <input type="date" value={draft} onChange={e => setDraft(e.target.value)} className="input !w-auto !text-xs !py-1.5 !px-2" />
        <button onClick={addDraft} className="text-xs px-2.5 py-1.5 rounded-md flex items-center gap-1" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
          <Plus size={13} /> Listeye ekle
        </button>
      </div>

      {picked.length > 0 && (
        <div className="mb-3">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {picked.map(d => (
              <span key={d} className="text-xs px-2 py-1 rounded-md flex items-center gap-1" style={{ background: 'color-mix(in srgb, #16a34a 16%, transparent)', color: '#16a34a', border: '1px solid color-mix(in srgb, #16a34a 30%, transparent)' }}>
                {fmt(d)}
                <button onClick={() => removeDraft(d)} className="hover:opacity-70"><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
          <button onClick={save} disabled={busy} className="btn-primary !px-4 !py-2 text-sm">
            {busy ? 'Kaydediliyor…' : `${picked.length} tatil günü kaydet`}
          </button>
        </div>
      )}

      {holidays.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wide mb-1.5" style={{ fontWeight: 700, color: 'var(--text-muted)' }}>Kayıtlı tatil günleri</h4>
          <div className="flex flex-wrap gap-1.5">
            {holidays.map(h => (
              <span key={h.id} className="text-xs px-2 py-1 rounded-md flex items-center gap-1" style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}>
                {fmt(h.startDate)}
                <button onClick={() => removeExisting(h)} className="hover:text-rose-500" style={{ color: 'var(--text-muted)' }}><Trash2 size={11} /></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
