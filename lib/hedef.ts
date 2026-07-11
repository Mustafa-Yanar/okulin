import { getWeekKey } from '@/lib/slots';
import { tdb, withScope } from '@/lib/sqldb';

// Haftalık hedef (soru çözüm hedefi) servis katmanı — guidance verisini TÜKETİR, çoğaltmaz.
// "Çözülen soru" = guidance entries'teki correct+wrong+empty toplamı (D+Y+B).
// Route yalnız yetki (session-bazlı) + response. (Bu uçta HttpError yok; auth route'ta.)

// Guidance.data Json şekli: { entries: { [ders]: { correct, wrong, empty } } }
interface GuidanceData {
  entries?: Record<string, { correct?: number | string; wrong?: number | string; empty?: number | string } | null>;
}

function sumWeek(data: GuidanceData | null | undefined): number {
  if (!data || !data.entries) return 0;
  let total = 0;
  for (const v of Object.values(data.entries)) {
    if (!v || typeof v !== 'object') continue;
    total += (parseInt(String(v.correct)) || 0) + (parseInt(String(v.wrong)) || 0) + (parseInt(String(v.empty)) || 0);
  }
  return total;
}

export interface GoalData {
  studentId: string;
  weekly: number;
  setBy: string | null;
  setByName: string | null;
  updatedAt: string | null;
  weekKey: string;
  thisWeekSolved: number;
  history: { weekKey: string; solved: number }[];
}

// Bir öğrencinin hedefi + bu hafta çözdüğü + son 8 haftanın geçmişi.
// (canEdit response'a route tarafından eklenir — session'a bağlı.)
export async function getGoal(studentId: string): Promise<GoalData> {
  const weekKey = getWeekKey();
  const rows = await tdb().guidance.findMany({ where: { studentId } });
  let thisWeekSolved = 0;
  const history = rows.map(r => {
    const solved = sumWeek(r.data as GuidanceData | null);
    if (r.week === weekKey) thisWeekSolved = solved;
    return { weekKey: r.week, solved };
  })
    .filter(h => h.solved > 0)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey))
    .slice(0, 8);
  const goal = await tdb().hedef.findFirst({ where: { studentId } });
  return {
    studentId,
    weekly: goal?.weekly || 0,
    setBy: goal?.setBy || null,
    setByName: goal?.setByName || null,
    updatedAt: goal?.updatedAt ? (goal.updatedAt instanceof Date ? goal.updatedAt.toISOString() : goal.updatedAt) : null,
    weekKey,
    thisWeekSolved,
    history,
  };
}

// Hedef koy/güncelle. weekly=0 → hedefi temizle (anahtarı sil). Döner: uygulanan weekly.
export async function setGoal(input: { studentId: string; weekly: number; setByRole: string; setByName: string | null }): Promise<number> {
  const { studentId, weekly, setByRole, setByName } = input;
  if (weekly === 0) {
    await tdb().hedef.deleteMany({ where: { studentId } });
    return 0;
  }
  const existing = await tdb().hedef.findFirst({ where: { studentId } });
  const data = { weekly, setBy: setByRole, setByName, updatedAt: new Date() };
  if (existing) await tdb().hedef.update({ where: { id: existing.id }, data });
  else await tdb().hedef.create({ data: withScope({ studentId, ...data }) });
  return weekly;
}
