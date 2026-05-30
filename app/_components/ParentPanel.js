'use client';

// Veli paneli — telefon-bazlı: bir veli, parentPhone'u eşleşen tüm çocuklarını görür.
// Tümü SALT-OKUNUR. Sekmeler: Program (etütler), Ödeme, Rehberlik (konu+deneme+çözülen).
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, Wallet, BarChart3, ChevronLeft, ChevronRight, Users } from 'lucide-react';
import { StudentBookingsView } from './StudentPanel';
import RehberlikAccordion from './rehberlik/RehberlikAccordion';
import StudentGuidanceView from './rehberlik/StudentGuidanceView';
import { guidanceSubjectsFor } from './director/shared';
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

// ─── ÖDEME (finansal, salt-okunur) ───────────────────────────────────────────────
function PaymentView({ child }) {
  const [rec, setRec] = useState(undefined);

  useEffect(() => {
    (async () => {
      try { setRec(await api(`/api/finance?studentId=${encodeURIComponent(child.id)}`)); }
      catch { setRec(null); }
    })();
  }, [child.id]);

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
              <div key={i} className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-gray-50 border border-gray-100">
                <div className="min-w-0">
                  <div className="text-xs font-600 text-gray-800" style={{ fontWeight: 600 }}>{i + 1}. Taksit · {tl(inst.amount)}</div>
                  {inst.dueDate && <div className="text-[11px] text-gray-500">Vade: {inst.dueDate}</div>}
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-600 ${inst.paid ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`} style={{ fontWeight: 600 }}>
                  {inst.paid ? 'Ödendi' : 'Bekliyor'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
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
  const [tab, setTab] = useState('program');

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
      {tab === 'odeme' && <PaymentView key={child.id} child={child} />}
      {tab === 'rehberlik' && <GuidanceView key={child.id} child={child} />}
    </div>
  );
}
