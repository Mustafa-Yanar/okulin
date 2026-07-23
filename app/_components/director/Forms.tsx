'use client';
/* eslint-disable @next/next/no-img-element -- Yükleme önizlemesi blob/harici kullanıcı URL'sidir. */

// Müdür paneli modal formları: öğretmen, öğrenci, Excel import, şifre sıfırlama.
import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { User, Check, BookOpen, Download } from 'lucide-react';
import { classesForGroup, classShortUpper, type ClassEntry } from '@/lib/classCatalog';
import { isValidTurkishMobile, formatTurkishMobile } from '@/lib/phone';
import { GROUPS, Modal, Label, FormField } from './shared';
import { useClasses } from '../ClassesContext';
import type { ClassRecord } from '@/lib/classes';
import type { CourseRecord } from '@/lib/courses';
import type { ShowToast, StudentDTO, TeacherDTO } from '../types';

// TeacherForm onSave gövdesi (PUT/POST /api/teachers girişi).
export interface TeacherFormPayload {
  name: string;
  username: string;
  password: string;
  branches: string[];
  allowedGroups: string[];
  photoUrl: string;
  phone: string;
}

// StudentForm onSave gövdesi (PUT/POST /api/students girişi) — diplomaNotu
// formdan string gider, sunucu sayıya çevirir.
export interface StudentFormPayload {
  name: string;
  username: string;
  password: string;
  cls: string;
  phone: string;
  parentPhone: string;
  parentName: string;
  birthDate: string;
  diplomaNotu: string;
  tcNo: string;          // öğrenci TC (muhasebe belgeleri — opsiyonel)
  parentTcNo: string;    // veli TC (senet — opsiyonel)
  parentAddress: string; // veli adresi (senet — opsiyonel)
}

// allowedGroups birleşimi → o gruplardaki şubelerin (registry) kullandığı gerçek dersler,
// dedup + kataloğa göre sıralı. Sabit BRANCHES_BY_GROUP matrisi yerine — kurumun kendi
// eklediği dersler (örn. "Paragraf") de böylece öğretmen branşlarında görünür.
// Seçili grup(lar)da hiç şube/ders yoksa (örn. henüz mezun şubesi açılmamış) tüm kataloğa
// düşülür — öğretmen düzenlerken "seçilecek branş yok" çıkmazına düşmesin diye.
function branchesForGroups(groups: string[] | undefined, classes: ClassRecord[] | null, courses: CourseRecord[] | null): string[] {
  const gs = (groups && groups.length) ? groups : ['ortaokul', 'lise', 'mezun'];
  const gset = new Set(gs);
  const used = new Set<string>();
  for (const c of classes || []) if (gset.has(c.group)) for (const d of c.dersler || []) used.add(d);
  const order = new Map((courses || []).map((c, i) => [c.ad, i]));
  if (!used.size) return (courses || []).filter((c) => c.active !== false).map((c) => c.ad);
  return [...used].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999));
}

interface TeacherFormProps {
  initial?: TeacherDTO | null;
  onClose: () => void;
  onSave: (data: TeacherFormPayload) => void | Promise<void>;
}

export function TeacherForm({ initial, onClose, onSave }: TeacherFormProps) {
  const { classes: registryClasses, courses } = useClasses();
  const [name, setName] = useState(initial?.name||'');
  const [password, setPassword] = useState('');
  const [branches, setBranches] = useState<string[]>(initial?.branches||[]);
  const [allowedGroups, setAllowedGroups] = useState<string[]>(initial?.allowedGroups||[]);
  const [photoUrl, setPhotoUrl] = useState(initial?.photoUrl||'');
  const [phone, setPhone] = useState(initial?.phone ? formatTurkishMobile(initial.phone) : '');
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);

  const phoneInvalid = phone.trim() !== '' && !isValidTurkishMobile(phone);

  const toggleGroup = (g: string) => setAllowedGroups(prev => {
    const next = prev.includes(g) ? prev.filter(x=>x!==g) : [...prev, g];
    const allowed = branchesForGroups(next, registryClasses, courses);
    setBranches(bs => bs.filter(b => allowed.includes(b)));
    return next;
  });
  const toggleBranch = (b: string) => setBranches(prev => prev.includes(b)?prev.filter(x=>x!==b):[...prev,b]);

  const visibleBranches = useMemo(
    () => branchesForGroups(allowedGroups, registryClasses, courses),
    [allowedGroups, registryClasses, courses]
  );

  const handlePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) setPhotoUrl(data.url);
      else throw new Error(data.error);
    } catch (err) { alert((err as Error).message); }
    finally { setUploading(false); }
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
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
            {photoUrl ? <img src={photoUrl} alt="" width={64} height={64} className="w-full h-full object-cover" /> : <User size={28} className="text-gray-400" />}
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
        <FormField label={initial?'Şifre (boş bırakırsan değişmez)':'Şifre (boş bırakırsan telefon)'}>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)}
            placeholder={initial?'':'Boş = telefon (yoksa 12345678)'} />
          {!initial && <p className="text-caption mt-1">Boş bırakırsan ilk şifre öğretmenin telefonu olur; telefon da yoksa <b>12345678</b>. İlk girişte değiştirmesi istenir.</p>}
        </FormField>
        <div>
          <Label>Telefon <span className="font-400" style={{fontWeight:400, color:'var(--text-secondary)'}}>(opsiyonel)</span></Label>
          <input className={`input ${phoneInvalid ? 'input-error' : ''}`} type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e=>setPhone(e.target.value)} aria-invalid={phoneInvalid || undefined} />
          {phoneInvalid && <p className="input-hint input-hint--error">Geçersiz numara. Örnek: 0532 123 45 67</p>}
        </div>
        <div>
          <Label>Hangi gruplara ders girebilir?</Label>
          <p className="text-caption mb-2">Hiç seçilmezse tüm gruplara açık. Branş listesi buna göre belirlenir.</p>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(GROUPS).map(([key,label]) => (
              <button key={key} type="button" onClick={() => toggleGroup(key)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition font-500 ${allowedGroups.includes(key)?'border-indigo-300 bg-indigo-50 text-indigo-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                style={{ fontWeight:500 }}>
                {allowedGroups.includes(key)&&<Check size={12} className="inline mr-1" />}{label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>Branşlar <span className="font-400" style={{fontWeight:400, color:'var(--text-secondary)'}}>(verebildiği dersler)</span></Label>
          <p className="text-caption mb-2">Öğretmenin girebileceği dersleri işaretleyin. Sadece işaretli dersler atanabilir.</p>
          <div className="flex gap-2 flex-wrap">
            {visibleBranches.map(b => (
              <button key={b} type="button" onClick={() => toggleBranch(b)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition font-500 ${branches.includes(b)?'border-violet-300 bg-violet-50 text-violet-700':'border-gray-200 text-gray-500 hover:border-gray-300'}`}
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

interface StudentFormProps {
  // Düzenlemede tam DTO, ön kayıt köprüsünde kısmi prefill (id'siz) gelir.
  initial?: Partial<StudentDTO> | null;
  classes?: ClassEntry[];
  onClose: () => void;
  onSave: (data: StudentFormPayload) => void | Promise<void>;
  onSwitchToImport?: () => void;
}

export function StudentForm({ initial, classes = [], onClose, onSave, onSwitchToImport }: StudentFormProps) {
  // Düzenleme/yeni ayrımı initial'ın VARLIĞI değil id'si: ön kayıttan gelen prefill
  // (ad + veli bilgisi, id yok) YENİ kayıt modunda açılır — alanlar dolu, kural yeni.
  const isEdit = !!initial?.id;
  const [name, setName] = useState(initial?.name||'');
  const [password, setPassword] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(initial?.group||'ortaokul');
  // Seçili grubun şubeleri registry'den (sabit-kod değil). Düzey/dal kurum tanımına göre.
  const groupClasses = useMemo(() => classesForGroup(classes, selectedGroup), [classes, selectedGroup]);
  const [cls, setCls] = useState(initial?.cls || '');
  const [phone, setPhone] = useState(initial?.phone ? formatTurkishMobile(initial.phone) : '');
  const [parentPhone, setParentPhone] = useState(initial?.parentPhone ? formatTurkishMobile(initial.parentPhone) : '');
  const [parentName, setParentName] = useState(initial?.parentName || '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate || '');
  const [diplomaNotu, setDiplomaNotu] = useState(initial?.diplomaNotu != null ? String(initial.diplomaNotu) : '');
  // Muhasebe belgeleri (senet/makbuz) için — opsiyonel, senet basmayan kurum boş bırakır.
  const [tcNo, setTcNo] = useState(initial?.tcNo || '');
  const [parentTcNo, setParentTcNo] = useState(initial?.parentTcNo || '');
  const [parentAddress, setParentAddress] = useState(initial?.parentAddress || '');
  const [loading, setLoading] = useState(false);
  // Yeni öğrenci: grup (ya da şube listesi) değişince ilk şubeyi seç. Düzenlemede cls korunur.
  useEffect(() => { if (!isEdit) setCls(groupClasses[0]?.id || ''); }, [selectedGroup, groupClasses, isEdit]);

  const phoneInvalid = phone.trim() !== '' && !isValidTurkishMobile(phone);
  const parentPhoneInvalid = parentPhone.trim() !== '' && !isValidTurkishMobile(parentPhone);
  // Veli zorunlu. Şifre boşsa öğrenci telefonu ilk şifre olur; telefon da yoksa "12345678".
  const parentMissing = !isEdit && (parentName.trim() === '' || parentPhone.trim() === '');

  // OBP (yalnız mezun): diploma notu 50-100 girilir, OBP = not × 5 (250-500).
  const isMezun = selectedGroup === 'mezun';
  const dnNum = parseFloat(diplomaNotu.replace(',', '.'));
  const diplomaInvalid = isMezun && diplomaNotu.trim() !== '' && (isNaN(dnNum) || dnNum < 50 || dnNum > 100);
  const obpPreview = isMezun && !isNaN(dnNum) && dnNum >= 50 && dnNum <= 100 ? dnNum * 5 : null;

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (phoneInvalid || parentPhoneInvalid || diplomaInvalid) return; // geçersiz veriyle gönderme
    if (parentMissing) return;
    if (!cls) { alert('Önce bir şube/sınıf seçin (Sınıflar sekmesinden şube ekleyebilirsiniz)'); return; }
    setLoading(true);
    await onSave({
      name, username: name, password, cls, phone, parentPhone, parentName, birthDate,
      diplomaNotu: isMezun ? diplomaNotu.trim() : '',
      tcNo: tcNo.trim(), parentTcNo: parentTcNo.trim(), parentAddress: parentAddress.trim(),
    });
    setLoading(false);
  };
  return (
    <Modal title={isEdit?'Öğrenci Düzenle':'Yeni Öğrenci'} onClose={onClose}>
      {!isEdit && onSwitchToImport && (
        <div className="mb-4 -mt-1 flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-brand-soft border border-brand-soft">
          <span className="text-xs text-brand">Toplu öğrenci yüklemek ister misin?</span>
          <button type="button" onClick={onSwitchToImport}
            className="text-xs font-600 text-brand flex items-center gap-1 shrink-0" style={{ fontWeight: 600 }}>
            <BookOpen size={12} /> Excel ile Yükle →
          </button>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Ad Soyad"><input className="input" value={name} onChange={e=>setName(e.target.value)} required /></FormField>
        <FormField label={isEdit?'Şifre (boş bırakırsan değişmez)':'Şifre (boş bırakırsan telefon)'}>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder={isEdit?'':'Boş = öğrenci telefonu (yoksa 12345678)'} />
          {!isEdit && <p className="text-caption mt-1">Boş bırakırsan ilk şifre öğrencinin telefonu olur; telefon da yoksa <b>12345678</b>. İlk girişte değiştirmesi istenir.</p>}
        </FormField>
        <FormField label="Grup">
          <select className="input" value={selectedGroup} onChange={e=>setSelectedGroup(e.target.value)} disabled={isEdit}>
            {Object.entries(GROUPS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </FormField>
        <FormField label="Sınıf">
          <select className="input" value={cls} onChange={e=>setCls(e.target.value)}>
            {groupClasses.length === 0
              ? <option value="">— bu grupta şube yok —</option>
              : groupClasses.map(c=><option key={c.id} value={c.id}>{c.ad}</option>)}
          </select>
        </FormField>
        {isMezun && (
          <FormField label="Diploma Notu">
            <input className={`input ${diplomaInvalid ? 'input-error' : ''}`} type="number" inputMode="decimal"
              min="50" max="100" step="0.01" placeholder="Örn. 82.50"
              value={diplomaNotu} onChange={e=>setDiplomaNotu(e.target.value)}
              aria-invalid={diplomaInvalid || undefined} />
            {diplomaInvalid
              ? <p className="input-hint input-hint--error">Diploma notu 50 ile 100 arasında olmalı.</p>
              : obpPreview != null
                ? <p className="text-caption mt-1">OBP (otomatik): <b style={{fontWeight:700}}>{obpPreview.toFixed(2)}</b> · Yerleştirmeye katkı ≈ {(obpPreview*0.12).toFixed(2)}</p>
                : <p className="text-caption mt-1">Diploma notu (50-100). OBP = not × 5 olarak hesaplanır. Boş bırakılabilir.</p>}
          </FormField>
        )}
        <FormField label="Öğrenci Telefonu">
          <input className={`input ${phoneInvalid ? 'input-error' : ''}`} type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={phone} onChange={e=>setPhone(e.target.value)} aria-invalid={phoneInvalid || undefined} />
          {phoneInvalid && <p className="input-hint input-hint--error">Geçersiz numara. Örnek: 0532 123 45 67</p>}
        </FormField>
        <FormField label="Öğrenci TC Kimlik No">
          <input className="input" inputMode="numeric" maxLength={11} placeholder="Muhasebe belgeleri için (opsiyonel)"
            value={tcNo} onChange={e=>setTcNo(e.target.value.replace(/\D/g,''))} />
        </FormField>
        <FormField label="Veli Adı Soyadı *">
          <input className="input" type="text" placeholder="Örn. Ayşe Yılmaz" value={parentName} onChange={e=>setParentName(e.target.value)} required={!isEdit} />
          {!isEdit && parentName.trim()==='' && <p className="text-xs text-gray-400 mt-1">Veli adı zorunlu.</p>}
        </FormField>
        <FormField label="Veli Telefonu *">
          <input className={`input ${parentPhoneInvalid ? 'input-error' : ''}`} type="tel" inputMode="tel" placeholder="05XX XXX XX XX" value={parentPhone} onChange={e=>setParentPhone(e.target.value)} required={!isEdit} aria-invalid={parentPhoneInvalid || undefined} />
          {parentPhoneInvalid
            ? <p className="input-hint input-hint--error">Geçersiz numara. Örnek: 0532 123 45 67</p>
            : (!isEdit && parentPhone.trim()==='' && <p className="input-hint">Veli telefonu zorunlu (veli paneli girişi bu numarayla).</p>)}
        </FormField>
        <FormField label="Veli TC Kimlik No">
          <input className="input" inputMode="numeric" maxLength={11} placeholder="Senet için (opsiyonel)"
            value={parentTcNo} onChange={e=>setParentTcNo(e.target.value.replace(/\D/g,''))} />
        </FormField>
        <FormField label="Veli Adresi">
          <textarea className="input" rows={2} placeholder="Senet için (opsiyonel)"
            value={parentAddress} onChange={e=>setParentAddress(e.target.value)} />
        </FormField>
        <FormField label="Doğum Tarihi">
          <input className="input" type="date" value={birthDate} onChange={e=>setBirthDate(e.target.value)}
            max={new Date().toISOString().split('T')[0]} />
        </FormField>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading || phoneInvalid || parentPhoneInvalid || parentMissing || diplomaInvalid}>{loading?'Kaydediliyor...':'Kaydet'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}

// POST /api/students/import yanıtı.
interface ImportResult {
  added: { name: string; cls: string; password: string }[];
  skipped: unknown[];
  errors: string[];
}

interface ImportModalProps {
  onClose: () => void;
  showToast: ShowToast;
  onDone: () => void;
}

export function ImportModal({ onClose, showToast, onDone }: ImportModalProps) {
  const { classes: registryClasses } = useClasses(); // s_ şube kimliği → kayıtlı ad (sonuç listesi)
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  // Başlık + örnek satırlı boş şablon indir — sütun sırası hatasını önler.
  const downloadTemplate = () => {
    const headers = ['Ad Soyad', 'Sınıf Kodu', 'Öğrenci Telefonu', 'Veli Telefonu', 'Veli Adı', 'Diploma Notu (yalnız mezun)', 'Öğrenci TC', 'Veli TC', 'Veli Adresi'];
    const ornek = ['Ahmet Yılmaz', '701', '05321234567', '05339876543', 'Ayşe Yılmaz', '', '12345678901', '10987654321', 'Örnek Mah. No:1 Akyazı/Sakarya'];
    const ws = XLSX.utils.aoa_to_sheet([headers, ornek]);
    ws['!cols'] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Öğrenciler');
    XLSX.writeFile(wb, 'ogrenci-yukleme-sablonu.xlsx');
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/students/import', { method: 'POST', body: fd });
      const data = (await res.json()) as ImportResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setResult(data);
      showToast(`${data.added.length} öğrenci eklendi`);
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Excel'den Öğrenci Yükle" onClose={onClose}>
      <p className="text-sm text-gray-500 mb-3">
        Excel sütunları sırayla: <strong>A</strong> ad soyad, <strong>B</strong> sınıf kodu (701, 802, 101…),
        <strong> C</strong> öğrenci telefonu, <strong>D</strong> veli telefonu, <strong>E</strong> veli adı,
        <strong> F</strong> diploma notu (yalnız mezun), <strong>G</strong> öğrenci TC, <strong>H</strong> veli TC,
        <strong> I</strong> veli adresi.
        <br /><span className="text-gray-400">A ve B zorunlu; diğerleri opsiyonel. İlk satır başlık olabilir — otomatik atlanır. TC ve adres senet/makbuz belgeleri içindir.</span>
      </p>
      <button type="button" onClick={downloadTemplate}
        className="text-xs font-600 text-brand flex items-center gap-1.5 mb-4"
        style={{ fontWeight: 600 }}>
        <Download size={13} /> Boş şablonu indir (.xlsx)
      </button>
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
                  <span className="font-500" style={{fontWeight:500}}>{s.name} <span className="text-gray-400">({classShortUpper(registryClasses, s.cls)})</span></span>
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
