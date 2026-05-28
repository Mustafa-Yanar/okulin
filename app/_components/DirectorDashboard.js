'use client';

import React, { useMemo } from 'react';
import {
  Users, GraduationCap, Calendar, ClipboardList, Plus, BookOpen, BarChart3, Clock
} from 'lucide-react';
import { getMondayOfWeek } from '@/lib/slots';

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
// Müdür ana sayfası özet kartları. Verileri DirectorPanel'in mevcut state'inden
// alır (yeni API çağrısı yok).
export default function DirectorDashboard({
  session,
  teachers,
  students,
  allSlots,
  weekKey,
  pendingGuidance,
  onNewTeacher,
  onNewStudent,
  onGotoTab,
}) {
  // ─── Hesaplamalar (mevcut veriden) ───
  const stats = useMemo(() => {
    const studentByGroup = { ortaokul: 0, lise: 0, mezun: 0 };
    students.forEach(s => {
      if (s.cls?.startsWith('m')) studentByGroup.mezun++;
      else if (s.cls?.startsWith('7') || s.cls?.startsWith('8')) studentByGroup.ortaokul++;
      else studentByGroup.lise++;
    });

    let bookedThisWeek = 0;
    let openSlotsThisWeek = 0;
    allSlots.forEach(s => {
      if (s.booked) bookedThisWeek++;
      else if (!s.disabled) openSlotsThisWeek++;
    });

    let pendingGuidanceCount = 0;
    Object.values(pendingGuidance || {}).forEach(v => {
      if (typeof v === 'number') pendingGuidanceCount += v;
      else if (Array.isArray(v)) pendingGuidanceCount += v.length;
      else if (v && typeof v === 'object') pendingGuidanceCount += Object.keys(v).length;
    });

    return {
      teacherCount: teachers.length,
      studentCount: students.length,
      studentByGroup,
      bookedThisWeek,
      openSlotsThisWeek,
      pendingGuidanceCount,
    };
  }, [teachers, students, allSlots, pendingGuidance]);

  // Hafta tarih aralığı
  const weekRange = useMemo(() => {
    try {
      const monday = getMondayOfWeek(weekKey);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const fmt = (d) => `${d.getDate()} ${['Oca','Şub','Mar','Nis','May','Haz','Tem','Ağu','Eyl','Eki','Kas','Ara'][d.getMonth()]}`;
      return `${fmt(monday)} – ${fmt(sunday)} ${sunday.getFullYear()}`;
    } catch { return weekKey; }
  }, [weekKey]);

  // Doluluk yüzdesi
  const totalSlots = stats.bookedThisWeek + stats.openSlotsThisWeek;
  const occupancyPct = totalSlots > 0 ? Math.round((stats.bookedThisWeek / totalSlots) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Karşılama + Hafta */}
      <div className="card-elevated p-5 bg-gradient-to-br from-indigo-50 to-white border-indigo-100">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-indigo-500 font-600 uppercase tracking-wide" style={{ fontWeight: 600 }}>Hoş geldiniz</p>
            <h2 className="text-2xl font-800 text-gray-900 mt-1" style={{ fontWeight: 800 }}>{session.name}</h2>
            <p className="text-sm text-gray-500 mt-1">Müdür Paneli</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-indigo-100">
            <Calendar size={16} className="text-indigo-500" />
            <div>
              <div className="text-[10px] text-gray-400 font-500 uppercase tracking-wide" style={{ fontWeight: 500 }}>Aktif Hafta</div>
              <div className="text-sm font-700 text-gray-900" style={{ fontWeight: 700 }}>{weekRange}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Sayı kartları */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={BookOpen}
          label="Öğretmen"
          value={stats.teacherCount}
          accent="#22c55e"
          bgAccent="from-green-50 to-white"
        />
        <StatCard
          icon={GraduationCap}
          label="Öğrenci"
          value={stats.studentCount}
          accent="#f59e0b"
          bgAccent="from-amber-50 to-white"
          sub={`${stats.studentByGroup.ortaokul}O · ${stats.studentByGroup.lise}L · ${stats.studentByGroup.mezun}M`}
        />
        <StatCard
          icon={Clock}
          label="Bu Hafta Etüt"
          value={stats.bookedThisWeek}
          accent="#6366f1"
          bgAccent="from-indigo-50 to-white"
          sub={totalSlots > 0 ? `${occupancyPct}% dolu (${stats.openSlotsThisWeek} açık)` : 'Slot yok'}
        />
        <StatCard
          icon={ClipboardList}
          label="Bekleyen Rehberlik"
          value={stats.pendingGuidanceCount}
          accent={stats.pendingGuidanceCount > 0 ? '#ef4444' : '#9ca3af'}
          bgAccent={stats.pendingGuidanceCount > 0 ? 'from-red-50 to-white' : 'from-gray-50 to-white'}
          highlight={stats.pendingGuidanceCount > 0}
        />
      </div>

      {/* Hızlı eylemler */}
      <div>
        <h3 className="text-sm font-700 text-gray-700 mb-3" style={{ fontWeight: 700 }}>Hızlı Eylemler</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <QuickAction icon={Plus} label="Yeni Öğretmen" onClick={onNewTeacher} accent="#22c55e" />
          <QuickAction icon={Plus} label="Yeni Öğrenci" onClick={onNewStudent} accent="#f59e0b" />
          <QuickAction icon={Users} label="Öğretmenleri Yönet" onClick={() => onGotoTab('teachers')} accent="#6366f1" />
          <QuickAction icon={BarChart3} label="Ders Programı" onClick={() => onGotoTab('program')} accent="#a855f7" />
        </div>
      </div>

      {/* Doluluk barı (varsa) */}
      {totalSlots > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-700 text-gray-700" style={{ fontWeight: 700 }}>Bu Haftaki Slot Doluluğu</h3>
            <span className="text-xs text-gray-500">{stats.bookedThisWeek} / {totalSlots}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${occupancyPct}%`,
                background: occupancyPct > 80 ? '#ef4444' : occupancyPct > 50 ? '#f59e0b' : '#22c55e',
              }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {occupancyPct < 30 ? 'Müsait slot bol, rezervasyon alınabilir.' :
              occupancyPct < 70 ? 'Slot doluluğu dengeli.' :
              'Yoğun hafta — çoğu slot dolu.'}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───
function StatCard({ icon: Icon, label, value, accent, bgAccent, sub, highlight }) {
  return (
    <div className={`card p-4 bg-gradient-to-br ${bgAccent} ${highlight ? 'ring-2 ring-red-200' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: accent }}>
          <Icon size={18} color="white" />
        </div>
      </div>
      <div className="text-2xl font-800 text-gray-900 leading-tight" style={{ fontWeight: 800 }}>{value}</div>
      <div className="text-xs text-gray-500 font-600 mt-0.5" style={{ fontWeight: 600 }}>{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-1 truncate">{sub}</div>}
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      className="card p-3 hover:shadow-md hover:-translate-y-px transition-all text-left flex items-center gap-3 group"
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform" style={{ background: accent }}>
        <Icon size={16} color="white" />
      </div>
      <span className="text-xs sm:text-sm font-600 text-gray-700 leading-tight" style={{ fontWeight: 600 }}>{label}</span>
    </button>
  );
}
