'use client';

// Müdür/rehber TOPLU etüt görünümü — haftanın tüm serbest etütleri tek ekranda.
// Kaynak: /api/etut-sablon/all (EtutSablon+EtutReservation efektif listesi; rol
// guard'ı route'ta, müdür/rehber tam listeyi alır). SALT-OKUNUR: atama/iptal
// öğretmen panelinde (TeacherEtutPanel) ve seri yönetimi ProgramEditor'dadır.
// Gruplama: öğretmene göre (boş slotlar DAHİL — kapasite görünümü) / öğrenciye
// göre (yalnız atanmışlar). Hafta gezinme serbest (geçmiş dahil, Faz 3 kararı).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Clock, Users, GraduationCap, Calendar } from 'lucide-react';
import { getWeekKey } from '@/lib/constants';
import { api, getAdjacentWeek, WeekNav } from '../shared';
import { classShortUpper } from '@/lib/classCatalog';
import { useClasses } from '../ClassesContext';
import LoadingBox from '../Loading';
import EmptyState from '../EmptyState';
import type { EtutAllDTO } from '../student-types';
import type { ShowToast } from '../types';

type GroupMode = 'teacher' | 'student';

interface EtutOverviewTabProps {
  showToast: ShowToast;
}

export default function EtutOverviewTab({ showToast }: EtutOverviewTabProps) {
  const { classes } = useClasses();
  const [weekKey, setWeekKey] = useState(getWeekKey());
  const [rows, setRows] = useState<EtutAllDTO[] | null>(null);
  const [mode, setMode] = useState<GroupMode>('teacher');

  const load = useCallback(async (wk: string) => {
    setRows(null);
    try {
      const d = await api<{ etutler?: EtutAllDTO[] }>(`/api/etut-sablon/all?week=${wk}`);
      setRows(d.etutler || []);
    } catch (err) {
      showToast((err as Error).message, 'error');
      setRows([]);
    }
  }, [showToast]);

  useEffect(() => { load(weekKey); }, [load, weekKey]);

  const sortByDayTime = (a: EtutAllDTO, b: EtutAllDTO) =>
    a.dayIndex - b.dayIndex || (a.start || '').localeCompare(b.start || '');

  // Öğretmene göre: tüm slotlar (boş dahil), öğretmen adına göre sıralı.
  const byTeacher = useMemo(() => {
    const map = new Map<string, { name: string; items: EtutAllDTO[] }>();
    for (const e of rows || []) {
      const g = map.get(e.teacherId) || { name: e.teacherName || '?', items: [] };
      g.items.push(e);
      map.set(e.teacherId, g);
    }
    return [...map.values()]
      .map(g => ({ ...g, items: g.items.sort(sortByDayTime) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [rows]);

  // Öğrenciye göre: yalnız atanmış satırlar, öğrenci adına göre sıralı.
  const byStudent = useMemo(() => {
    const map = new Map<string, { name: string; cls: string | null; items: EtutAllDTO[] }>();
    for (const e of rows || []) {
      if (!e.studentId) continue;
      const g = map.get(e.studentId) || { name: e.studentName || '?', cls: e.studentCls ?? null, items: [] };
      g.items.push(e);
      map.set(e.studentId, g);
    }
    return [...map.values()]
      .map(g => ({ ...g, items: g.items.sort(sortByDayTime) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }, [rows]);

  const total = rows?.length ?? 0;
  const dolu = useMemo(() => (rows || []).filter(e => e.studentId).length, [rows]);

  const modeBtn = (m: GroupMode, label: string, Icon: typeof Users) => (
    <button
      onClick={() => setMode(m)}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
      style={mode === m
        ? { fontWeight: 700, background: 'var(--brand, #6366f1)', color: '#fff' }
        : { fontWeight: 600, background: 'var(--surface-2, #f3f4f6)', color: 'var(--text-secondary)' }}
    >
      <Icon size={13} /> {label}
    </button>
  );

  // Tek etüt satırı — iki görünümde de aynı gövde, sol etiket değişir (gün+saat sabit).
  const rowLine = (e: EtutAllDTO, showTeacher: boolean) => (
    <div key={`${e.id}:${e.studentId || 'bos'}`} className="time-block time-etut rounded-xl overflow-hidden">
      <div className="flex items-center px-3 py-2.5 gap-2 min-w-0">
        <span className="text-xs shrink-0" style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{e.dayLabel}</span>
        <span className="time-block__time text-xs shrink-0">{e.start}–{e.end}</span>
        {showTeacher && <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{e.teacherName}</span>}
        {e.studentId ? (
          <>
            {e.branch && <span className="text-xs shrink-0" style={{ fontWeight: 600, color: 'var(--time-etut)' }}>{e.branch}</span>}
            {!showTeacher && (
              <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                {e.studentName}{e.studentCls ? ` · ${classShortUpper(classes, e.studentCls)}` : ''}
              </span>
            )}
            {e.scope === 'RECURRING' && <span className="badge badge-info shrink-0 ml-auto">Her hafta</span>}
          </>
        ) : (
          <span className="text-sm text-gray-400">Boş</span>
        )}
      </div>
    </div>
  );

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          {modeBtn('teacher', 'Öğretmene göre', Users)}
          {modeBtn('student', 'Öğrenciye göre', GraduationCap)}
        </div>
        <WeekNav weekKey={weekKey} onPrev={() => setWeekKey(w => getAdjacentWeek(w, -1))} onNext={() => setWeekKey(w => getAdjacentWeek(w, 1))} />
      </div>

      {rows !== null && total > 0 && (
        <div className="text-caption mb-3">{total} etüt · {dolu} dolu · {total - dolu} boş</div>
      )}

      {rows === null ? (
        <LoadingBox height="h-40" />
      ) : total === 0 ? (
        <EmptyState card icon={Clock} title="Bu hafta tanımlı etüt yok"
          description="Serbest etüt slotları Program Editörü'nden oluşturulur." />
      ) : mode === 'teacher' ? (
        <div className="space-y-2">
          {byTeacher.map(g => (
            <div key={g.name} className="card overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))' }}>
                  <Users size={15} />
                </div>
                <div className="text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{g.name}</div>
                <span className="text-caption ml-auto">{g.items.filter(e => e.studentId).length}/{g.items.length} dolu</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {g.items.map(e => rowLine(e, false))}
              </div>
            </div>
          ))}
        </div>
      ) : byStudent.length === 0 ? (
        <EmptyState card icon={Calendar} title="Bu hafta atanmış etüt yok"
          description="Öğretmenler etütlere öğrenci atadıkça burada öğrenci bazında görünür." />
      ) : (
        <div className="space-y-2">
          {byStudent.map(g => (
            <div key={g.name + (g.cls || '')} className="card overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #000))' }}>
                  <GraduationCap size={15} />
                </div>
                <div className="text-sm" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
                  {g.name}{g.cls ? <span className="text-caption font-normal"> · {classShortUpper(classes, g.cls)}</span> : null}
                </div>
                <span className="text-caption ml-auto">{g.items.length} etüt</span>
              </div>
              <div className="px-3 py-2 space-y-1.5">
                {g.items.map(e => rowLine(e, true))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
