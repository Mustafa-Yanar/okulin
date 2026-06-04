'use client';

// Müdür paneli modal formları: öğretmen, öğrenci, Excel import, şifre sıfırlama.
import React, { useState, useEffect, useMemo } from 'react';
import { User, Check, BookOpen } from 'lucide-react';
import { STUDENT_GROUPS, classLabel, branchesForGroups } from '@/lib/constants';
import { isValidTurkishMobile, formatTurkishMobile } from '@/lib/phone';
import { GROUPS, Modal, Label, FormField } from './shared';

export function TeacherForm({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name||'');
  const [password, setPassword] = useState('');
  const [branches, setBranches] = useState(initial?.branches||[]);
  const [allowedGroups, setAllowedGroups] = useState(initial?.allowedGroups||[]);
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl||'');
  const [phone, setPhone] = useState(initial?.phone ? formatTurkishMobile(initial.phone) : '');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const phoneInvalid = phone.trim() !== '' && !isValidTurkishMobile(phone);

  const toggleGroup = g => setAllowedGroups(prev => {
    const next = prev.includes(g) ? prev.filter(x=>x!==g) : [...prev, g];
    const allowed = branchesForGroups(next);
    setBranches(bs => bs.filter(b => allowed.includes(b)));
    return next;
  });
  const toggleBranch = b => setBranches(prev => prev.includes(b)?prev.filter(x=>x!==b):[...prev,b]);

  const visibleBranches = useMemo(() => branchesForGroups(allowedGroups), [allowedGroups]);

  const handlePhoto = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.url) setPhotoUrl(data.url);
      else throw new Error(data.error);
    } catch (err) { alert(err.message); }
    finally { setUploading(false); }
  };

  const submit = async e => {
    e.preventDefault();
    if (branches.length === 0) { alert('En az bir branş seçin'); return; }
    if (phoneInvalid) return;
    setLoading(true);
    await onSave({name, username: name, password, branches, allowedGroups, photoUrl, phone});
    setLoading(false);
  };
  return (
    <Modal title={initial?'Öğretmen Düzenle':'Yeni Öğretmen'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center shrink-0">
            {photoUrl ? <img src={photoUrl} alt="" className="w-full h-full object-cover" /> : <User size={28} className="text-gray-400" />}
          </div>
          <div>
            <label className="btn-ghost !px-3 !py-2 text-sm cursor-pointer inline-block">
              {uploading ? 'Yükleniyor...' : 'Fotoğraf Seç'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handlePhoto} disabled={uploading} />
            </label>
            {photoUrl && <button type="button" className="block text-xs text-red-400 mt-1 hover:underline" onClick={() => setPhotoUrl('')}>Fotoğrafı kaldır</button>}
          </div>
        </div>
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label={initial?'Şifre (boş bırakırsan değişmez)':'Şifre'}>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required={!initial} />
        </FormField>
        <div>
          <Label>Telefon <span className="text-gray-400 font-400" style={{fontWeight:400}}>(opsiyonel)</span></Label>
          <input className={`input ${phoneInvalid ? '!border-red-400 !bg-red-50' : ''}`} type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e=>setPhone(e.target.value)} />
          {phoneInvalid && <p className="text-xs text-red-500 mt-1">Geçersiz numara. Örnek: 0532 123 45 67</p>}
        </div>
        <div>
          <Label>Hangi gruplara ders girebilir?</Label>
          <p className="text-caption mb-2">Hiç seçilmezse tüm gruplara açık. Branş listesi buna göre belirlenir.</p>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(GROUPS).map(([key,label]) => (
              <button key={key} type="button" onClick={() => toggleGroup(key)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all font-500 ${allowedGroups.includes(key)?'border-indigo-300 bg-indigo-50 text-indigo-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                style={{ fontWeight:500 }}>
                {allowedGroups.includes(key)&&<Check size={12} className="inline mr-1" />}{label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Branşlar <span className="text-gray-400 font-400" style={{fontWeight:400}}>(verebildiği dersler)</span></Label>
          <p className="text-caption mb-2">Öğretmenin girebileceği dersleri işaretleyin. Sadece işaretli dersler atanabilir.</p>
          <div className="flex gap-2 flex-wrap">
            {visibleBranches.map(b => (
              <button key={b} type="button" onClick={() => toggleBranch(b)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-all font-500 ${branches.includes(b)?'border-violet-300 bg-violet-50 text-violet-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                style={{fontWeight:500}}>
                {branches.includes(b)&&<Check size={12} className="inline mr-1" />}{b}
              </button>
            ))}
          </div>
          {branches.length === 0 && <p className="text-xs mt-2" style={{ color: 'var(--color-warning)' }}>En az bir branş seçin.</p>}
        </div>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading || phoneInvalid}>{loading?'Kaydediliyor...':'Kaydet'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

export function StudentForm({ initial, onClose, onSave, onSwitchToImport }) {
  const [name, setName] = useState(initial?.name||'');
  const [password, setPassword] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(initial?.group||'ortaokul');
  const [cls, setCls] = useState(initial?.cls||STUDENT_GROUPS.ortaokul.classes[0]);
  const [phone, setPhone] = useState(initial?.phone ? formatTurkishMobile(initial.phone) : '');
  const [parentPhone, setParentPhone] = useState(initial?.parentPhone ? formatTurkishMobile(initial.parentPhone) : '');
  const [parentName, setParentName] = useState(initial?.parentName || '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate || '');
  const [loading, setLoading] = useState(false);
  useEffect(() => { if (!initial) setCls(STUDENT_GROUPS[selectedGroup].classes[0]); }, [selectedGroup]);

  const phoneInvalid = phone.trim() !== '' && !isValidTurkishMobile(phone);
  const parentPhoneInvalid = parentPhone.trim() !== '' && !isValidTurkishMobile(parentPhone);

  const submit = async e => {
    e.preventDefault();
    if (phoneInvalid || parentPhoneInvalid) return; // geçersiz telefonla gönderme
    setLoading(true);
    await onSave({ name, username: name, password, cls, phone, parentPhone, parentName, birthDate });
    setLoading(false);
  };
  return (
    <Modal title={initial?'Öğrenci Düzenle':'Yeni Öğrenci'} onClose={onClose}>
      {!initial && onSwitchToImport && (
        <div className="mb-4 -mt-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100">
          <span className="text-xs text-indigo-600">Toplu öğrenci yüklemek ister misin?</span>
          <button type="button" onClick={onSwitchToImport}
            className="text-xs font-600 text-indigo-700 hover:text-indigo-900 flex items-center gap-1 shrink-0" style={{ fontWeight: 600 }}>
            <BookOpen size={12} /> Excel ile Yükle →
          </button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label={initial?'Şifre (boş bırakırsan değişmez)':'Şifre'}>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} required={!initial} />
        </FormField>
        <FormField label="Grup">
          <select className="input" value={selectedGroup} onChange={e=>setSelectedGroup(e.target.value)} disabled={!!initial}>
            {Object.entries(GROUPS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <FormField label="Sınıf">
          <select className="input" value={cls} onChange={e=>setCls(e.target.value)}>
            {STUDENT_GROUPS[selectedGroup].classes.map(c=><option key={c} value={c}>{classLabel(c)}</option>)}
          </select>
        </FormField>
        <FormField label="Öğrenci Telefonu">
          <input className={`input ${phoneInvalid ? '!border-red-400 !bg-red-50' : ''}`} type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e=>setPhone(e.target.value)} />
          {phoneInvalid && <p className="text-xs text-red-500 mt-1">Geçersiz numara. Örnek: 0532 123 45 67</p>}
        </FormField>
        <FormField label="Veli Adı Soyadı">
          <input className="input" type="text" placeholder="Örn. Ayşe Yılmaz" value={parentName} onChange={e=>setParentName(e.target.value)} />
        </FormField>
        <FormField label="Veli Telefonu">
          <input className={`input ${parentPhoneInvalid ? '!border-red-400 !bg-red-50' : ''}`} type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={parentPhone} onChange={e=>setParentPhone(e.target.value)} />
          {parentPhoneInvalid && <p className="text-xs text-red-500 mt-1">Geçersiz numara. Örnek: 0532 123 45 67</p>}
        </FormField>
        <FormField label="Doğum Tarihi">
          <input className="input" type="date" value={birthDate} onChange={e=>setBirthDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]} />
        </FormField>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading || phoneInvalid || parentPhoneInvalid}>{loading?'Kaydediliyor...':'Kaydet'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

export function ImportModal({ onClose, showToast, onDone }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/students/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResult(data);
      showToast(`${data.added.length} öğrenci eklendi`);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Excel'den Öğrenci Yükle" onClose={onClose}>
      <p className="text-sm text-gray-500 mb-4">
        Excel dosyası: <strong>A sütunu</strong> isim soyisim, <strong>B sütunu</strong> sınıf kodu (701, 802, 101 vb.)
      </p>
      {!result ? (
        <label className={`btn-primary flex items-center justify-center gap-2 cursor-pointer ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <BookOpen size={14} /> {loading ? 'Yükleniyor...' : 'Excel Dosyası Seç'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} disabled={loading} />
        </label>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="card p-3"><div className="text-xl font-700 text-green-600" style={{fontWeight:700}}>{result.added.length}</div><div className="text-xs text-gray-500">Eklendi</div></div>
            <div className="card p-3"><div className="text-xl font-700 text-amber-500" style={{fontWeight:700}}>{result.skipped.length}</div><div className="text-xs text-gray-500">Zaten Var</div></div>
            <div className="card p-3"><div className="text-xl font-700 text-red-400" style={{fontWeight:700}}>{result.errors.length}</div><div className="text-xs text-gray-500">Hata</div></div>
          </div>
          {result.added.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-1">
              <p className="text-xs font-600 text-gray-500 mb-1" style={{fontWeight:600}}>Eklenen öğrenciler ve şifreleri:</p>
              {result.added.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-green-50">
                  <span className="font-500" style={{fontWeight:500}}>{s.name} <span className="text-gray-400">({s.cls})</span></span>
                  <span className="text-gray-500 font-mono">{s.password}</span>
                </div>
              ))}
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-600 text-red-500 mb-1" style={{fontWeight:600}}>Hatalar:</p>
              {result.errors.map((e, i) => <p key={i} className="text-xs text-red-400">{e}</p>)}
            </div>
          )}
          <button className="btn-primary w-full" onClick={onDone}>Kapat</button>
        </div>
      )}
    </Modal>
  );
}
