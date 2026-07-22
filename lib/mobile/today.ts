import { tdb } from '@/lib/sqldb';
import { ALL_DAYS, daySlots } from '@/lib/constants';
import {
  getTeacherWeekSlots, getDaySlotTimes, getDayCellsAllTeachers,
} from '@/lib/slots';
import { listEtutlerForWeek } from '@/lib/etut/rezervasyon';
import { getOrgConfig } from '@/lib/config';
import { listOdevForStudent, listOdevForParent } from '@/lib/odev';
import { getStudentBehavior } from '@/lib/davranis';
import { buildStudentPoints } from '@/lib/deneme/store';
import { HttpError } from '@/lib/errors';
import type { PaymentEntry } from '@/lib/finance';
import type { Session } from '@/lib/auth';
import type {
  StudentToday, ParentToday, TeacherToday, ManagementToday,
  TodayLesson, TodayEtut, TodayOdevItem, TeacherSlotView, ParentChildView, TodayCommon,
} from './api-types';

// "Bugün" ekranı servis katmanı (spec §5.1/§9-1): mevcut lib servislerini rol-aware
// birleştirir, YENİ veri modeli yok. Tüm sorgular tdb() ile tenant-scoped; rol sınırı
// çağıran route'ta withMobileAuth claim'lerinden gelir (öğrenci kendi cls/id'si,
// veli yalnız payload children'ı, öğretmen kendi programı).

export interface TrToday {
  date: string; // YYYY-MM-DD
  dayIndex: number; // 0=Pazartesi … 6=Pazar
  dayLabel: string;
  weekKey: string; // "2026-W29"
}

// TR günü/haftası — sunucu TZ'inden bağımsız (Vercel=UTC, dev=TR fark etmez):
// TR = UTC+3 SABİT (DST yok) → şimdiye 3 saat ekle, UTC bileşenleriyle oku.
// getWeekKey (lib/constants) yerel saat kullanır; TR 00:00-03:00 penceresinde
// "bugün" bir gün geri kayardı — bu yüzden ISO hafta burada UTC ile yeniden hesaplanır.
export function trToday(now: Date = new Date()): TrToday {
  const tr = new Date(now.getTime() + 3 * 3600 * 1000);
  const y = tr.getUTCFullYear();
  const m = tr.getUTCMonth();
  const d = tr.getUTCDate();
  const date = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dayIndex = (tr.getUTCDay() + 6) % 7;
  const iso = new Date(Date.UTC(y, m, d));
  iso.setUTCDate(iso.getUTCDate() + 4 - (iso.getUTCDay() || 7));
  const yearStart = Date.UTC(iso.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((iso.getTime() - yearStart) / 86400000 + 1) / 7);
  return {
    date,
    dayIndex,
    dayLabel: ALL_DAYS[dayIndex]?.label ?? '',
    weekKey: `${iso.getUTCFullYear()}-W${String(week).padStart(2, '0')}`,
  };
}

// 'YYYY-MM-DD' biçimli vade bugünden önce mi (string karşılaştırma; biçim dışı false —
// taksit vadesi date-input'tan gelir, yine de savunmacı).
export function isPastDue(dueDate: string | null | undefined, today: string): boolean {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) return false;
  return dueDate.slice(0, 10) < today;
}

export interface OdevListRow {
  id: string;
  title: string;
  branch: string;
  dueDate: string;
  sub: unknown;
}

// Ödev listesinden bekleyenleri seç: teslim edilmemiş HER ödev bekler — vadesi
// geçmiş olan da (İnceleme Codex #5: geçmişi elemek "bekleyen ödev yok" yanılgısı
// üretirdi; overdue işaretlenir, UI kırmızı vurgular). items: vade artan (geçmişler
// doğal olarak önce, vadesizler sonda), max ile kırpılır; pending toplam sayıdır.
export function pickPendingOdev(list: OdevListRow[], today: string, max = 3): { pending: number; items: TodayOdevItem[] } {
  const pending = list.filter((o) => !o.sub);
  const sorted = [...pending].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  return {
    pending: pending.length,
    items: sorted.slice(0, max).map((o) => ({
      id: o.id,
      title: o.title,
      branch: o.branch,
      dueDate: o.dueDate,
      submitted: false,
      overdue: isPastDue(o.dueDate, today),
    })),
  };
}

function common(t: TrToday, unread: number): TodayCommon {
  return { date: t.date, dayLabel: t.dayLabel, weekKey: t.weekKey, unreadNotifications: unread };
}

// Bir sınıfın BUGÜNKÜ dersleri + (istenirse) bir öğrencinin bugünkü etüt rezervasyonları.
// class-schedule route'unun gün-filtreli paritesi — ama öğretmen-başına sorgu YOK
// (İnceleme Codex #6): tüm hücreler getDayCellsAllTeachers (1 teacher + 1 slotBooking),
// etüt rezervasyonları listEtutlerForWeek (Faz 3, tablo-tabanlı, 1 sorgu seti). Toplam sabit sorgu sayısı.
async function collectClassDay(
  cls: string,
  weekKey: string,
  dayIndex: number,
  etutStudentId: string | null,
): Promise<{ lessons: TodayLesson[]; etuts: TodayEtut[] }> {
  const slotTimes = await getDaySlotTimes();
  const slots = daySlots(dayIndex, slotTimes.days[dayIndex]);
  const labelBySlotId = new Map(slots.map((s) => [s.id, s.label]));
  const idxBySlotId = new Map(slots.map((s, i) => [s.id, i]));

  const lessons: TodayLesson[] = [];
  for (const r of await getDayCellsAllTeachers(weekKey, dayIndex)) {
    const sd = r.cell;
    if (!sd || sd.lessonType !== 'ders' || sd.cls !== cls) continue;
    lessons.push({
      slotId: r.slotId,
      slotLabel: labelBySlotId.get(r.slotId) ?? '',
      teacherId: r.teacherLegacyId,
      teacherName: r.teacherName,
      branch: sd.branch || sd.subBranch || '',
      subBranch: sd.subBranch || '',
    });
  }
  // Satırlar slotBooking sırasıyla gelir — günün slot dizilimine göre sırala
  // (slotLabel lexicographic DEĞİL: "9:45" vs "10:20" yanılttığı için index kullanılır).
  lessons.sort((a, b) => (idxBySlotId.get(a.slotId) ?? 99) - (idxBySlotId.get(b.slotId) ?? 99));

  const etuts: TodayEtut[] = [];
  if (etutStudentId) {
    // Faz 3: EtutSablon+EtutReservation tablosundan efektif okuma (bayat JSON değil).
    // listEtutlerForWeek deletedAt:null + efektif-aktiflik + WEEK-ezer-RECURRING'i içerir.
    for (const r of await listEtutlerForWeek(weekKey)) {
      if (r.dayIndex !== dayIndex || r.studentId !== etutStudentId) continue; // yalnız KENDİ rezervasyonu (veri minimizasyonu)
      etuts.push({
        id: r.id, start: r.start, end: r.end,
        teacherName: r.teacherName, branch: r.branch,
        studentName: r.studentName, booked: true,
      });
    }
    etuts.sort((a, b) => a.start.localeCompare(b.start));
  }
  return { lessons, etuts };
}

export async function buildStudentToday(session: Session, unread: number): Promise<StudentToday> {
  const t = trToday();
  const mods = await getOrgConfig('modules');
  const me = String(session.id ?? '');
  const cls = String(session.cls ?? '');
  const etutOn = mods.etut !== false;
  const { lessons, etuts } = await collectClassDay(cls, t.weekKey, t.dayIndex, etutOn ? me : null);

  let odev: StudentToday['odev'] = null;
  if (mods.odev !== false) {
    const rows = await listOdevForStudent(cls, me);
    odev = pickPendingOdev(
      rows.map((r) => ({ id: r.id, title: r.title, branch: r.branch, dueDate: r.dueDate, sub: r.sub })),
      t.date,
    );
  }
  let davranis: StudentToday['davranis'] = null;
  if (mods.davranis !== false) {
    davranis = { total: (await getStudentBehavior(me)).total };
  }
  let deneme: StudentToday['deneme'] = null;
  if (mods.deneme !== false) {
    const points = await buildStudentPoints(me); // eskiden yeniye
    const last = points[points.length - 1];
    // toplamNet kaynak tipte optional (DenemeRow) — strict build için ?? 0 (Codex #3).
    if (last) deneme = { name: last.name, dateLabel: last.dateLabel, toplamNet: last.toplamNet ?? 0, rank: last.rank, total: last.total };
  }
  return { role: 'student', ...common(t, unread), lessons, etuts: etutOn ? etuts : null, odev, davranis, deneme };
}

export async function buildParentToday(session: Session, unread: number, childId: string | null): Promise<ParentToday> {
  const t = trToday();
  const mods = await getOrgConfig('modules');
  const children: ParentChildView[] = (session.children ?? [])
    .map((c) => (typeof c === 'string' ? null : { id: String(c.id ?? ''), name: String(c.name ?? ''), cls: String(c.cls ?? '') }))
    .filter((c): c is ParentChildView => c != null && c.id !== '');

  // Çocuk sınırı: yalnız oturum payload'ındaki children (web canReadStudent paritesi).
  if (childId && !children.some((c) => c.id === childId)) {
    throw new HttpError(403, 'Bu öğrenciye erişim yetkiniz yok');
  }
  const chosen = (childId ? children.find((c) => c.id === childId) : children[0]) ?? null;
  if (!chosen) return { role: 'parent', ...common(t, unread), children, child: null };

  const etutOn = mods.etut !== false;
  const { lessons, etuts } = await collectClassDay(chosen.cls, t.weekKey, t.dayIndex, etutOn ? chosen.id : null);

  let odev: NonNullable<ParentToday['child']>['odev'] = null;
  if (mods.odev !== false) {
    const rows = await listOdevForParent([{ id: chosen.id, name: chosen.name, cls: chosen.cls }]);
    odev = pickPendingOdev(
      rows.map((r) => ({ id: r.id, title: r.title, branch: r.branch, dueDate: r.dueDate, sub: r.children[0]?.sub ?? null })),
      t.date,
    );
  }

  let finance: NonNullable<ParentToday['child']>['finance'] = null;
  if (mods.finance !== false) {
    const stu = await tdb().student.findFirst({
      where: { legacyId: chosen.id },
      include: { finance: { include: { installments: { orderBy: { idx: 'asc' } } } } },
    });
    const f = stu?.finance;
    if (f) {
      const payments = (f.payments as unknown as PaymentEntry[] | null) || [];
      const balance = f.netFee - payments.reduce((s, p) => s + (p.amount || 0), 0);
      const unpaid = (f.installments || []).filter((i) => !i.paid);
      const next = unpaid[0] ?? null;
      finance = {
        netFee: f.netFee,
        balance,
        nextInstallment: next ? { idx: next.idx, dueDate: next.dueDate ?? '', amount: next.amount } : null,
        overdueCount: unpaid.filter((i) => isPastDue(i.dueDate, t.date)).length,
      };
    }
  }

  return {
    role: 'parent', ...common(t, unread), children,
    child: { id: chosen.id, name: chosen.name, cls: chosen.cls, lessons, etuts: etutOn ? etuts : null, odev, finance },
  };
}

export async function buildTeacherToday(session: Session, unread: number): Promise<TeacherToday> {
  const t = trToday();
  const mods = await getOrgConfig('modules');
  const me = String(session.id ?? '');

  const grid = await getTeacherWeekSlots(me, t.weekKey);
  const slotTimes = await getDaySlotTimes();
  const slots = daySlots(t.dayIndex, slotTimes.days[t.dayIndex]);
  const lessons: TeacherSlotView[] = [];
  (grid[t.dayIndex] || []).forEach((sd, i) => {
    // Yalnız ders hücreleri; boş/disabled gösterilmez. Etütler ayrı `etuts` dizisinden
    // (EtutReservation) gelir — eski SlotBooking booked-hücre kaynağı B3/dalga2'de kaldırıldı.
    if (!sd || sd.lessonType !== 'ders') return;
    const slot = slots[i];
    lessons.push({
      slotId: slot?.id ?? '',
      slotLabel: slot?.label ?? '',
      type: 'ders',
      cls: sd.cls || null,
      studentName: null,
      branch: sd.branch || sd.subBranch || '',
    });
  });

  let etuts: TodayEtut[] | null = null;
  if (mods.etut !== false) {
    // Faz 3: öğretmenin bugünkü şablonları + efektif doluluk tablodan.
    etuts = (await listEtutlerForWeek(t.weekKey))
      .filter((r) => r.teacherId === me && r.dayIndex === t.dayIndex)
      .map((r) => ({
        id: r.id, start: r.start, end: r.end,
        teacherName: String(session.name ?? ''), branch: r.branch,
        studentName: r.studentName, booked: r.booked,
      }));
    // listEtutlerForWeek zaten gün+saat sıralı — ek sort gerekmez.
  }

  return { role: 'teacher', ...common(t, unread), lessons, etuts };
}

// Yönetim rolleri (director/accountant/counselor/org_admin): native içerik 2. dalga
// (spec §5.1) — karşılama + WebView girişi istemcide; uç yalnız ortak alanları döner.
export function buildManagementToday(_session: Session, unread: number): ManagementToday {
  return { role: 'management', ...common(trToday(), unread) };
}
