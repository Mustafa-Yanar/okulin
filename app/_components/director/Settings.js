'use client';

// Müdür ayarlar modalı (isim + özelleştirme + ödeme) ve içindeki bölümler.
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Palette, Compass, Plus, Trash2, KeyRound, CreditCard, Settings as SettingsIcon, SlidersHorizontal, DoorOpen, Tag } from 'lucide-react';
import { api, Modal } from './shared';
import { brandGradient } from '@/lib/branding';
import { useConfirm } from '../ConfirmProvider';

// Ayarlar bölümlerinin ortak gövdesi — hem modal hem inline kullanır.
function SettingsBody({ current, onSave, onBranding, showToast }) {
  const [name, setName] = useState(current || '');
  const [savingName, setSavingName] = useState(false);

  const submitName = async e => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'update_director_name', name: name.trim() }) });
      onSave(name.trim());
      showToast('İsim güncellendi');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSavingName(false); }
  };

  return (
    <>
      <div className="mb-5 pb-5 border-b border-gray-100">
        <h4 className="text-label mb-2">Müdür Bilgisi</h4>
        <form onSubmit={submitName} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-label block mb-1">Ad Soyad</label>
            <input className="input" aria-label="Müdür ad soyad" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary !px-4 !py-2 text-sm" disabled={savingName}>
            {savingName ? 'Kaydediliyor…' : 'Güncelle'}
          </button>
        </form>
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <BrandingSection showToast={showToast} onBranding={onBranding} />
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <ConfigurationSection showToast={showToast} />
      </div>

      <PaymentSection showToast={showToast} />
    </>
  );
}

// Modal sürümü (artık kullanılmıyor ama API uyumu için duruyor).
export function DirectorSettingsModal({ current, onClose, onSave, onBranding, showToast }) {
  return (
    <Modal title="Ayarlar" onClose={onClose} wide>
      <SettingsBody current={current} onSave={onSave} onBranding={onBranding} showToast={showToast} />
    </Modal>
  );
}

// Inline sürümü — içerik alanında sekme olarak render edilir.
export function DirectorSettingsInline({ current, onSave, onBranding, showToast }) {
  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 15%, transparent)' }}>
          <SettingsIcon size={20} style={{ color: 'var(--brand,#6366f1)' }} />
        </div>
        <div>
          <h2 className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Ayarlar</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Kurum bilgisi, özelleştirme ve ödeme ayarları</p>
        </div>
      </div>
      <SettingsBody current={current} onSave={onSave} onBranding={onBranding} showToast={showToast} />
    </div>
  );
}

// ─── REHBER PERSONELİ ─────────────────────────────────────────────────────────
// Müdür rehber hesaplarını oluşturur/siler. Rehber = müdür yetkileri eksi muhasebe.
export function CounselorSection({ showToast }) {
  const confirm = useConfirm();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', password: '', phone: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try { const d = await api('/api/counselors'); setList(Array.isArray(d) ? d : []); }
    catch { /* sessiz */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add(e) {
    e.preventDefault();
    if (!form.name.trim()) { showToast('İsim gerekli', 'error'); return; }
    setSaving(true);
    try {
      await api('/api/counselors', { method: 'POST', body: JSON.stringify({ name: form.name.trim(), password: form.password, phone: form.phone }) });
      showToast('Rehber eklendi'); setForm({ name: '', password: '', phone: '' }); load();
    } catch (e) { showToast(e.message, 'error'); } finally { setSaving(false); }
  }
  async function remove(c) {
    if (!(await confirm(`"${c.name}" rehberi silinsin mi?`))) return;
    try { await api('/api/counselors', { method: 'DELETE', body: JSON.stringify({ id: c.id }) }); showToast('Rehber silindi'); load(); }
    catch (e) { showToast(e.message, 'error'); }
  }
  async function resetPw(c) {
    const pw = prompt(`${c.name} için yeni şifre (en az 6 karakter):`);
    if (!pw) return;
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'reset_password', targetRole: 'counselor', targetId: c.id, newPassword: pw }) });
      showToast('Şifre sıfırlandı — rehber ilk girişte değiştirecek');
    } catch (e) { showToast(e.message, 'error'); }
  }

  return (
    <div>
      <h4 className="text-label mb-1 flex items-center gap-1.5">
        <Compass size={13} /> Rehberlik Öğretmeni Ekle
      </h4>
      <p className="text-caption mb-3">Rehberlik öğretmeni, <b>muhasebe hariç</b> müdür yetkilerine sahiptir (program, öğrenci, deneme, optik, rehberlik).</p>

      <form onSubmit={add} className="flex gap-2 items-end mb-3 flex-wrap">
        <div className="flex-1 min-w-[120px]">
          <label className="text-label block mb-1">Ad Soyad</label>
          <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Örn: Ayşe Kaya" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="text-label block mb-1">Şifre <span className="font-400" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(opsiyonel)</span></label>
          <input className="input" type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="Boş = telefon (yoksa 12345678)" autoComplete="new-password" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <label className="text-label block mb-1">Telefon</label>
          <input className="input" type="tel" inputMode="tel" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="05XX XXX XX XX" />
        </div>
        <button type="submit" className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5" disabled={saving}>
          <Plus size={13} /> {saving ? 'Ekleniyor…' : 'Ekle'}
        </button>
      </form>

      {loading ? (
        <p className="text-caption">Yükleniyor…</p>
      ) : list.length === 0 ? (
        <p className="text-caption">Henüz rehber eklenmemiş.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map(c => (
            <div key={c.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-700 shrink-0"
                style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', fontWeight: 700 }}>
                {c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 text-sm font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{c.name}</span>
              <button onClick={() => resetPw(c)} title="Şifre sıfırla" className="btn-icon btn-icon-warning"><KeyRound size={14} /></button>
              <button onClick={() => remove(c)} title="Sil" className="btn-icon btn-icon-danger"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ONLİNE ÖDEME (PayTR) ───────────────────────────────────────────────────────
// Kurum kendi PayTR mağaza kimlik bilgilerini girer. Para %100 doğrudan kuruma gider.
// Gizli anahtarlar sunucuda ŞİFRELİ saklanır; burada yalnız "tanımlı mı" gösterilir.
function PaymentSection({ showToast }) {
  const [cfg, setCfg] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [merchantId, setMerchantId] = useState('');
  const [merchantKey, setMerchantKey] = useState('');
  const [merchantSalt, setMerchantSalt] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const d = await api('/api/payment/config');
      setCfg(d);
      setMerchantId(d.merchantId || '');
      setTestMode(d.testMode ?? true);
      setActive(!!d.active);
    } catch (e) { showToast(e.message, 'error'); }
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { merchantId: merchantId.trim(), testMode, active };
      if (merchantKey.trim()) body.merchantKey = merchantKey.trim();
      if (merchantSalt.trim()) body.merchantSalt = merchantSalt.trim();
      const r = await api('/api/payment/config', { method: 'POST', body: JSON.stringify(body) });
      setCfg(r.config);
      setMerchantKey(''); setMerchantSalt(''); // ekranda secret tutma
      showToast('Online ödeme ayarları kaydedildi');
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h4 className="text-label mb-1 flex items-center gap-1.5">
        <CreditCard size={13} className="text-emerald-600" /> Online Ödeme (PayTR)
      </h4>
      <p className="text-caption mb-3">
        Kurumun <b>kendi PayTR mağaza hesabını</b> bağlar — para doğrudan kuruma gider. Kimlik bilgileri PayTR panelinde <i>Destek &amp; Kurulum → Entegrasyon Bilgileri</i>'nde. Bildirim URL'ini panelde <code>{`${typeof window !== 'undefined' ? window.location.origin : ''}`}/api/payment/callback</code> olarak ayarlayın.
      </p>

      {!loaded ? (
        <div className="text-center py-4 text-caption">Yükleniyor...</div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <div>
            <label className="text-label block mb-1">Merchant ID</label>
            <input className="input" value={merchantId} onChange={e => setMerchantId(e.target.value)} placeholder="PayTR Mağaza No" />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-label block mb-1">
                Merchant Key {cfg?.hasKey && <span className="text-emerald-600 normal-case font-400">· kayıtlı</span>}
              </label>
              <input className="input" type="password" value={merchantKey} onChange={e => setMerchantKey(e.target.value)}
                placeholder={cfg?.hasKey ? '•••••• (değiştirmek için yaz)' : 'Merchant Key'} autoComplete="new-password" />
            </div>
            <div>
              <label className="text-label block mb-1">
                Merchant Salt {cfg?.hasSalt && <span className="text-emerald-600 normal-case font-400">· kayıtlı</span>}
              </label>
              <input className="input" type="password" value={merchantSalt} onChange={e => setMerchantSalt(e.target.value)}
                placeholder={cfg?.hasSalt ? '•••••• (değiştirmek için yaz)' : 'Merchant Salt'} autoComplete="new-password" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-body-sm cursor-pointer">
              <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} className="accent-emerald-600" />
              Test modu (gerçek tahsilat yapmaz)
            </label>
            <label className="flex items-center gap-2 text-body-sm cursor-pointer">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="accent-emerald-600" />
              Veli ödemesini aç
            </label>
          </div>
          {active && !testMode && (
            <p className="text-[11px] text-amber-600">Canlı mod açık — veliler gerçek kart ödemesi yapabilir.</p>
          )}
          <div className="flex justify-end">
            <button type="submit" className="btn-primary !px-4 !py-2 text-sm" disabled={saving}>
              {saving ? 'Kaydediliyor…' : 'Ödeme Ayarlarını Kaydet'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── KONFİGÜRASYON (oyun ayarları) ───────────────────────────────────────────────
// Modül aç/kapa + derslik (K2) yönetimi. Eksik config = varsayılan davranış (lib/config.js).
// Bir bölüm kapatılınca ilgili modül UI'dan gizlenir / API reddeder (entegrasyon ayrı iş).

const MODULE_META = {
  etut:     { label: 'Etüt Sistemi',      desc: 'Etüt rezervasyon ve takvim' },
  finance:  { label: 'Muhasebe / Finans',  desc: 'Ücret, taksit, gider takibi' },
  crm:      { label: 'Aday Öğrenci (CRM)',  desc: 'Ön kayıt hunisi' },
  lms:      { label: 'Kütüphane (LMS)',     desc: 'Kaynak/doküman paylaşımı' },
  duyuru:   { label: 'Duyurular',           desc: 'Rol/sınıf hedefli duyuru' },
  veli:     { label: 'Veli Paneli',         desc: 'Veli giriş ve takip' },
  deneme:   { label: 'Deneme / Optik',      desc: 'Sınav analizi ve puanlama' },
  davranis: { label: 'Davranış Puanlama',   desc: 'Öğrenci davranış kaydı' },
  odev:     { label: 'Ödev Takip',          desc: 'Ödev ver / teslim / kontrol' },
};

function ConfigurationSection({ showToast }) {
  const confirm = useConfirm();
  const [config, setConfig] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState(null);
  const [room, setRoom] = useState({ name: '', capacity: '' });
  const [newCat, setNewCat] = useState('');

  useEffect(() => {
    (async () => {
      try { setConfig(await api('/api/config')); }
      catch (e) { showToast(e.message, 'error'); }
      setLoaded(true);
    })();
  }, []);

  // Tek key'i kaydet (optimistik: önce state, sonra sunucu; hata olursa geri al).
  async function saveKey(key, value, prev) {
    setSavingKey(key);
    try {
      const r = await api('/api/config', { method: 'PATCH', body: JSON.stringify({ patch: { [key]: value } }) });
      setConfig(r);
    } catch (e) {
      showToast(e.message, 'error');
      if (prev !== undefined) setConfig(c => ({ ...c, [key]: prev })); // geri al
    } finally { setSavingKey(null); }
  }

  function toggleModule(mod) {
    const prevModules = config.modules;
    const nextModules = { ...prevModules, [mod]: !prevModules[mod] };
    setConfig(c => ({ ...c, modules: nextModules })); // optimistik
    saveKey('modules', nextModules, prevModules);
  }

  function addRoom(e) {
    e.preventDefault();
    const name = room.name.trim();
    if (!name) { showToast('Derslik adı gerekli', 'error'); return; }
    const cap = parseInt(room.capacity);
    const entry = { id: crypto.randomUUID(), name, capacity: Number.isFinite(cap) && cap > 0 ? cap : null };
    const prev = config.classrooms;
    const next = [...prev, entry];
    setConfig(c => ({ ...c, classrooms: next }));
    setRoom({ name: '', capacity: '' });
    saveKey('classrooms', next, prev);
  }

  async function removeRoom(r) {
    if (!(await confirm(`"${r.name}" dersliği silinsin mi?`))) return;
    const prev = config.classrooms;
    const next = prev.filter(x => x.id !== r.id);
    setConfig(c => ({ ...c, classrooms: next }));
    saveKey('classrooms', next, prev);
  }

  // Gider kategorileri — "Diğer" daima sonda, silinemez (sistem kategorisi).
  function withOtherLast(list) {
    const rest = list.filter(c => c !== 'Diğer');
    return [...rest, 'Diğer'];
  }
  function addCategory(e) {
    e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    const prev = config.expenseCategories;
    if (prev.some(c => c.toLowerCase() === name.toLowerCase())) { showToast('Bu kategori zaten var', 'error'); return; }
    const next = withOtherLast([...prev.filter(c => c !== 'Diğer'), name]);
    setConfig(c => ({ ...c, expenseCategories: next }));
    setNewCat('');
    saveKey('expenseCategories', next, prev);
  }
  async function removeCategory(cat) {
    if (cat === 'Diğer') return; // sistem kategorisi
    if (!(await confirm(`"${cat}" kategorisi silinsin mi? (Mevcut kayıtlar etkilenmez)`))) return;
    const prev = config.expenseCategories;
    const next = withOtherLast(prev.filter(c => c !== cat));
    setConfig(c => ({ ...c, expenseCategories: next }));
    saveKey('expenseCategories', next, prev);
  }

  return (
    <div>
      <h4 className="text-label mb-2 flex items-center gap-1.5">
        <SlidersHorizontal size={13} className="text-indigo-500" /> Konfigürasyon
      </h4>
      <p className="text-caption mb-3">Kuruma özel ayarlar — modülleri aç/kapat, derslikleri tanımla. Değişiklikler anında kaydedilir.</p>

      {!loaded || !config ? (
        <div className="text-center py-6 text-caption">Yükleniyor...</div>
      ) : (
        <div className="space-y-5">
          {/* ── Modül aç/kapa ── */}
          <div>
            <h5 className="text-label mb-2" style={{ fontSize: 11 }}>Aktif Modüller</h5>
            <div className="grid sm:grid-cols-2 gap-1.5">
              {Object.keys(MODULE_META).map(mod => {
                const m = MODULE_META[mod];
                const on = !!config.modules?.[mod];
                return (
                  <label key={mod}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer border transition-colors"
                    style={{
                      background: on ? 'color-mix(in srgb, var(--brand,#6366f1) 8%, transparent)' : 'var(--surface-2, #f9fafb)',
                      borderColor: on ? 'color-mix(in srgb, var(--brand,#6366f1) 30%, transparent)' : 'transparent',
                      opacity: savingKey === 'modules' ? 0.6 : 1,
                    }}>
                    <input type="checkbox" checked={on} disabled={savingKey === 'modules'}
                      onChange={() => toggleModule(mod)} className="accent-indigo-600 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{m.label}</span>
                      <span className="block text-caption truncate">{m.desc}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── Derslikler (K2) ── */}
          <div>
            <h5 className="text-label mb-1 flex items-center gap-1.5" style={{ fontSize: 11 }}>
              <DoorOpen size={12} /> Derslikler
            </h5>
            <p className="text-caption mb-2">Fiziksel oda/derslik tanımları. Boş bırakılırsa oda kısıtı uygulanmaz.</p>
            <form onSubmit={addRoom} className="flex gap-2 items-end mb-2 flex-wrap">
              <div className="flex-1 min-w-[140px]">
                <label className="text-label block mb-1">Derslik Adı</label>
                <input className="input" value={room.name} onChange={e => setRoom(r => ({ ...r, name: e.target.value }))} placeholder="Örn: A-101, Fizik Lab" />
              </div>
              <div className="w-28">
                <label className="text-label block mb-1">Kapasite</label>
                <input className="input" type="number" min="1" inputMode="numeric" value={room.capacity}
                  onChange={e => setRoom(r => ({ ...r, capacity: e.target.value }))} placeholder="ops." />
              </div>
              <button type="submit" className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5" disabled={savingKey === 'classrooms'}>
                <Plus size={13} /> Ekle
              </button>
            </form>
            {(!config.classrooms || config.classrooms.length === 0) ? (
              <p className="text-caption">Henüz derslik eklenmemiş.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {config.classrooms.map(r => (
                  <div key={r.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <DoorOpen size={15} className="text-gray-400 shrink-0" />
                    <span className="flex-1 text-sm font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.name}</span>
                    {r.capacity ? <span className="text-caption shrink-0">{r.capacity} kişi</span> : null}
                    <button onClick={() => removeRoom(r)} title="Sil" className="btn-icon btn-icon-danger"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Gider Kategorileri ── */}
          <div>
            <h5 className="text-label mb-1 flex items-center gap-1.5" style={{ fontSize: 11 }}>
              <Tag size={12} /> Gider Kategorileri
            </h5>
            <p className="text-caption mb-2">Muhasebe gider formundaki kategoriler. "Diğer" sabittir.</p>
            <form onSubmit={addCategory} className="flex gap-2 items-end mb-2">
              <div className="flex-1">
                <label className="text-label block mb-1">Yeni Kategori</label>
                <input className="input" value={newCat} onChange={e => setNewCat(e.target.value)} placeholder="Örn: Servis, Yurt/Konaklama" />
              </div>
              <button type="submit" className="btn-primary !px-4 !py-2 text-sm flex items-center gap-1.5" disabled={savingKey === 'expenseCategories'}>
                <Plus size={13} /> Ekle
              </button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              {(config.expenseCategories || []).map(cat => (
                <span key={cat} className="inline-flex items-center gap-1.5 bg-gray-50 rounded-lg pl-3 pr-2 py-1.5 text-sm"
                  style={{ color: 'var(--text-primary)' }}>
                  {cat}
                  {cat !== 'Diğer' && (
                    <button onClick={() => removeCategory(cat)} title="Sil"
                      className="text-gray-400 hover:text-red-500 transition-colors" disabled={savingKey === 'expenseCategories'}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KURUM MARKASI ──────────────────────────────────────────────────────────────
function BrandingSection({ showToast, onBranding }) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#6366f1');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { branding } = await api('/api/org');
        setName(branding.name || '');
        setShortName(branding.shortName === branding.name ? '' : (branding.shortName || ''));
        setLogoUrl(branding.logoUrl || '');
        setThemeColor(branding.themeColor || '#6366f1');
      } catch (e) { showToast(e.message, 'error'); }
      setLoaded(true);
    })();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!name.trim()) { showToast('Kurum adı boş olamaz', 'error'); return; }
    setSaving(true);
    try {
      const res = await api('/api/org', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), shortName: shortName.trim(), logoUrl: logoUrl.trim(), themeColor }),
      });
      showToast('Kurum markası güncellendi');
      if (onBranding && res.branding) onBranding(res.branding);
    } catch (err) { showToast(err.message, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h4 className="text-label mb-2 flex items-center gap-1.5">
        <Palette size={13} className="text-indigo-500" /> Özelleştirme
      </h4>
      {!loaded ? (
        <div className="text-center py-6 text-caption">Yükleniyor...</div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-label block mb-1">Kurum Adı</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Akyazı Çözüm" required />
            </div>
            <div>
              <label className="text-label block mb-1">Kısa Ad (sekme/PWA)</label>
              <input className="input" value={shortName} onChange={e => setShortName(e.target.value)} placeholder="(boşsa kurum adı kullanılır)" />
            </div>
          </div>
          <div>
            <label className="text-label block mb-1">Logo Adresi</label>
            <input className="input" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="/logo.png veya https://..." />
            <p className="text-caption mt-1">Boş bırakılırsa marka ikonu (renkli simge) gösterilir.</p>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <label className="text-label block mb-1">Tema Rengi</label>
              <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
                className="h-9 w-14 rounded border border-gray-200 bg-white cursor-pointer" aria-label="Tema rengi" />
            </div>
            <div className="flex items-center gap-2 mt-4">
              <span className="text-caption">Önizleme:</span>
              {logoUrl.trim() ? (
                <img src={logoUrl} alt="" className="h-9 w-auto object-contain" onError={e => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className="h-9 w-9 rounded-xl" style={{ background: brandGradient(themeColor) }} />
              )}
              <span className="font-800 text-sm" style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{name || 'Kurum'}</span>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary !px-4 !py-2 text-sm" disabled={saving}>
              {saving ? 'Kaydediliyor…' : 'Markayı Kaydet'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── BİLDİRİM TESTİ ─────────────────────────────────────────────────────────────
function PushTestSection({ showToast }) {
  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    setSending(true);
    try {
      const r = await api('/api/push', { method: 'POST', body: JSON.stringify({ action: 'test' }) });
      if (r.sent > 0) showToast(`Test bildirimi gönderildi (${r.sent} cihaz)`);
      else showToast('Kayıtlı cihaz yok — önce üstteki zil simgesinden bildirimleri aç', 'info');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSending(false); }
  };

  return (
    <div>
      <h4 className="text-label mb-2">Bildirim Testi</h4>
      <p className="text-body-sm mb-2">Üstteki zil simgesinden bildirimleri açtıktan sonra kendine test bildirimi gönder.</p>
      <button onClick={sendTest} disabled={sending} className="btn-ghost !px-4 !py-2 text-sm">
        {sending ? 'Gönderiliyor…' : 'Kendime test bildirimi gönder'}
      </button>
    </div>
  );
}

// ─── HATA KAYITLARI (ERROR LOG) ─────────────────────────────────────────────────
function ErrorLogSection({ showToast }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const SOURCE_LABELS = {
    window: { label: 'Tarayıcı', color: '#dc2626' },
    unhandledrejection: { label: 'Promise', color: '#ea580c' },
    react: { label: 'Arayüz', color: '#7c3aed' },
    manual: { label: 'Bildirilen', color: '#6b7280' },
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/log');
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) { showToast(e.message, 'error'); setEntries([]); }
    finally { setLoading(false); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && entries === null) load();
  };

  const fmtTime = (iso) => {
    try {
      const d = new Date(iso);
      const tr = new Date(d.getTime() + 3 * 60 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(tr.getUTCDate())}.${pad(tr.getUTCMonth() + 1)}.${tr.getUTCFullYear()} ${pad(tr.getUTCHours())}:${pad(tr.getUTCMinutes())}`;
    } catch { return iso; }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-label flex items-center gap-1.5">
          <AlertTriangle size={13} className="text-amber-500" /> Hata Kayıtları
        </h4>
        <div className="flex items-center gap-2">
          {open && entries && (
            <button onClick={load} className="btn-ghost !px-2.5 !py-1.5 text-xs" title="Yenile">Yenile</button>
          )}
          <button onClick={toggle} className="btn-ghost !px-3 !py-1.5 text-xs">
            {open ? 'Gizle' : 'Göster'}
          </button>
        </div>
      </div>
      {open && (
        <div className="mt-3">
          {loading ? (
            <div className="text-center py-6 text-caption">Yükleniyor...</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-6 text-sm" style={{ color: 'var(--color-success)' }}>Hata kaydı yok — her şey yolunda.</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {entries.map((e, i) => {
                const meta = SOURCE_LABELS[e.source] || SOURCE_LABELS.manual;
                const isOpen = expanded === i;
                return (
                  <div key={i} className="px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                    <button className="flex items-start gap-2 w-full text-left" onClick={() => setExpanded(isOpen ? null : i)}>
                      <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded font-700 mt-0.5" style={{ background: meta.color + '22', color: meta.color, fontWeight: 700 }}>{meta.label}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs break-words" style={{ color: 'var(--text-primary)' }}>{e.message}</div>
                        <div className="text-caption mt-0.5">
                          {fmtTime(e.ts)}
                          {e.userName ? ` · ${e.userName} (${e.role || '?'})` : ' · anonim'}
                          {e.url ? ` · ${e.url}` : ''}
                        </div>
                      </div>
                    </button>
                    {isOpen && (e.stack || e.componentStack) && (
                      <pre className="mt-2 text-[10px] text-gray-500 bg-white border border-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words max-h-48">
{e.stack || ''}{e.componentStack ? `\n--- Bileşen ---${e.componentStack}` : ''}
                      </pre>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-caption mt-2">Son 500 hata · kayıtlar 30 gün saklanır · satıra tıkla → ayrıntı</p>
        </div>
      )}
    </div>
  );
}
