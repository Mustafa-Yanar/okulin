'use client';

// Muhasebeci "Öğrenciler" sekmesi — KAYIT penceresi. Müdürdeki Sınıf/Öğrenci'nin
// kopyası DEĞİL: öğrenci ekle, kimlik/veli bilgisi düzenle, listede bul. Rehberlik
// notu, davranış, deneme gibi akademik detaylar bilinçli olarak YOK (hassas veri,
// muhasebecinin işi değil). Silme de yok — 'manage' yetkisinde (müdürde) kalır.
//
// prefill: Ön Kayıt köprüsü — "kayıt oldu" adayından gelen {name, parentName,
// parentPhone}; form yeni-kayıt modunda önceden dolu açılır (StudentForm isEdit
// ayrımı initial.id'ye bakar). onGoFinance: kayıt sonrası ödeme planı kısayolu.

import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Search, UserPlus, Edit3, Wallet, GraduationCap, X } from 'lucide-react';
import { StudentForm } from '../director/Forms';
import EmptyState from '../EmptyState';
import LoadingBox from '../Loading';
import { api } from '../client-api';

export default function AccountantStudents({ showToast, prefill, onPrefillConsumed, onGoFinance }) {
  const { data: students, isLoading, mutate } = useSWR('/api/students');
  const { data: classData } = useSWR('/api/classes');
  const classes = classData?.classes || [];

  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [lastRegistered, setLastRegistered] = useState(null);

  // Ön Kayıt köprüsü: prefill gelince formu yeni-kayıt modunda aç.
  useEffect(() => {
    if (prefill) { setEditing(null); setFormOpen(true); }
  }, [prefill]);

  const labelOf = (cls) => classes.find((c) => c.id === cls)?.ad || cls || '—';

  const list = Array.isArray(students) ? students : [];
  const q = search.trim().toLowerCase();
  const filtered = !q ? list : list.filter((s) =>
    s.name.toLowerCase().includes(q) ||
    labelOf(s.cls).toLowerCase().includes(q) ||
    (s.parentName || '').toLowerCase().includes(q) ||
    (s.parentPhone || '').includes(q.replace(/\s/g, '')));

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    if (prefill) onPrefillConsumed?.();
  }

  async function save(data) {
    try {
      if (editing) {
        await api('/api/students', { method: 'PUT', body: JSON.stringify({ id: editing.id, ...data }) });
        showToast?.('Öğrenci güncellendi');
      } else {
        await api('/api/students', { method: 'POST', body: JSON.stringify(data) });
        showToast?.('Öğrenci kaydedildi');
        setLastRegistered({ name: data.name });
      }
      closeForm();
      mutate();
    } catch (e) { showToast?.(e.message, 'error'); }
  }

  if (isLoading) return <LoadingBox height="h-64" />;

  return (
    <div className="max-w-3xl">
      {/* Kayıt → Ödemeler köprüsü */}
      {lastRegistered && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 mb-4"
          style={{ background: 'var(--color-success-bg, #f0fdf4)', border: '1px solid var(--color-success-border, #bbf7d0)' }}>
          <span className="text-sm" style={{ color: 'var(--color-success, #15803d)' }}>
            <b>{lastRegistered.name}</b> kaydedildi. Ödeme planını şimdi kurabilirsiniz.
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {onGoFinance && (
              <button onClick={() => { onGoFinance(lastRegistered.name); setLastRegistered(null); }}
                className="btn-primary !px-3 !py-1.5 text-xs flex items-center gap-1.5">
                <Wallet size={13} /> Ödeme planına git
              </button>
            )}
            <button onClick={() => setLastRegistered(null)} aria-label="Kapat" className="btn-icon"><X size={14} /></button>
          </div>
        </div>
      )}

      {/* Arama + yeni kayıt */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            className="input !pl-9" placeholder="İsim, şube, veli adı veya telefon ara..." />
        </div>
        <button onClick={() => { setEditing(null); setFormOpen(true); }}
          className="btn-primary flex items-center gap-1.5 text-sm shrink-0">
          <UserPlus size={15} /> Yeni Öğrenci
        </button>
      </div>

      {/* Liste */}
      {list.length === 0 ? (
        <EmptyState icon={GraduationCap} title="Henüz öğrenci yok"
          description="Yeni Öğrenci ile ilk kaydı oluşturun." />
      ) : filtered.length === 0 ? (
        <p className="text-caption py-6 text-center">Aramayla eşleşen öğrenci yok.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((s) => (
            <div key={s.id} className="rounded-xl p-3.5 flex items-center justify-between gap-3"
              style={{ border: '1px solid var(--border-subtle)' }}>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{s.name}</p>
                  <span className="badge badge-info">{labelOf(s.cls)}</span>
                </div>
                <p className="text-body-sm mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                  {s.parentName || 'Veli kayıtlı değil'}{s.parentPhone ? ` · ${s.parentPhone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {onGoFinance && (
                  <button onClick={() => onGoFinance(s.name)} className="btn-icon" title="Ödeme planı / ödemeler">
                    <Wallet size={15} />
                  </button>
                )}
                <button onClick={() => { setEditing(s); setFormOpen(true); }} className="btn-icon" title="Bilgileri düzenle">
                  <Edit3 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <StudentForm initial={editing || prefill} classes={classes} onClose={closeForm} onSave={save} />
      )}
    </div>
  );
}
