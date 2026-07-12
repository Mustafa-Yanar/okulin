'use client';

// Müdür ayarlar modalı (isim + özelleştirme + ödeme) ve içindeki bölümler.
import React, { useState, useEffect } from 'react';
import { AlertTriangle, Palette, Compass, Plus, Trash2, KeyRound, CreditCard, Settings as SettingsIcon, SlidersHorizontal, Tag, CalendarClock, ShieldCheck } from 'lucide-react';
import { api, Modal } from './shared';
import { brandGradient, type Branding } from '@/lib/branding';
import { useConfirm } from '../ConfirmProvider';
import type { ShowToast } from '../types';

// /api/config yanıtının bu ekranda düzenlenen görünümü — lib/config CONFIG_DEFAULTS
// ile aynı şekil, ancak dinamik anahtar erişimi (toggleModule/togglePermission) için
// Record biçiminde gevşetildi (JSON üzerinden geldiği için literal tipler zaten kaybolur).
interface OrgConfigView {
  modules: Record<string, boolean>;
  etut: { studentSelfBooking?: boolean; cancelLockHours?: number; maxWeeklyPerStudent?: number };
  permissions: Record<string, Record<string, boolean | undefined> | undefined>;
  expenseCategories: string[];
  [key: string]: unknown;
}

interface SettingsBodyProps {
  current?: string;
  onSave: (name: string) => void;
  onBranding?: (b: Branding) => void;
  showToast: ShowToast;
}

// Ayarlar bölümlerinin ortak gövdesi — hem modal hem inline kullanır.
function SettingsBody({ current, onSave, onBranding, showToast }: SettingsBodyProps) {
  const [name, setName] = useState(current || '');
  const [savingName, setSavingName] = useState(false);

  const submitName = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSavingName(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'update_director_name', name: name.trim() }) });
      onSave(name.trim());
      showToast('İsim güncellendi');
    } catch (err) { showToast((err as Error).message, 'error'); }
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

interface DirectorSettingsProps extends SettingsBodyProps {
  onClose?: () => void;
}

// Modal sürümü (artık kullanılmıyor ama API uyumu için duruyor).
export function DirectorSettingsModal({ current, onClose, onSave, onBranding, showToast }: DirectorSettingsProps) {
  return (
    <Modal title="Ayarlar" onClose={onClose ?? (() => {})} wide>
      <SettingsBody current={current} onSave={onSave} onBranding={onBranding} showToast={showToast} />
    </Modal>
  );
}

// Inline sürümü — içerik alanında sekme olarak render edilir.
export function DirectorSettingsInline({ current, onSave, onBranding, showToast }: SettingsBodyProps) {
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

// Rehber/müdür yardımcısı liste elemanı.
interface StaffAccountDTO {
  id: string;
  name: string;
}

// ─── REHBER PERSONELİ ─────────────────────────────────────────────────────────
// Müdür rehber hesaplarını oluşturur/siler. Rehber = müdür yetkileri eksi muhasebe.
export function CounselorSection({ showToast }: { showToast: ShowToast }) {
  const confirm = useConfirm();
  const [list, setList] = useState<StaffAccountDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', password: '', phone: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try { const d = await api<StaffAccountDTO[]>('/api/counselors'); setList(Array.isArray(d) ? d : []); }
    catch { /* sessiz */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name.trim()) { showToast('İsim gerekli', 'error'); return; }
    setSaving(true);
    try {
      await api('/api/counselors', { method: 'POST', body: JSON.stringify({ name: form.name.trim(), password: form.password, phone: form.phone }) });
      showToast('Rehber eklendi'); setForm({ name: '', password: '', phone: '' }); load();
    } catch (e) { showToast((e as Error).message, 'error'); } finally { setSaving(false); }
  }
  async function remove(c: StaffAccountDTO) {
    if (!(await confirm(`"${c.name}" rehberi silinsin mi?`))) return;
    try { await api('/api/counselors', { method: 'DELETE', body: JSON.stringify({ id: c.id }) }); showToast('Rehber silindi'); load(); }
    catch (e) { showToast((e as Error).message, 'error'); }
  }
  async function resetPw(c: StaffAccountDTO) {
    const pw = prompt(`${c.name} için yeni şifre (en az 6 karakter):`);
    if (!pw) return;
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'reset_password', targetRole: 'counselor', targetId: c.id, newPassword: pw }) });
      showToast('Şifre sıfırlandı — rehber ilk girişte değiştirecek');
    } catch (e) { showToast((e as Error).message, 'error'); }
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

// ─── MÜDÜR YARDIMCISI ─────────────────────────────────────────────────────────
// Müdür, müdür yardımcısı hesapları oluşturur/siler. Müdür yardımcısı = müdürle
// BİREBİR aynı yetki (oturumda role='director'). CounselorSection deseninin eşi.
export function AssistantDirectorSection({ showToast }: { showToast: ShowToast }) {
  const confirm = useConfirm();
  const [list, setList] = useState<StaffAccountDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: '', password: '', phone: '' });
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    try { const d = await api<StaffAccountDTO[]>('/api/assistant-directors'); setList(Array.isArray(d) ? d : []); }
    catch { /* sessiz */ } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name.trim()) { showToast('İsim gerekli', 'error'); return; }
    setSaving(true);
    try {
      await api('/api/assistant-directors', { method: 'POST', body: JSON.stringify({ name: form.name.trim(), password: form.password, phone: form.phone }) });
      showToast('Müdür yardımcısı eklendi'); setForm({ name: '', password: '', phone: '' }); load();
    } catch (e) { showToast((e as Error).message, 'error'); } finally { setSaving(false); }
  }
  async function remove(a: StaffAccountDTO) {
    if (!(await confirm(`"${a.name}" müdür yardımcısı silinsin mi?`))) return;
    try { await api('/api/assistant-directors', { method: 'DELETE', body: JSON.stringify({ id: a.id }) }); showToast('Müdür yardımcısı silindi'); load(); }
    catch (e) { showToast((e as Error).message, 'error'); }
  }
  async function resetPw(a: StaffAccountDTO) {
    const pw = prompt(`${a.name} için yeni şifre (en az 6 karakter):`);
    if (!pw) return;
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'reset_password', targetRole: 'assistant_director', targetId: a.id, newPassword: pw }) });
      showToast('Şifre sıfırlandı — müdür yardımcısı ilk girişte değiştirecek');
    } catch (e) { showToast((e as Error).message, 'error'); }
  }

  return (
    <div>
      <h4 className="text-label mb-1 flex items-center gap-1.5">
        <ShieldCheck size={13} /> Müdür Yardımcısı Ekle
      </h4>
      <p className="text-caption mb-3">Müdür yardımcısı, <b>müdürle birebir aynı</b> yetkilere sahiptir (tüm yönetim, finans dahil).</p>

      <form onSubmit={add} className="flex gap-2 items-end mb-3 flex-wrap">
        <div className="flex-1 min-w-[120px]">
          <label className="text-label block mb-1">Ad Soyad</label>
          <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Örn: Mehmet Demir" />
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
        <p className="text-caption">Henüz müdür yardımcısı eklenmemiş.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {list.map(a => (
            <div key={a.id} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
              <span className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-700 shrink-0"
                style={{ background: 'linear-gradient(135deg,#0ea5e9,#0369a1)', fontWeight: 700 }}>
                {a.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
              </span>
              <span className="flex-1 text-sm font-600 truncate" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{a.name}</span>
              <button onClick={() => resetPw(a)} title="Şifre sıfırla" className="btn-icon btn-icon-warning"><KeyRound size={14} /></button>
              <button onClick={() => remove(a)} title="Sil" className="btn-icon btn-icon-danger"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// GET /api/payment/config yanıtı (gizli anahtarlar yalnız 'tanımlı mı' bayrağı olarak).
interface PaymentConfigDTO {
  merchantId?: string;
  testMode?: boolean;
  active?: boolean;
  hasKey?: boolean;
  hasSalt?: boolean;
}

// ─── ONLİNE ÖDEME (PayTR) ───────────────────────────────────────────────────────
// Kurum kendi PayTR mağaza kimlik bilgilerini girer. Para %100 doğrudan kuruma gider.
// Gizli anahtarlar sunucuda ŞİFRELİ saklanır; burada yalnız "tanımlı mı" gösterilir.
function PaymentSection({ showToast }: { showToast: ShowToast }) {
  const [cfg, setCfg] = useState<PaymentConfigDTO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [merchantId, setMerchantId] = useState('');
  const [merchantKey, setMerchantKey] = useState('');
  const [merchantSalt, setMerchantSalt] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [active, setActive] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const d = await api<PaymentConfigDTO>('/api/payment/config');
      setCfg(d);
      setMerchantId(d.merchantId || '');
      setTestMode(d.testMode ?? true);
      setActive(!!d.active);
    } catch (e) { showToast((e as Error).message, 'error'); }
    setLoaded(true);
  };
  useEffect(() => { load(); }, []);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = { merchantId: merchantId.trim(), testMode, active };
      if (merchantKey.trim()) body.merchantKey = merchantKey.trim();
      if (merchantSalt.trim()) body.merchantSalt = merchantSalt.trim();
      const r = await api<{ config: PaymentConfigDTO }>('/api/payment/config', { method: 'POST', body: JSON.stringify(body) });
      setCfg(r.config);
      setMerchantKey(''); setMerchantSalt(''); // ekranda secret tutma
      showToast('Online ödeme ayarları kaydedildi');
    } catch (err) { showToast((err as Error).message, 'error'); }
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

const MODULE_META: Record<string, { label: string; desc: string }> = {
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

function ConfigurationSection({ showToast }: { showToast: ShowToast }) {
  const confirm = useConfirm();
  const [config, setConfig] = useState<OrgConfigView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newCat, setNewCat] = useState('');

  useEffect(() => {
    (async () => {
      try { setConfig(await api<OrgConfigView>('/api/config')); }
      catch (e) { showToast((e as Error).message, 'error'); }
      setLoaded(true);
    })();
  }, []);

  // Tek key'i kaydet (optimistik: önce state, sonra sunucu; hata olursa geri al).
  async function saveKey(key: string, value: unknown, prev?: unknown) {
    setSavingKey(key);
    try {
      const r = await api<OrgConfigView>('/api/config', { method: 'PATCH', body: JSON.stringify({ patch: { [key]: value } }) });
      setConfig(r);
    } catch (e) {
      showToast((e as Error).message, 'error');
      if (prev !== undefined) setConfig(c => (c ? { ...c, [key]: prev } : c)); // geri al
    } finally { setSavingKey(null); }
  }

  function toggleModule(mod: string) {
    const prevModules = config!.modules;
    const nextModules = { ...prevModules, [mod]: !prevModules[mod] };
    setConfig(c => (c ? { ...c, modules: nextModules } : c)); // optimistik
    saveKey('modules', nextModules, prevModules);
  }

  // Etüt kuralı bayrağını aç/kapa (örn. studentSelfBooking).
  function toggleEtut(flag: 'studentSelfBooking') {
    const prev = config!.etut;
    const next = { ...prev, [flag]: !prev[flag] };
    setConfig(c => (c ? { ...c, etut: next } : c));
    saveKey('etut', next, prev);
  }

  // Etüt sayısal kuralı kaydet (cancelLockHours, maxWeeklyPerStudent). Negatif→0.
  function setEtutNum(flag: 'cancelLockHours' | 'maxWeeklyPerStudent', raw: string) {
    const val = Math.max(0, parseInt(raw) || 0);
    const prev = config!.etut;
    if ((prev?.[flag] || 0) === val) return; // değişmediyse PATCH atma
    const next = { ...prev, [flag]: val };
    setConfig(c => (c ? { ...c, etut: next } : c));
    saveKey('etut', next, prev);
  }

  // Rol yetki bayrağını aç/kapa (permissions.<role>.<flag>). current: bayrağın
  // EKRANDA görünen değeri — varsayılanı true olan bayraklarda (accountant.intake)
  // "değer hiç yazılmamış" durumunda !undefined yanlış yöne çevirirdi.
  function togglePermission(role: string, flag: string, current?: boolean) {
    const prev = config!.permissions;
    const cur = current !== undefined ? current : !!prev?.[role]?.[flag];
    const next = { ...prev, [role]: { ...(prev?.[role] || {}), [flag]: !cur } };
    setConfig(c => (c ? { ...c, permissions: next } : c));
    saveKey('permissions', next, prev);
  }

  // Gider kategorileri — "Diğer" daima sonda, silinemez (sistem kategorisi).
  function withOtherLast(list: string[]): string[] {
    const rest = list.filter(c => c !== 'Diğer');
    return [...rest, 'Diğer'];
  }
  function addCategory(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = newCat.trim();
    if (!name) return;
    const prev = config!.expenseCategories;
    if (prev.some(c => c.toLowerCase() === name.toLowerCase())) { showToast('Bu kategori zaten var', 'error'); return; }
    const next = withOtherLast([...prev.filter(c => c !== 'Diğer'), name]);
    setConfig(c => (c ? { ...c, expenseCategories: next } : c));
    setNewCat('');
    saveKey('expenseCategories', next, prev);
  }
  async function removeCategory(cat: string) {
    if (cat === 'Diğer') return; // sistem kategorisi
    if (!(await confirm(`"${cat}" kategorisi silinsin mi? (Mevcut kayıtlar etkilenmez)`))) return;
    const prev = config!.expenseCategories;
    const next = withOtherLast(prev.filter(c => c !== cat));
    setConfig(c => (c ? { ...c, expenseCategories: next } : c));
    saveKey('expenseCategories', next, prev);
  }

  return (
    <div>
      <h4 className="text-label mb-2 flex items-center gap-1.5">
        <SlidersHorizontal size={13} className="text-indigo-500" /> Konfigürasyon
      </h4>
      <p className="text-caption mb-3">Kuruma özel ayarlar — modülleri aç/kapat. Değişiklikler anında kaydedilir.</p>

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

          {/* ── Etüt Kuralları ── */}
          <div>
            <h5 className="text-label mb-2 flex items-center gap-1.5" style={{ fontSize: 11 }}>
              <CalendarClock size={12} /> Etüt Kuralları
            </h5>
            <label className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer border transition-colors"
              style={{
                background: config.etut?.studentSelfBooking !== false ? 'color-mix(in srgb, var(--brand,#6366f1) 8%, transparent)' : 'var(--surface-2, #f9fafb)',
                borderColor: config.etut?.studentSelfBooking !== false ? 'color-mix(in srgb, var(--brand,#6366f1) 30%, transparent)' : 'transparent',
                opacity: savingKey === 'etut' ? 0.6 : 1,
              }}>
              <input type="checkbox" checked={config.etut?.studentSelfBooking !== false} disabled={savingKey === 'etut'}
                onChange={() => toggleEtut('studentSelfBooking')} className="accent-indigo-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Öğrenci kendi etüdünü seçebilir</span>
                <span className="block text-caption">Kapalıyken etütleri yalnız müdür/rehber/öğretmen dağıtır</span>
              </span>
            </label>

            {/* Sayısal kurallar — yalnız öğrenci self-rezervasyonuna uygulanır */}
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <div>
                <label className="text-label block mb-1">İptal kilidi (saat)</label>
                <input className="input" type="number" min="0" inputMode="numeric"
                  defaultValue={config.etut?.cancelLockHours || 0}
                  key={`clh-${config.etut?.cancelLockHours || 0}`}
                  onBlur={e => setEtutNum('cancelLockHours', e.target.value)} />
                <p className="text-caption mt-1">Etüde bu kadar saat kala öğrenci iptal edemez. 0 = serbest.</p>
              </div>
              <div>
                <label className="text-label block mb-1">Haftalık max etüt</label>
                <input className="input" type="number" min="0" inputMode="numeric"
                  defaultValue={config.etut?.maxWeeklyPerStudent || 0}
                  key={`mw-${config.etut?.maxWeeklyPerStudent || 0}`}
                  onBlur={e => setEtutNum('maxWeeklyPerStudent', e.target.value)} />
                <p className="text-caption mt-1">Öğrenci haftada en fazla bu kadar etüt alır. 0 = sınırsız.</p>
              </div>
            </div>
          </div>

          {/* ── Rol / Yetki ── */}
          <div>
            <h5 className="text-label mb-2 flex items-center gap-1.5" style={{ fontSize: 11 }}>
              <Compass size={12} /> Rol / Yetki
            </h5>
            <label className="flex items-center gap-2.5 rounded-lg px-3 py-2 cursor-pointer border transition-colors"
              style={{
                background: config.permissions?.counselor?.readOnly ? 'color-mix(in srgb, var(--brand,#6366f1) 8%, transparent)' : 'var(--surface-2, #f9fafb)',
                borderColor: config.permissions?.counselor?.readOnly ? 'color-mix(in srgb, var(--brand,#6366f1) 30%, transparent)' : 'transparent',
                opacity: savingKey === 'permissions' ? 0.6 : 1,
              }}>
              <input type="checkbox" checked={!!config.permissions?.counselor?.readOnly} disabled={savingKey === 'permissions'}
                onChange={() => togglePermission('counselor', 'readOnly')} className="accent-indigo-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Rehber salt-okunur</span>
                <span className="block text-caption">Açıkken rehber öğrenci/öğretmen/program/sınıf yönetimi yapamaz — yalnız görüntüler. Rehberlik notu, deneme, davranış, ödev, duyuru, takvim açık kalır.</span>
              </span>
            </label>
            <label className="flex items-center gap-2.5 rounded-lg px-3 py-2 mt-2 cursor-pointer border transition-colors"
              style={{
                background: config.permissions?.accountant?.intake !== false ? 'color-mix(in srgb, var(--brand,#6366f1) 8%, transparent)' : 'var(--surface-2, #f9fafb)',
                borderColor: config.permissions?.accountant?.intake !== false ? 'color-mix(in srgb, var(--brand,#6366f1) 30%, transparent)' : 'transparent',
                opacity: savingKey === 'permissions' ? 0.6 : 1,
              }}>
              <input type="checkbox" checked={config.permissions?.accountant?.intake !== false} disabled={savingKey === 'permissions'}
                onChange={() => togglePermission('accountant', 'intake', config.permissions?.accountant?.intake !== false)} className="accent-indigo-600 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>Muhasebeci kayıt yapabilir</span>
                <span className="block text-caption">Açıkken muhasebeci ön kayıt (aday takibi) ve öğrenci ekleme/düzenleme yapabilir — veliyi kayıt masasında tek başına karşılar. Öğrenci silme her durumda kapalıdır. Kapatınca muhasebecide yalnız finans ekranları kalır.</span>
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── KURUM MARKASI ──────────────────────────────────────────────────────────────
function BrandingSection({ showToast, onBranding }: { showToast: ShowToast; onBranding?: (b: Branding) => void }) {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [themeColor, setThemeColor] = useState('#6366f1');
  // Kurum resmi bilgisi (muhasebe belgeleri: senet/makbuz)
  const [officialName, setOfficialName] = useState('');
  const [taxOffice, setTaxOffice] = useState('');
  const [taxNo, setTaxNo] = useState('');
  const [officialAddress, setOfficialAddress] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        interface LegalInfo { officialName: string; taxOffice: string; taxNo: string; officialAddress: string }
        const { branding, legal } = await api<{ branding: Branding; legal?: LegalInfo }>('/api/org');
        setName(branding.name || '');
        setShortName(branding.shortName === branding.name ? '' : (branding.shortName || ''));
        setLogoUrl(branding.logoUrl || '');
        setThemeColor(branding.themeColor || '#6366f1');
        setOfficialName(legal?.officialName || '');
        setTaxOffice(legal?.taxOffice || '');
        setTaxNo(legal?.taxNo || '');
        setOfficialAddress(legal?.officialAddress || '');
      } catch (e) { showToast((e as Error).message, 'error'); }
      setLoaded(true);
    })();
  }, []);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) { showToast('Kurum adı boş olamaz', 'error'); return; }
    setSaving(true);
    try {
      const res = await api<{ branding?: Branding }>('/api/org', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), shortName: shortName.trim(), logoUrl: logoUrl.trim(), themeColor,
          officialName: officialName.trim(), taxOffice: taxOffice.trim(), taxNo: taxNo.trim(), officialAddress: officialAddress.trim(),
        }),
      });
      showToast('Kurum bilgileri güncellendi');
      if (onBranding && res.branding) onBranding(res.branding);
    } catch (err) { showToast((err as Error).message, 'error'); }
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
          <div className="pt-3 mt-1 border-t border-gray-100">
            <p className="text-label mb-1">Resmi Bilgiler <span className="text-caption" style={{ fontWeight: 400 }}>— senet / tahsilat makbuzu için (opsiyonel)</span></p>
            <p className="text-caption mb-2">Bu bilgiler basılan senet ve makbuzlarda kurumun resmi kimliği olarak görünür.</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-label block mb-1">Resmi Ünvan</label>
                <input className="input" value={officialName} onChange={e => setOfficialName(e.target.value)} placeholder="… Özel Öğretim Kursu Ltd. Şti." />
              </div>
              <div>
                <label className="text-label block mb-1">Vergi Dairesi</label>
                <input className="input" value={taxOffice} onChange={e => setTaxOffice(e.target.value)} placeholder="Örn. Akyazı" />
              </div>
              <div>
                <label className="text-label block mb-1">Vergi No</label>
                <input className="input" inputMode="numeric" value={taxNo} onChange={e => setTaxNo(e.target.value.replace(/\D/g, ''))} placeholder="10 haneli" />
              </div>
              <div>
                <label className="text-label block mb-1">Resmi Adres</label>
                <input className="input" value={officialAddress} onChange={e => setOfficialAddress(e.target.value)} placeholder="Kurum resmi adresi" />
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary !px-4 !py-2 text-sm" disabled={saving}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ─── BİLDİRİM TESTİ ─────────────────────────────────────────────────────────────
function PushTestSection({ showToast }: { showToast: ShowToast }) {
  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    setSending(true);
    try {
      const r = await api<{ sent: number }>('/api/push', { method: 'POST', body: JSON.stringify({ action: 'test' }) });
      if (r.sent > 0) showToast(`Test bildirimi gönderildi (${r.sent} cihaz)`);
      else showToast('Kayıtlı cihaz yok — önce üstteki zil simgesinden bildirimleri aç', 'info');
    } catch (e) { showToast((e as Error).message, 'error'); }
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

// GET /api/log hata kaydı satırı.
interface ErrorLogEntry {
  ts: string;
  source?: string;
  message?: string;
  stack?: string;
  componentStack?: string;
  userName?: string;
  role?: string;
  url?: string;
}

// ─── HATA KAYITLARI (ERROR LOG) ─────────────────────────────────────────────────
function ErrorLogSection({ showToast }: { showToast: ShowToast }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<ErrorLogEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const SOURCE_LABELS: Record<string, { label: string; color: string }> = {
    window: { label: 'Tarayıcı', color: '#dc2626' },
    unhandledrejection: { label: 'Promise', color: '#ea580c' },
    react: { label: 'Arayüz', color: '#7c3aed' },
    manual: { label: 'Bildirilen', color: '#6b7280' },
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api<ErrorLogEntry[]>('/api/log');
      setEntries(Array.isArray(data) ? data : []);
    } catch (e) { showToast((e as Error).message, 'error'); setEntries([]); }
    finally { setLoading(false); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && entries === null) load();
  };

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const tr = new Date(d.getTime() + 3 * 60 * 60 * 1000);
      const pad = (n: number) => String(n).padStart(2, '0');
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
                const meta = SOURCE_LABELS[e.source || ''] || SOURCE_LABELS.manual;
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
