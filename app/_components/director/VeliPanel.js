'use client';

// Veli paneli — sınıf akordiyonu → veli listesi (öğrenci başına) → veli detay akordiyonu.
// Veri öğrenci kaydında tutulur (parentName/parentPhone/parentRelation/parentNote + 2. iletişim).
// Düzenleme: PUT /api/students. Şifre sıfırlama: POST /api/parents {action:'reset'} (telefon = geçici şifre).
import React, { useState, useMemo } from 'react';
import { ChevronRight, GraduationCap, Phone, KeyRound, Save, UserPlus, X } from 'lucide-react';
import { classLabel, PARENT_RELATIONS } from '@/lib/constants';
import { GROUPS, api } from './shared';
import { formatTurkishMobile } from '@/lib/phone';

function RelationSelect({ value, onChange, placeholder = 'Yakınlık seç' }) {
  return (
    <select className="input" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {PARENT_RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
    </select>
  );
}

// Tek velinin (öğrencinin) açılır detayı — düzenlenebilir form.
function VeliDetay({ student, onSaved, showToast }) {
  const [parentName, setParentName] = useState(student.parentName || '');
  const [parentPhone, setParentPhone] = useState(student.parentPhone ? formatTurkishMobile(student.parentPhone) : '');
  const [parentRelation, setParentRelation] = useState(student.parentRelation || '');
  const [parentNote, setParentNote] = useState(student.parentNote || '');
  const [showSecond, setShowSecond] = useState(!!(student.parent2Name || student.parent2Phone));
  const [parent2Name, setParent2Name] = useState(student.parent2Name || '');
  const [parent2Phone, setParent2Phone] = useState(student.parent2Phone ? formatTurkishMobile(student.parent2Phone) : '');
  const [parent2Relation, setParent2Relation] = useState(student.parent2Relation || '');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/students', {
        method: 'PUT',
        body: JSON.stringify({
          id: student.id, name: student.name, cls: student.cls,
          parentName, parentPhone, parentRelation, parentNote,
          parent2Name: showSecond ? parent2Name : '',
          parent2Phone: showSecond ? parent2Phone : '',
          parent2Relation: showSecond ? parent2Relation : '',
        }),
      });
      showToast('Veli bilgileri kaydedildi');
      onSaved?.();
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  const resetPassword = async () => {
    if (!student.parentPhone) { showToast('Veli telefonu yok — önce telefon kaydet', 'error'); return; }
    if (!confirm(`${parentName || 'Veli'} şifresi sıfırlansın mı? Yeni geçici şifre telefon numarası olur.`)) return;
    setResetting(true);
    try {
      await api('/api/parents', { method: 'POST', body: JSON.stringify({ action: 'reset', phone: student.parentPhone }) });
      showToast('Veli şifresi sıfırlandı (telefon = geçici şifre)');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setResetting(false); }
  };

  return (
    <div className="px-3 py-3 space-y-3 border-t border-gray-100">
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block">
          <span className="text-label block mb-1">Veli Adı Soyadı</span>
          <input className="input" value={parentName} onChange={e => setParentName(e.target.value)} placeholder="Örn. Ayşe Yılmaz" />
        </label>
        <label className="block">
          <span className="text-label block mb-1">Yakınlık Derecesi</span>
          <RelationSelect value={parentRelation} onChange={setParentRelation} />
        </label>
        <label className="block">
          <span className="text-label block mb-1">Telefon</span>
          <input className="input" type="tel" inputMode="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)} placeholder="05XX XXX XX XX" />
        </label>
        <div className="flex items-end">
          <button onClick={resetPassword} disabled={resetting}
            className="btn-ghost !px-3 !py-2.5 text-xs flex items-center gap-1.5 border border-amber-200 text-amber-700 hover:bg-amber-50 w-full justify-center">
            <KeyRound size={13} /> {resetting ? 'Sıfırlanıyor…' : 'Şifreyi Sıfırla'}
          </button>
        </div>
      </div>

      <label className="block">
        <span className="text-label block mb-1">Veliye Özel Not (yalnız yönetim görür)</span>
        <textarea className="input" rows={2} value={parentNote} onChange={e => setParentNote(e.target.value)} placeholder="Örn. ödemeleri ayın sonunda yapıyor, dededen iletişim..." />
      </label>

      {!showSecond ? (
        <button onClick={() => setShowSecond(true)} className="btn-ghost !px-3 !py-2 text-xs flex items-center gap-1.5">
          <UserPlus size={13} /> 2. İletişim Numarası Ekle
        </button>
      ) : (
        <div className="rounded-xl p-3 space-y-3" style={{ background: 'var(--bg-muted)' }}>
          <div className="flex items-center justify-between">
            <span className="text-label">2. İletişim</span>
            <button onClick={() => setShowSecond(false)} className="p-1 rounded hover:bg-gray-200 text-gray-400" title="Kaldır"><X size={14} /></button>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-label block mb-1">Ad Soyad</span>
              <input className="input" value={parent2Name} onChange={e => setParent2Name(e.target.value)} placeholder="Örn. Mehmet Yılmaz" />
            </label>
            <label className="block">
              <span className="text-label block mb-1">Yakınlık Derecesi</span>
              <RelationSelect value={parent2Relation} onChange={setParent2Relation} />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-label block mb-1">Telefon</span>
              <input className="input" type="tel" inputMode="tel" value={parent2Phone} onChange={e => setParent2Phone(e.target.value)} placeholder="05XX XXX XX XX" />
            </label>
          </div>
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button onClick={save} disabled={saving} className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5">
          <Save size={14} /> {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>
    </div>
  );
}

export default function VeliPanel({ students, onChanged, showToast }) {
  const [searchQ, setSearchQ] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [openCls, setOpenCls] = useState(null);
  const [expandedId, setExpandedId] = useState(null);

  const grouped = useMemo(() => {
    const q = searchQ.toLowerCase();
    const groupOrder = { ortaokul: 0, lise: 1, mezun: 2 };
    const clsSort = cls => cls.startsWith('m') ? parseInt(cls.slice(1)) : parseInt(cls);
    const sorted = students
      .filter(s =>
        (s.name.toLowerCase().includes(q) || s.cls.toLowerCase().includes(q) || (s.parentName || '').toLowerCase().includes(q) || (s.parentPhone || '').includes(q)) &&
        (!filterGroup || s.group === filterGroup)
      )
      .sort((a, b) => {
        const gDiff = (groupOrder[a.group] ?? 9) - (groupOrder[b.group] ?? 9);
        if (gDiff !== 0) return gDiff;
        return clsSort(a.cls) - clsSort(b.cls);
      });
    const groups = [];
    for (const s of sorted) {
      if (!groups.length || groups[groups.length - 1].cls !== s.cls) {
        groups.push({ cls: s.cls, label: classLabel(s.cls), group: s.group, students: [] });
      }
      groups[groups.length - 1].students.push(s);
    }
    return groups;
  }, [students, searchQ, filterGroup]);

  const toggle = cls => { setOpenCls(prev => prev === cls ? null : cls); setExpandedId(null); };

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input className="input text-sm" placeholder="Öğrenci, veli adı, telefon..." aria-label="Veli ara" value={searchQ} onChange={e => setSearchQ(e.target.value)} />
        <select className="input !w-auto text-sm" aria-label="Gruba göre filtrele" value={filterGroup} onChange={e => setFilterGroup(e.target.value)}>
          <option value="">Tüm Gruplar</option>
          {Object.entries(GROUPS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div className="grid gap-2">
        {grouped.length === 0 && (
          <div className="card p-8 text-center text-gray-400">
            <GraduationCap size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-caption">Arama kriterinizle eşleşen kayıt yok</p>
          </div>
        )}
        {grouped.map(grp => {
          const isOpen = openCls === grp.cls;
          const dotColor = grp.group === 'lise'
            ? 'linear-gradient(135deg,#6366f1,#4f46e5)'
            : grp.group === 'ortaokul'
            ? 'linear-gradient(135deg,#22c55e,#16a34a)'
            : 'linear-gradient(135deg,#f59e0b,#d97706)';
          return (
            <div key={grp.cls}>
              <button onClick={() => toggle(grp.cls)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-700 transition-colors hover:brightness-95"
                style={{ fontWeight: 700, background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}>
                <span>{grp.label} <span className="font-500 opacity-60" style={{ fontWeight: 500 }}>({grp.students.length} veli)</span></span>
                <ChevronRight size={14} className="transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)' }} />
              </button>
              {isOpen && (
                <div className="grid gap-1.5 mt-1.5 ml-2">
                  {grp.students.map(s => {
                    const isExp = expandedId === s.id;
                    const hasParent = !!(s.parentName || s.parentPhone);
                    return (
                      <div key={s.id} className={`card overflow-hidden text-sm ${isExp ? '' : 'card-interactive'}`}>
                        <button className="w-full flex items-center justify-between px-3 py-3 text-left"
                          onClick={() => setExpandedId(isExp ? null : s.id)}>
                          <span className="flex items-center gap-3 min-w-0">
                            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-xs font-700 shrink-0"
                              style={{ background: dotColor, fontWeight: 700 }}>
                              {s.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="font-600 truncate block" style={{ fontWeight: 600 }}>{s.name}</span>
                              <span className="text-caption truncate block">
                                {hasParent
                                  ? `${s.parentName || 'Veli'}${s.parentRelation ? ` · ${s.parentRelation}` : ''}${s.parentPhone ? ` · ${formatTurkishMobile(s.parentPhone)}` : ''}`
                                  : 'Veli bilgisi eksik'}
                              </span>
                            </span>
                          </span>
                          <ChevronRight size={14} className="text-gray-400 shrink-0 transition-transform ml-2"
                            style={{ transform: isExp ? 'rotate(90deg)' : 'rotate(0deg)' }} />
                        </button>
                        {isExp && <VeliDetay student={s} onSaved={onChanged} showToast={showToast} />}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
