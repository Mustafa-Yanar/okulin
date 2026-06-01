'use client';

// Veli paneli — telefon-bazlı: bir veli, parentPhone'u eşleşen tüm çocuklarını görür.
// Tümü SALT-OKUNUR. Sekmeler: Program (etütler), Ödeme, Rehberlik (konu+deneme+çözülen).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Wallet, BarChart3, ChevronLeft, ChevronRight, Users, Megaphone, CreditCard, X } from 'lucide-react';
import { StudentBookingsView } from './StudentPanel';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';
import { guidanceSubjectsFor } from './director/shared';
import { useUrlTab } from './useUrlTab';
import { AnnouncementInbox } from './announcements/Announcements';
import { getWeekKey, weekRangeLabel, classLabel } from '@/lib/constants';

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

// Haftalık gezinme (StudentPanel ile aynı hesap).
function getAdjacentWeek(weekKey, delta) {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const date = new Date(parseInt(year), 0, 1 + (week - 1) * 7);
  date.setDate(date.getDate() + delta * 7);
  const d = new Date(date);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const w = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, '0')}`;
}

const tl = (n) => `${(Number(n) || 0).toLocaleString('tr-TR')} ₺`;

// ─── PROGRAM (etütler) ──────────────────────────────────────────────────────────
function ProgramView({ child }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (wk) => {
    setLoading(true);
    try {
      const data = await api(`/api/slots?week=${wk}&studentId=${encodeURIComponent(child.id)}`);
      setAllSlots(data.slots || []);
    } catch { setAllSlots([]); }
    finally { setLoading(false); }
  }, [child.id]);

  useEffect(() => { load(weekKey); }, [load, weekKey]);

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setWeekKey(w => getAdjacentWeek(w, -1))} className="btn-ghost !px-2 !py-1.5" aria-label="Önceki hafta"><ChevronLeft size={16} /></button>
          <span className="text-xs font-600 text-gray-600 min-w-[120px] text-center" style={{ fontWeight: 600 }}>{weekRangeLabel(weekKey)}</span>
          <button onClick={() => setWeekKey(w => getAdjacentWeek(w, 1))} className="btn-ghost !px-2 !py-1.5" aria-label="Sonraki hafta"><ChevronRight size={16} /></button>
        </div>
      </div>
      {loading ? (
        <div className="text-center py-8 text-gray-400">Yükleniyor...</div>
      ) : (
        <StudentBookingsView student={{ id: child.id }} allSlots={allSlots} />
      )}
    </div>
  );
}

// ─── ÖDEME (finansal — görüntüleme + online ödeme) ───────────────────────────────
function PaymentView({ child, showToast }) {
  const [rec, setRec] = useState(undefined);
  const [payEnabled, setPayEnabled] = useState(false);
  const [payTarget, setPayTarget] = useState(null); // { idx, inst }

  const load = useCallback(async () => {
    try { setRec(await api(`/api/finance?studentId=${encodeURIComponent(child.id)}`)); }
    catch { setRec(null); }
  }, [child.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try { const d = await api('/api/payment/config'); setPayEnabled(!!d.enabled); }
      catch { setPayEnabled(false); }
    })();
  }, []);

  if (rec === undefined) return <div className="text-center py-8 text-gray-400">Yükleniyor...</div>;
  if (!rec) return <div className="text-center py-8 text-gray-400"><Wallet size={28} className="mx-auto mb-2 opacity-30" /><p>Henüz ödeme kaydı yok</p></div>;

  const netFee = rec.netFee || 0;
  const balance = (rec.balance ?? netFee) || 0;
  const paid = Math.max(0, netFee - balance);
  const installments = Array.isArray(rec.installments) ? rec.installments : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3 text-center">
          <div className="text-[11px] text-gray-400 mb-0.5">Net Ücret</div>
          <div className="font-800 text-gray-900 text-sm" style={{ fontWeight: 800 }}>{tl(rec.netFee)}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-[11px] text-gray-400 mb-0.5">Ödenen</div>
          <div className="font-800 text-emerald-600 text-sm" style={{ fontWeight: 800 }}>{tl(paid)}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-[11px] text-gray-400 mb-0.5">Kalan</div>
          <div className="font-800 text-sm" style={{ fontWeight: 800, color: balance > 0 ? '#dc2626' : '#16a34a' }}>{tl(balance)}</div>
        </div>
      </div>

      {(rec.discount > 0) && (
        <p className="text-xs text-gray-500">Toplam ücret {tl(rec.totalFee)} · indirim {tl(rec.discount)} uygulandı.</p>
      )}

      {installments.length > 0 && (
        <div>
          <h4 className="text-xs font-700 text-gray-700 uppercase tracking-wide mb-2" style={{ fontWeight: 700 }}>Taksitler</h4>
          <div className="space-y-1.5">
            {installments.map((inst, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <div className="min-w-0">
                  <div className="text-xs font-600 text-gray-800" style={{ fontWeight: 600 }}>{i + 1}. Taksit · {tl(inst.amount)}</div>
                  {inst.dueDate && <div className="text-[11px] text-gray-500">Vade: {inst.dueDate}</div>}
                </div>
                {inst.paid ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-600 bg-emerald-100 text-emerald-600 shrink-0" style={{ fontWeight: 600 }}>Ödendi</span>
                ) : payEnabled ? (
                  <button onClick={() => setPayTarget({ idx: i, inst })}
                    className="text-[11px] px-3 py-1.5 rounded-lg font-700 bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1 shrink-0" style={{ fontWeight: 700 }}>
                    <CreditCard size={12} /> Öde
                  </button>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-600 bg-amber-100 text-amber-600 shrink-0" style={{ fontWeight: 600 }}>Bekliyor</span>
                )}
              </div>
            ))}
          </div>
          {payEnabled && (
            <p className="text-[10px] text-gray-400 mt-2">Online ödeme güvenli kart altyapısı (PayTR) ile alınır.</p>
          )}
        </div>
      )}

      {payTarget && (
        <PayModal
          child={child}
          idx={payTarget.idx}
          inst={payTarget.inst}
          showToast={showToast}
          onClose={() => setPayTarget(null)}
          onPaid={() => { setPayTarget(null); load(); }}
        />
      )}
    </div>
  );
}

// PayTR iframe modalı. /api/payment/start → iframeUrl; sonucu odeme/sonuc sayfası
// postMessage ile bildirir. Kredilendirme sunucudaki callback'te yapılır.
function PayModal({ child, idx, inst, showToast, onClose, onPaid }) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api('/api/payment/start', { method: 'POST', body: JSON.stringify({ studentId: child.id, installmentIdx: idx }) });
        setUrl(d.iframeUrl);
      } catch (e) { setErr(e.message); }
      finally { setLoading(false); }
    })();
  }, [child.id, idx]);

  useEffect(() => {
    function onMsg(e) {
      if (e?.data?.type !== 'paytr-result') return;
      if (e.data.status === 'fail') { showToast('Ödeme tamamlanamadı', 'error'); onClose(); }
      else { showToast('Ödeme alındı'); onPaid(); }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onClose, onPaid, showToast]);

  // PayTR iframe yükseklik uyumu için resmi resizer
  useEffect(() => {
    if (!url) return;
    const s = document.createElement('script');
    s.src = 'https://www.paytr.com/js/iframeResizer.min.js';
    s.onload = () => { try { window.iFrameResize({}, '#paytr-iframe'); } catch {} };
    document.body.appendChild(s);
    return () => { try { document.body.removeChild(s); } catch {} };
  }, [url]);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 sticky top-0 bg-white">
          <div className="text-sm font-700 text-gray-800 flex items-center gap-1.5" style={{ fontWeight: 700 }}>
            <CreditCard size={15} className="text-emerald-600" /> {idx + 1}. Taksit · {tl(inst.amount)}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
        </div>
        <div className="p-2">
          {loading && <div className="text-center py-10 text-gray-400 text-sm">Ödeme ekranı hazırlanıyor…</div>}
          {err && <div className="text-center py-10 text-red-500 text-sm">{err}</div>}
          {url && (
            <iframe id="paytr-iframe" src={url} frameBorder="0" scrolling="no" style={{ width: '100%', minHeight: 480 }} title="PayTR Ödeme" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── REHBERLİK (konu + deneme + çözülen, salt-okunur) ────────────────────────────
function GuidanceView({ child }) {
  return (
    <RehberlikAccordion
      subjects={guidanceSubjectsFor(child.cls)}
      editable={false}
      studentId={child.id}
      solvedContent={<StudentGuidanceView studentId={child.id} readOnly />}
    />
  );
}

// ─── KÖK ────────────────────────────────────────────────────────────────────────
export default function ParentPanel({ session, showToast }) {
  const children = useMemo(() => Array.isArray(session.children) ? session.children : [], [session.children]);
  const [childId, setChildId] = useState(children[0]?.id || null);
  const [tab, setTab] = useUrlTab('program', ['program', 'odeme', 'rehberlik', 'duyurular']);

  const child = useMemo(() => children.find(c => c.id === childId) || children[0], [children, childId]);

  if (!child) {
    return (
      <div className="text-center py-16 text-gray-400">
        <Users size={32} className="mx-auto mb-3 opacity-30" />
        <p>Bu hesaba bağlı öğrenci bulunamadı.</p>
        <p className="text-xs mt-1">Müdür "veli erişimini senkronize et" işlemini yapmamış olabilir.</p>
      </div>
    );
  }

  const TABS = [
    ['program', 'Program', Calendar],
    ['odeme', 'Ödeme', Wallet],
    ['rehberlik', 'Rehberlik', BarChart3],
    ['duyurular', 'Duyurular', Megaphone],
  ];

  return (
    <div>
      {/* Çocuk seçici (birden çok çocuk varsa) */}
      {children.length > 1 && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {children.map(c => {
            const active = c.id === child.id;
            return (
              <button key={c.id} onClick={() => setChildId(c.id)}
                className={`px-3.5 py-2 rounded-xl text-sm font-600 transition-all border ${active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                style={{ fontWeight: 600, background: active ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : undefined }}>
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      <p className="text-sm text-gray-500 mb-4">{child.name} · {classLabel(child.cls)}</p>

      <div className="flex gap-1 mb-4 p-1 bg-gray-100 rounded-xl w-fit">
        {TABS.map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab === key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight: 600 }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* child.id değişince alt bileşenler remount olsun diye key */}
      {tab === 'program' && <ProgramView key={child.id} child={child} />}
      {tab === 'odeme' && <PaymentView key={child.id} child={child} showToast={showToast} />}
      {tab === 'rehberlik' && <GuidanceView key={child.id} child={child} />}
      {tab === 'duyurular' && <AnnouncementInbox showToast={showToast} />}
    </div>
  );
}
