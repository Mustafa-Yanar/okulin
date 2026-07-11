'use client';

// Veli paneli — telefon-bazlı: bir veli, parentPhone'u eşleşen tüm çocuklarını görür.
// Tümü SALT-OKUNUR. Sekmeler: Program (etütler), Ödeme, Rehberlik (konu+deneme+çözülen).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Wallet, BarChart3, ChevronLeft, ChevronRight, Users, Megaphone, CreditCard, X } from 'lucide-react';
import { StudentBookingsView, type BookingSlotEntry } from './StudentPanel';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';
import { guidanceSubjectsFor } from './director/shared';
import { useUrlTab } from './useUrlTab';
import { AnnouncementInbox } from './announcements/Announcements';
import { OdevParent } from './odev/Odev';
import { TakvimView } from './etkinlik/Takvim';
import { FormRespond } from './form/Formlar';
import { DavranisView } from './davranis/Davranis';
import { useClasses } from './ClassesContext';
import { classLabelFrom } from '@/lib/classCatalog';
import { getWeekKey, weekRangeLabel, classLabel } from '@/lib/constants';
import { api, getAdjacentWeek } from './shared';
import type { Session } from '@/lib/auth';
import type { ShowToast, FinanceDTO, InstallmentDTO, SlotEntryDTO } from './types';


// Haftalık gezinme (StudentPanel ile aynı hesap).

// Oturumdaki çocuk kaydı — yeni token'lar {id,name,cls} taşır (eski düz-string
// biçimi API'de normalize edilir; panel obje varsayar).
interface Child {
  id: string;
  name?: string;
  cls?: string;
}

// GET /api/etut-sablon/all satırı (veli görünümü).
interface EtutAllDTO {
  id: string;
  teacherId: string;
  teacherName?: string;
  dayIndex: number;
  dayLabel?: string;
  start: string;
  end: string;
  booked?: boolean;
  studentId?: string | null;
  studentName?: string | null;
  branch?: string;
  bookedBy?: string;
}

const tl = (n: number | undefined) => `${(Number(n) || 0).toLocaleString('tr-TR')} ₺`;

// ─── PROGRAM (etütler) ──────────────────────────────────────────────────────────
function ProgramView({ child }: { child: Child }) {
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [allSlots, setAllSlots] = useState<BookingSlotEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (wk: string) => {
    setLoading(true);
    try {
      const sid = encodeURIComponent(child.id);
      // Eski slot-etüt + yeni serbest etüt şablonları (yalnız kendi çocuğu)
      const [data, etutData] = await Promise.all([
        api<{ slots?: SlotEntryDTO[] }>(`/api/slots?week=${wk}&studentId=${sid}`),
        api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${wk}&studentId=${sid}`).catch(() => ({ etutler: [] as EtutAllDTO[] })),
      ]);
      const slotList: BookingSlotEntry[] = data.slots || [];
      const etutList: BookingSlotEntry[] = (etutData.etutler || []).map(e => ({
        kind: 'etut',
        etutId: e.id,
        teacherId: e.teacherId,
        teacherName: e.teacherName,
        day: e.dayIndex,
        dayLabel: e.dayLabel,
        slotId: `etut:${e.id}`,
        slotLabel: `${e.start}–${e.end}`,
        booked: e.booked,
        studentId: e.studentId,
        studentName: e.studentName,
        branch: e.branch,
        bookedBy: e.bookedBy || 'student',
      }));
      setAllSlots([...slotList, ...etutList]);
    } catch { setAllSlots([]); }
    finally { setLoading(false); }
  }, [child.id]);

  useEffect(() => { load(weekKey); }, [load, weekKey]);

  return (
    <div>
      <div className="flex items-center justify-end mb-4">
        <div className="flex items-center gap-1.5">
          <button onClick={() => setWeekKey(w => getAdjacentWeek(w, -1))} className="btn-ghost !px-2 !py-1.5" aria-label="Önceki hafta"><ChevronLeft size={16} /></button>
          <span className="text-xs font-600 text-gray-600 min-w-[120px] text-center" style={{ fontWeight: 600 }}>{`${weekRangeLabel(weekKey).startStr} – ${weekRangeLabel(weekKey).endStr}`}</span>
          <button onClick={() => setWeekKey(w => getAdjacentWeek(w, 1))} className="btn-ghost !px-2 !py-1.5" aria-label="Sonraki hafta"><ChevronRight size={16} /></button>
        </div>
      </div>
      {loading ? (
        <div className="text-center py-8 text-caption">Yükleniyor...</div>
      ) : (
        <StudentBookingsView student={{ id: child.id }} allSlots={allSlots} />
      )}
    </div>
  );
}

// ─── ÖDEME (finansal — görüntüleme + online ödeme) ───────────────────────────────
function PaymentView({ child, showToast }: { child: Child; showToast: ShowToast }) {
  const [rec, setRec] = useState<FinanceDTO | null | undefined>(undefined);
  const [payEnabled, setPayEnabled] = useState(false);
  const [payTarget, setPayTarget] = useState<{ idx: number; inst: InstallmentDTO } | null>(null);

  const load = useCallback(async () => {
    try { setRec(await api<FinanceDTO | null>(`/api/finance?studentId=${encodeURIComponent(child.id)}`)); }
    catch { setRec(null); }
  }, [child.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    (async () => {
      try { const d = await api<{ enabled?: boolean }>('/api/payment/config'); setPayEnabled(!!d.enabled); }
      catch { setPayEnabled(false); }
    })();
  }, []);

  if (rec === undefined) return <div className="text-center py-8 text-caption">Yükleniyor...</div>;
  if (!rec) return <div className="text-center py-8 text-gray-400"><Wallet size={28} className="mx-auto mb-2 opacity-30" /><p>Henüz ödeme kaydı yok</p></div>;

  const netFee = rec.netFee || 0;
  const balance = (rec.balance ?? netFee) || 0;
  const paid = Math.max(0, netFee - balance);
  const installments = Array.isArray(rec.installments) ? rec.installments : [];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <div className="card p-3 text-center">
          <div className="text-caption mb-0.5">Net Ücret</div>
          <div className="font-800 text-gray-900 text-sm" style={{ fontWeight: 800 }}>{tl(rec.netFee)}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-caption mb-0.5">Ödenen</div>
          <div className="font-800 text-emerald-600 text-sm" style={{ fontWeight: 800 }}>{tl(paid)}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-caption mb-0.5">Kalan</div>
          <div className="font-800 text-sm" style={{ fontWeight: 800, color: balance > 0 ? '#dc2626' : '#16a34a' }}>{tl(balance)}</div>
        </div>
      </div>

      {(rec.discount > 0) && (
        <p className="text-xs text-gray-500">Toplam ücret {tl(rec.totalFee)} · indirim {tl(rec.discount)} uygulandı.</p>
      )}

      {installments.length > 0 && (
        <div>
          <h4 className="text-label mb-2">Taksitler</h4>
          <div className="space-y-1.5">
            {installments.map((inst, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <div className="min-w-0">
                  <div className="text-xs font-600" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{i + 1}. Taksit · {tl(inst.amount)}</div>
                  {inst.dueDate && <div className="text-caption">Vade: {inst.dueDate}</div>}
                </div>
                {inst.paid ? (
                  <span className="badge badge-success shrink-0">Ödendi</span>
                ) : payEnabled ? (
                  <button onClick={() => setPayTarget({ idx: i, inst })}
                    className="text-[11px] px-3 py-1.5 rounded-lg font-700 bg-emerald-600 text-white hover:bg-emerald-700 flex items-center gap-1 shrink-0" style={{ fontWeight: 700 }}>
                    <CreditCard size={12} /> Öde
                  </button>
                ) : (
                  <span className="badge badge-warning shrink-0">Bekliyor</span>
                )}
              </div>
            ))}
          </div>
          {payEnabled && (
            <p className="text-caption mt-2">Online ödeme güvenli kart altyapısı (PayTR) ile alınır.</p>
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

interface PayModalProps {
  child: Child;
  idx: number;
  inst: InstallmentDTO;
  showToast: ShowToast;
  onClose: () => void;
  onPaid: () => void;
}

// PayTR iframe modalı. /api/payment/start → iframeUrl; sonucu odeme/sonuc sayfası
// postMessage ile bildirir. Kredilendirme sunucudaki callback'te yapılır.
function PayModal({ child, idx, inst, showToast, onClose, onPaid }: PayModalProps) {
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const d = await api<{ iframeUrl: string }>('/api/payment/start', { method: 'POST', body: JSON.stringify({ studentId: child.id, installmentIdx: idx }) });
        setUrl(d.iframeUrl);
      } catch (e) { setErr((e as Error).message); }
      finally { setLoading(false); }
    })();
  }, [child.id, idx]);

  useEffect(() => {
    function onMsg(e: MessageEvent) {
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
    // iFrameResize script'i window'a global ekler — tip beyanı yok, bilinçli iddia.
    s.onload = () => { try { (window as unknown as { iFrameResize: (opts: object, sel: string) => void }).iFrameResize({}, '#paytr-iframe'); } catch {} };
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
          <button onClick={onClose} className="btn-icon"><X size={16} /></button>
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
function GuidanceView({ child }: { child: Child }) {
  return (
    <RehberlikAccordion
      subjects={guidanceSubjectsFor(child.cls)}
      editable={false}
      studentId={child.id}
      solvedContent={<StudentGuidanceView studentId={child.id} readOnly />}
    />
  );
}

interface ParentPanelProps {
  session: Session;
  showToast: ShowToast;
  externalTab?: string | null;
  onExternalTabChange?: (key: string) => void;
}

// ─── KÖK ────────────────────────────────────────────────────────────────────────
export default function ParentPanel({ session, showToast, externalTab, onExternalTabChange }: ParentPanelProps) {
  const { classes } = useClasses();
  // Yeni token'larda children obje listesi — eski düz-string biçim panelde beklenmiyor
  // (obje varsayımı çalışma zamanı sözleşmesi; bilinçli tip iddiası).
  const children = useMemo(() => (Array.isArray(session.children) ? session.children : []) as Child[], [session.children]);
  const [childId, setChildId] = useState<string | null>(children[0]?.id || null);
  const [tab, setTabInternal] = useUrlTab('program', ['program', 'odev', 'davranis', 'odeme', 'rehberlik', 'duyurular', 'takvim', 'formlar']);

  useEffect(() => {
    if (externalTab && externalTab !== tab) setTabInternal(externalTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTab]);

  const setTab = useCallback((key: string) => {
    setTabInternal(key);
    onExternalTabChange?.(key);
  }, [setTabInternal, onExternalTabChange]);

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

  return (
    <div>
      {/* Veli karşılama — kendi adını görür (öğrenci formundaki Veli Adı'ndan gelir).
          parentName yalnız gerçek ad girilmişse dolu; boşsa karşılama gösterilmez. */}
      {session.parentName && (
        <p className="text-lg mb-3" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
          Hoş geldiniz, {session.parentName}
        </p>
      )}

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

      <p className="text-body-sm mb-4">{child.name} · {classLabelFrom(classes, child.cls || '', classLabel)}</p>

      {/* child.id değişince alt bileşenler remount olsun diye key */}
      {tab === 'program' && <ProgramView key={child.id} child={child} />}
      {tab === 'odev' && <OdevParent key={child.id} childId={child.id} showToast={showToast} />}
      {tab === 'davranis' && <DavranisView key={child.id} studentId={child.id} />}
      {tab === 'odeme' && <PaymentView key={child.id} child={child} showToast={showToast} />}
      {tab === 'rehberlik' && <GuidanceView key={child.id} child={child} />}
      {tab === 'duyurular' && <AnnouncementInbox showToast={showToast} />}
      {tab === 'takvim' && <TakvimView />}
      {tab === 'formlar' && <FormRespond showToast={showToast} />}
    </div>
  );
}
