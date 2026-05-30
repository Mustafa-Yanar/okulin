'use client';

// Müdür ayarlar modalı (isim + ders saatleri) ve içindeki bölümler:
// bildirim testi, denetim kayıtları (audit log), hata kayıtları (error log).
import React, { useState, useEffect, useMemo } from 'react';
import { Clock, AlertTriangle, Palette, Users } from 'lucide-react';
import { useSlotTimes } from '../SlotTimesContext';
import { api, Modal } from './shared';
import { brandGradient } from '@/lib/branding';
import { formatTurkishMobile } from '@/lib/phone';

export function DirectorSettingsModal({ current, onClose, onSave, onBranding, showToast }) {
  const [name, setName] = useState(current || '');
  const [savingName, setSavingName] = useState(false);

  const [weekday, setWeekday] = useState([]);
  const [weekend, setWeekend] = useState([]);
  const [timesLoading, setTimesLoading] = useState(true);
  const [savingTimes, setSavingTimes] = useState(false);

  const { updateSlotTimes } = useSlotTimes();

  useEffect(() => {
    (async () => {
      try {
        const data = await api('/api/slot-times');
        setWeekday(data.weekday || []);
        setWeekend(data.weekend || []);
      } catch (e) { showToast(e.message, 'error'); }
      setTimesLoading(false);
    })();
  }, []);

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

  const TIME_OPTIONS = useMemo(() => {
    const out = [];
    for (let h = 9; h <= 19; h++) {
      for (let m = 0; m < 60; m += 5) {
        if (h === 19 && m > 20) break;
        out.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return out;
  }, []);

  function toMin(t) {
    const [h, m] = t.split(':').map(n => parseInt(n));
    return h * 60 + m;
  }

  function updateSlot(arr, setArr, i, field, value) {
    const next = arr.map((s, idx) => idx === i ? { ...s, [field]: value } : s);
    for (let j = i + 1; j < next.length; j++) {
      if (toMin(next[j].start || '00:00') < toMin(next[j - 1].end || '00:00')) {
        next[j] = { start: '', end: '' };
      }
    }
    setArr(next);
  }

  function renderRow(arr, setArr, i) {
    const s = arr[i];
    const prevEnd = i > 0 ? arr[i - 1].end : null;
    const startOptions = TIME_OPTIONS.filter(t => !prevEnd || toMin(t) >= toMin(prevEnd));
    const endOptions = s.start ? TIME_OPTIONS.filter(t => toMin(t) > toMin(s.start)) : [];
    return (
      <tr key={i} className="border-t border-gray-50">
        <td className="py-1 px-2 text-xs text-gray-400 w-10">{i + 1}.</td>
        <td className="py-1 px-1">
          <select value={s.start || ''} onChange={e => updateSlot(arr, setArr, i, 'start', e.target.value)}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white">
            <option value="">—</option>
            {startOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
        <td className="py-1 px-1 text-xs text-gray-400 text-center">–</td>
        <td className="py-1 px-1">
          <select value={s.end || ''} onChange={e => updateSlot(arr, setArr, i, 'end', e.target.value)}
            disabled={!s.start}
            className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white disabled:bg-gray-50 disabled:text-gray-300">
            <option value="">—</option>
            {endOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </td>
      </tr>
    );
  }

  async function saveTimes() {
    for (const arr of [weekday, weekend]) {
      for (const s of arr) {
        if (!s.start || !s.end) {
          showToast('Tüm saat alanlarını doldurun', 'error');
          return;
        }
      }
    }
    setSavingTimes(true);
    try {
      await api('/api/slot-times', { method: 'POST', body: JSON.stringify({ weekday, weekend }) });
      updateSlotTimes({ weekday, weekend });
      showToast('Saatler kaydedildi ve uygulandı');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSavingTimes(false);
    }
  }

  return (
    <Modal title="Ayarlar" onClose={onClose} wide>
      <div className="mb-5 pb-5 border-b border-gray-100">
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Müdür Bilgisi</h4>
        <form onSubmit={submitName} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-[10px] font-600 text-gray-400 uppercase tracking-wide mb-1" style={{ fontWeight: 600 }}>Ad Soyad</label>
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
        <ParentAccessSection showToast={showToast} />
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Ders Saatleri</h4>
        {timesLoading ? (
          <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-600 text-gray-500 uppercase mb-1.5" style={{ fontWeight: 600 }}>Hafta İçi</div>
                <table className="w-full text-sm">
                  <tbody>{weekday.map((_, i) => renderRow(weekday, setWeekday, i))}</tbody>
                </table>
              </div>
              <div>
                <div className="text-[11px] font-600 text-gray-500 uppercase mb-1.5" style={{ fontWeight: 600 }}>Hafta Sonu</div>
                <table className="w-full text-sm">
                  <tbody>{weekend.map((_, i) => renderRow(weekend, setWeekend, i))}</tbody>
                </table>
              </div>
            </div>
            <div className="flex justify-end mt-4">
              <button className="btn-primary !px-4 !py-2 text-sm" onClick={saveTimes} disabled={savingTimes}>
                {savingTimes ? 'Kaydediliyor…' : 'Saatleri Kaydet'}
              </button>
            </div>
          </>
        )}
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <AuditLogSection showToast={showToast} />
      </div>

      <div className="mb-5 pb-5 border-b border-gray-100">
        <ErrorLogSection showToast={showToast} />
      </div>

      <PushTestSection showToast={showToast} />
    </Modal>
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
      <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
        <Palette size={13} className="text-indigo-500" /> Kurum Markası
      </h4>
      {!loaded ? (
        <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
      ) : (
        <form onSubmit={save} className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] font-600 text-gray-400 uppercase tracking-wide mb-1" style={{ fontWeight: 600 }}>Kurum Adı</label>
              <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Akyazı Çözüm" required />
            </div>
            <div>
              <label className="block text-[10px] font-600 text-gray-400 uppercase tracking-wide mb-1" style={{ fontWeight: 600 }}>Kısa Ad (sekme/PWA)</label>
              <input className="input" value={shortName} onChange={e => setShortName(e.target.value)} placeholder="(boşsa kurum adı kullanılır)" />
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-600 text-gray-400 uppercase tracking-wide mb-1" style={{ fontWeight: 600 }}>Logo Adresi</label>
            <input className="input" value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="/logo.png veya https://..." />
            <p className="text-[10px] text-gray-400 mt-1">Boş bırakılırsa marka ikonu (renkli simge) gösterilir.</p>
          </div>
          <div className="flex items-center gap-3">
            <div>
              <label className="block text-[10px] font-600 text-gray-400 uppercase tracking-wide mb-1" style={{ fontWeight: 600 }}>Tema Rengi</label>
              <input type="color" value={themeColor} onChange={e => setThemeColor(e.target.value)}
                className="h-9 w-14 rounded border border-gray-200 bg-white cursor-pointer" aria-label="Tema rengi" />
            </div>
            <div className="flex items-center gap-2 mt-4">
              <span className="text-[11px] text-gray-400">Önizleme:</span>
              {logoUrl.trim() ? (
                <img src={logoUrl} alt="" className="h-9 w-auto object-contain" onError={e => { e.currentTarget.style.display = 'none'; }} />
              ) : (
                <div className="h-9 w-9 rounded-xl" style={{ background: brandGradient(themeColor) }} />
              )}
              <span className="font-800 text-gray-900 text-sm" style={{ fontWeight: 800 }}>{name || 'Kurum'}</span>
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

// ─── VELİ ERİŞİMİ ───────────────────────────────────────────────────────────────
function ParentAccessSection({ showToast }) {
  const [open, setOpen] = useState(false);
  const [parents, setParents] = useState(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    setLoading(true);
    try { const d = await api('/api/parents'); setParents(d.parents || []); }
    catch (e) { showToast(e.message, 'error'); setParents([]); }
    finally { setLoading(false); }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && parents === null) load();
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api('/api/parents', { method: 'POST', body: JSON.stringify({ action: 'sync' }) });
      showToast(`Veli erişimi güncellendi: ${r.created} yeni, ${r.updated} mevcut${r.removed ? `, ${r.removed} kaldırıldı` : ''} · ${r.totalParents} veli / ${r.totalChildren} öğrenci${r.studentsWithoutPhone ? ` (${r.studentsWithoutPhone} öğrencinin veli telefonu yok)` : ''}`);
      await load();
    } catch (e) { showToast(e.message, 'error'); }
    finally { setSyncing(false); }
  };

  const reset = async (phone) => {
    try {
      await api('/api/parents', { method: 'POST', body: JSON.stringify({ action: 'reset', phone }) });
      showToast('Veli şifresi sıfırlandı (telefon = geçici şifre)');
      await load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide flex items-center gap-1.5" style={{ fontWeight: 700 }}>
          <Users size={13} className="text-pink-500" /> Veli Erişimi
        </h4>
        <button onClick={toggle} className="btn-ghost !px-3 !py-1.5 text-xs">{open ? 'Gizle' : 'Göster'}</button>
      </div>

      {open && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-3">
            Veliler, öğrenci kaydındaki <b>veli telefonu</b> ile giriş yapar. İlk şifre = telefonun kendisi; veli ilk girişte kendi şifresini belirler. Aynı telefona bağlı kardeşler tek girişte görünür. Öğrenci ekledikten sonra tekrar senkronize et.
          </p>
          <button onClick={sync} disabled={syncing} className="btn-primary !px-4 !py-2 text-sm mb-3">
            {syncing ? 'Senkronize ediliyor…' : 'Veli erişimini senkronize et'}
          </button>

          {loading ? (
            <div className="text-center py-4 text-gray-400 text-sm">Yükleniyor...</div>
          ) : !parents || parents.length === 0 ? (
            <div className="text-center py-4 text-gray-400 text-sm">Henüz veli hesabı yok — yukarıdaki düğmeyle oluştur.</div>
          ) : (
            <div className="space-y-1.5 max-h-72 overflow-y-auto">
              {parents.map((p) => (
                <div key={p.phone} className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                  <div className="min-w-0">
                    <div className="text-xs font-600 text-gray-800 flex items-center gap-1.5" style={{ fontWeight: 600 }}>
                      {formatTurkishMobile(p.phone)}
                      {p.mustChangePassword && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600 font-600" style={{ fontWeight: 600 }}>ilk giriş bekliyor</span>}
                    </div>
                    <div className="text-[11px] text-gray-500 truncate">{p.childrenNames.join(', ')}</div>
                  </div>
                  <button onClick={() => reset(p.phone)} className="btn-ghost !px-2.5 !py-1.5 text-[11px] shrink-0">Şifre sıfırla</button>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">{parents?.length ? `${parents.length} veli hesabı` : ''}</p>
        </div>
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
      <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Bildirim Testi</h4>
      <p className="text-xs text-gray-500 mb-2">Üstteki zil simgesinden bildirimleri açtıktan sonra kendine test bildirimi gönder.</p>
      <button onClick={sendTest} disabled={sending} className="btn-ghost !px-4 !py-2 text-sm">
        {sending ? 'Gönderiliyor…' : 'Kendime test bildirimi gönder'}
      </button>
    </div>
  );
}

// ─── DENETİM KAYITLARI (AUDIT LOG) ──────────────────────────────────────────────
function AuditLogSection({ showToast }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState(null);
  const [loading, setLoading] = useState(false);

  const ACTION_LABELS = {
    'student.delete': { label: 'Öğrenci silindi', color: '#dc2626' },
    'student.bulkDelete': { label: 'Toplu öğrenci silme', color: '#dc2626' },
    'teacher.delete': { label: 'Öğretmen silindi', color: '#dc2626' },
    'accountant.delete': { label: 'Muhasebeci silindi', color: '#dc2626' },
    'finance.payment': { label: 'Ödeme alındı', color: '#16a34a' },
    'finance.paymentDelete': { label: 'Ödeme silindi', color: '#ea580c' },
    'finance.create': { label: 'Finansal kayıt', color: '#6366f1' },
    'finance.update': { label: 'Finansal güncelleme', color: '#6366f1' },
    'finance.delete': { label: 'Finansal kayıt silindi', color: '#dc2626' },
    'auth.resetPassword': { label: 'Şifre sıfırlandı', color: '#d97706' },
    'org.brandingUpdate': { label: 'Kurum markası güncellendi', color: '#6366f1' },
    'parent.sync': { label: 'Veli erişimi senkronize edildi', color: '#db2777' },
    'parent.reset': { label: 'Veli şifresi sıfırlandı', color: '#d97706' },
  };

  const load = async () => {
    setLoading(true);
    try {
      const data = await api('/api/audit');
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
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide" style={{ fontWeight: 700 }}>İşlem Kayıtları</h4>
        <button onClick={toggle} className="btn-ghost !px-3 !py-1.5 text-xs flex items-center gap-1.5">
          <Clock size={13} /> {open ? 'Gizle' : 'Göster'}
        </button>
      </div>
      {open && (
        <div className="mt-3">
          {loading ? (
            <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">Henüz kayıt yok</div>
          ) : (
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
              {entries.map((e, i) => {
                const meta = ACTION_LABELS[e.action] || { label: e.action, color: '#6b7280' };
                return (
                  <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-gray-50 border border-gray-100">
                    <span className="shrink-0 w-1.5 h-1.5 rounded-full mt-1.5" style={{ background: meta.color }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-700">{e.detail || meta.label}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">
                        {fmtTime(e.ts)} · {e.actorName} ({e.actorRole === 'director' ? 'Müdür' : e.actorRole === 'accountant' ? 'Muhasebeci' : e.actorRole})
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Son 500 kayıt gösterilir · kayıtlar 90 gün saklanır</p>
        </div>
      )}
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
        <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide flex items-center gap-1.5" style={{ fontWeight: 700 }}>
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
            <div className="text-center py-6 text-gray-400 text-sm">Yükleniyor...</div>
          ) : !entries || entries.length === 0 ? (
            <div className="text-center py-6 text-emerald-600 text-sm">Hata kaydı yok — her şey yolunda.</div>
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
                        <div className="text-xs text-gray-800 break-words">{e.message}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">
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
          <p className="text-[10px] text-gray-400 mt-2">Son 500 hata · kayıtlar 30 gün saklanır · satıra tıkla → ayrıntı</p>
        </div>
      )}
    </div>
  );
}
