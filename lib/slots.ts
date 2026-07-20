import { ALL_DAYS, daySlots, DEFAULT_WEEKDAY_TIMES, DEFAULT_WEEKEND_TIMES,
  DEFAULT_SLOTS_PER_DAY, MEZUN_ONLY_LESSON_SLOTS, getWeekKey, type SlotTime } from './constants';

// getWeekKey tek kaynak constants.js'te — buradan re-export (mevcut '@/lib/slots' importları kırılmasın)
export { getWeekKey };
import { tdb } from './sqldb';
import { Prisma, type SlotBooking } from '@prisma/client';
import { currentOrg, currentBranch } from './tenant';
import { lockResource } from './etut/reservations';

// ── SLOT SAATLERİ (7-gün model) ───────────────────────────────────────────────
// Depolama şekli (TenantConfig.slotTimes):
//   YENİ: { days: { 0: {count, times:[{start,end}...]}, ..., 6: {...} } }
//   ESKİ: { weekday: [...12], weekend: [...12] }  → okurken 7 güne genişletilir.
// getDaySlotTimes her zaman NORMALİZE 7-gün objesi döndürür (geriye uyum garantili).

export interface DaySlotConfig {
  count: number;
  times: SlotTime[];
}

export interface NormalizedSlotTimes {
  days: Record<number, DaySlotConfig>;
}

// TenantConfig.slotTimes Json alanının olası (eski/yeni) şekli.
interface StoredSlotTimes {
  days?: Record<string | number, { count?: number; times?: SlotTime[] } | undefined>;
  weekday?: SlotTime[];
  weekend?: SlotTime[];
}

// Hücre içeriği — SlotBooking.data Json alanının şekli (grid hücresi).
export interface SlotCell {
  booked?: boolean;
  disabled?: boolean;
  fixed?: boolean;
  lessonType?: string;
  cls?: string;
  subBranch?: string;
  branch?: string;
  studentId?: string | null;
  studentName?: string | null;
  studentCls?: string | null;
  bookedBy?: string | null;
  bookedAt?: string;
  // Etkinlik takvimi entegrasyonu: aktif tatil/etkinlik yüzünden kapalı (route.ts /api/slots GET doldurur).
  eventBlocked?: boolean;
  eventTitle?: string;
}

// Öğretmenin serbest etüt şablonu (programTemplate.etutSablonlari listesi elemanı).
export interface EtutSablonu {
  id: string;
  dayIndex: number;
  start: string;
  end: string;
  aktif?: boolean;
  pasifHaftalar?: string[];
  studentId?: string;
  studentName?: string;
  studentCls?: string;
  branch?: string;
  bookedBy?: string;
  bookedAt?: string;
}

// Bir serbest etüt şablonu verilen haftada efektif aktif mi?
// (kalıcı aktif + bu hafta pasif listesinde değil). etut-sablon/all + mobil today ortak.
export function etutAktifThisWeek(sb: EtutSablonu, weekKey: string): boolean {
  if (sb.aktif === false) return false;
  if (Array.isArray(sb.pasifHaftalar) && sb.pasifHaftalar.includes(weekKey)) return false;
  return true;
}

// Öğretmen program şablonundaki tek giriş (programTemplate Json).
export interface ProgramEntry {
  type?: string;
  cls?: string;
  subBranch?: string;
  branch?: string; // program-solve yerleşiminde ders adı (course); şablonda saklanır
  fixed?: boolean;
  studentId?: string;
  studentName?: string;
  studentCls?: string;
}

// Eski {weekday, weekend} veya null → normalize {days:{0..6:{count,times}}}.
export function normalizeSlotTimes(stored: unknown): NormalizedSlotTimes {
  const s = (stored || {}) as StoredSlotTimes; // Json alanı — şekli çalışma anında doğrulanır
  // Yeni format zaten days taşıyorsa: eksik günleri default'la, count'u times'tan türet.
  if (s && s.days && typeof s.days === 'object') {
    const days: Record<number, DaySlotConfig> = {};
    for (let d = 0; d < 7; d++) {
      const dc = s.days[d] || s.days[String(d)];
      if (dc && Array.isArray(dc.times)) {
        const count = Number.isFinite(dc.count) ? (dc.count as number) : dc.times.length;
        days[d] = { count, times: dc.times.slice(0, count) };
      } else {
        // gün tanımsız → hafta içi/sonu default'una düş
        const times = d >= 5 ? DEFAULT_WEEKEND_TIMES : DEFAULT_WEEKDAY_TIMES;
        days[d] = { count: DEFAULT_SLOTS_PER_DAY, times };
      }
    }
    return { days };
  }
  // Eski {weekday, weekend} → 5+2 güne kopyala.
  const weekday = s?.weekday || DEFAULT_WEEKDAY_TIMES;
  const weekend = s?.weekend || DEFAULT_WEEKEND_TIMES;
  const days: Record<number, DaySlotConfig> = {};
  for (let d = 0; d < 5; d++) days[d] = { count: weekday.length, times: weekday };
  for (let d = 5; d < 7; d++) days[d] = { count: weekend.length, times: weekend };
  return { days };
}

// Normalize 7-gün slot saatleri (her zaman {days:{0..6}}).
export async function getDaySlotTimes(): Promise<NormalizedSlotTimes> {
  const cfg = await tdb().tenantConfig.findFirst();
  return normalizeSlotTimes(cfg?.slotTimes);
}

// Bir günün slot listesi ({id,label,start,end}) — config'ten.
export async function getDaySlots(dayIndex: number) {
  const st = await getDaySlotTimes();
  return daySlots(dayIndex, st.days[dayIndex]);
}

// GERİYE UYUM (deprecated): {weekday, weekend} bekleyen eski çağrılar için.
// 7-gün modelinde weekday = gün0, weekend = gün5 örneği alınır (temsili).
export async function getSlotTimes(): Promise<{ weekday: SlotTime[]; weekend: SlotTime[] }> {
  const st = await getDaySlotTimes();
  return {
    weekday: st.days[0].times,
    weekend: st.days[5].times,
  };
}

// current_week — aktif hafta anahtarı (TenantConfig.currentWeek)
export async function getCurrentWeek(): Promise<string | null> {
  const cfg = await tdb().tenantConfig.findFirst();
  return cfg?.currentWeek || null;
}

export async function setCurrentWeek(weekKey: string): Promise<void> {
  const cfg = await tdb().tenantConfig.findFirst();
  if (cfg) {
    await tdb().tenantConfig.update({
      where: { orgSlug_branch: { orgSlug: cfg.orgSlug, branch: cfg.branch } },
      data: { currentWeek: weekKey },
    });
  } else {
    // orgSlug+branch tdb() tarafından enjekte edilir — tip bunu bilemediği için cast.
    await tdb().tenantConfig.create({ data: { currentWeek: weekKey } as never });
  }
}

// Week key: ISO week string like "2024-W20"
export function getMondayOfWeek(weekKey: string): Date {
  const [year, wStr] = weekKey.split('-W');
  const week = parseInt(wStr);
  const jan4 = new Date(parseInt(year), 0, 4);
  const dayOfWeek = jan4.getDay() || 7;
  const monday = new Date(jan4);
  monday.setDate(jan4.getDate() - dayOfWeek + 1 + (week - 1) * 7);
  return monday;
}

// weekKey'i n hafta ileri/geri taşır
export function shiftWeek(weekKey: string, delta: number): string {
  const mon = getMondayOfWeek(weekKey);
  mon.setDate(mon.getDate() + delta * 7);
  return getWeekKey(mon);
}

// Slot başlangıç anını (TSİ +03) Date olarak döndürür.
// slotLabel formatı: "HH:MM–HH:MM"
export function slotStartTime(weekKey: string, dayIndex: number, slotLabel: string | null | undefined): Date {
  const monday = getMondayOfWeek(weekKey);
  // UTC bazlı tarih oluştur (Türkiye saati TSİ +03)
  const y = monday.getFullYear();
  const m = monday.getMonth();
  const d = monday.getDate() + dayIndex;
  const startStr = (slotLabel || '').split('–')[0]?.split(':') || ['0','0'];
  const hh = parseInt(startStr[0] || '0');
  const mm = parseInt(startStr[1] || '0');
  // Türkiye yerel saatinde slot başlangıcı; UTC'ye -3 saat olarak yaz
  return new Date(Date.UTC(y, m, d, hh - 3, mm));
}

// weekKey, mevcut hafta ile +2 arasında mı? (toplam 3 hafta düzenlenebilir)
export function isEditableWeek(weekKey: string): boolean {
  const current = getWeekKey();
  const w1 = shiftWeek(current, 1);
  const w2 = shiftWeek(current, 2);
  return weekKey === current || weekKey === w1 || weekKey === w2;
}

// SQL yardımcısı: hücre değerini SlotBooking satırından kur
function cellFromRow(row: SlotBooking): SlotCell {
  // data Json varsa kullan (tam hücre içeriği); yoksa scalar alanlara geri düş
  return (row.data as SlotCell | null) || {
    booked: row.booked,
    disabled: row.disabled,
    fixed: row.fixed,
    studentId: row.studentId,
    studentName: row.studentName,
    studentCls: row.studentCls,
    branch: row.dersBranch ?? undefined,
    bookedBy: row.bookedBy,
  };
}

// SQL yardımcısı: program şablonundaki giriş + mevcut hücreden yeni hücre hesapla
// (initWeekForTeacher ile program/route POST aynı mantığı kullanır)
function computeCellFromEntry(entry: ProgramEntry | undefined, existing: SlotCell | undefined): SlotCell {
  // Şablondan gelen sabit DERS
  if (entry && entry.type === 'ders') {
    const gridEntry: SlotCell = {
      booked: false, disabled: true, lessonType: 'ders',
      cls: entry.cls || '', fixed: true,
    };
    // Ders adı: program-solve yerleşimi 'branch' (a.course) alanına, manuel düzenleme
    // 'subBranch' alanına yazıyor. Grid tüketicileri (class-schedule, sınıf ders programı
    // modalı) subBranch/branch okur — ikisine de yaz ki ders adı sınıf programında görünsün.
    const dersAd = entry.subBranch || entry.branch;
    if (dersAd) { gridEntry.subBranch = dersAd; gridEntry.branch = dersAd; }
    return gridEntry;
  }
  // Şablondan gelen sabit ETÜT (rezervasyon)
  if (entry && entry.type === 'etut') {
    if (entry.studentId && entry.fixed) {
      return {
        booked: true, disabled: false, studentId: entry.studentId,
        studentName: entry.studentName || '', studentCls: entry.studentCls || '',
        bookedBy: 'director', fixed: true,
      };
    } else {
      return { booked: false, disabled: false };
    }
  }
  // Geçici dersi koru
  if (existing && existing.lessonType === 'ders' && existing.fixed === false) {
    return existing;
  }
  // Geçici etüt rezervasyonunu koru
  if (existing && existing.booked && existing.fixed === false) {
    return existing;
  }
  // Hiçbir şey → kapalı
  return { booked: false, disabled: true };
}

// SQL yardımcısı: SlotBooking satırı için scalar alanları hücre nesnesinden çıkar
function scalarFromCell(cell: SlotCell) {
  return {
    booked: cell.booked ?? false,
    disabled: cell.disabled ?? true,
    fixed: cell.fixed ?? false,
    studentId: cell.studentId || null,
    studentName: cell.studentName || null,
    studentCls: cell.studentCls || null,
    dersBranch: cell.branch || null,
    bookedBy: cell.bookedBy || null,
    data: cell as object,
  };
}

// Bir haftanın slotlarını program'a göre init eder.
export async function initWeekForTeacher(legacyTeacherId: string, weekKey: string): Promise<void> {
  const orgSlug = currentOrg(); const branch = currentBranch();
  const teacher = await tdb(orgSlug, branch).teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return;
  const hasGroups = teacher.allowedGroups && teacher.allowedGroups.length > 0;
  const offDays = new Set(teacher.offDays || []);
  // programTemplate Json — gün → slotId → giriş şeklinde saklanır
  const program = (teacher.programTemplate || {}) as Record<string, Record<string, ProgramEntry | undefined> | undefined>;

  // Slot saatleri (TenantConfig) — yarış konusu değil, tx dışında okunabilir.
  const slotTimes = await getDaySlotTimes();

  // Faz 4 Y3: hafta-grid yeniden kurulumu (initWeek) ile eşzamanlı slot rezervasyonu
  // (/api/slots POST/DELETE) arasındaki yarış — okuma (existingRows) ile deleteMany
  // arasında commit olan bir booking sessizce kayboluyordu (deleteMany hepsini silip
  // createMany şablondan yeniden kuruyordu, araya giren rezervasyonu görmeden). slotweek
  // kilidi /api/slots POST/DELETE ile TAM AYNI anahtar formülünü kullanır (aşağıda) —
  // üçü de aynı öğretmen+hafta üzerinde serileşir. Kilit sırası GLOBAL: slotweek →
  // slot-cell → student; initWeek yalnız slotweek alır (tek kaynak, hücre/öğrenci
  // kilidine ihtiyaç yok — tüm hafta tek seferde sıfırdan kuruluyor).
  await tdb(orgSlug, branch).$transaction(async (rawTx) => {
    const tx = rawTx as unknown as Prisma.TransactionClient; // booking.ts'teki tip köprüsü gerekçesi (Exact<>/SelectSubset<> uyuşmazlığı)
    await lockResource(tx, `slotweek:${orgSlug}:${branch}:${weekKey}:${teacher.id}`);

    // Mevcut SlotBooking satırlarını oku (geçici rezervasyonları korumak için) — kilit
    // ALINDIKTAN SONRA, TAZE (aksi halde yarış penceresi kapanmaz). tx raw client olduğu
    // için $extends tenant-enjeksiyonundan geçmez — orgSlug/branch AÇIKÇA where'de.
    const existingRows = await tx.slotBooking.findMany({ where: { orgSlug, branch, weekKey, teacherId: teacher.id } });
    const existingByKey: Record<string, SlotCell> = {};
    for (const row of existingRows) {
      existingByKey[`${row.dayIndex}:${row.slotId}`] = cellFromRow(row);
    }

    // Her slot için yeni hücre değeri hesapla (7-gün model: her gün kendi slotları)
    const newRows: object[] = [];
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
      for (let slotNo = 1; slotNo <= slots.length; slotNo++) {
        const slot = slots[slotNo - 1];
        const entry = program[String(day.index)]?.[slot.id];
        const existing = existingByKey[`${day.index}:${slot.id}`];
        let cell: SlotCell;

        // Mezun-only kuralı: hafta içi (gün<5) ilk 6 slot yalnız mezun öğretmene açık.
        // Eski id-bazlı (w1-w6) kontrol → slot NUMARASINA taşındı (güne özgü id'lerde geçerli).
        const isMezunOnlySlot = day.index < 5 && slotNo <= MEZUN_ONLY_LESSON_SLOTS.length;

        if (!hasGroups) {
          // Grup etiketi (allowedGroups) olmasa bile müdürün elle/çözücüyle yazdığı sabit
          // DERS grid'e materyalize edilmeli. Aksi halde ders öğretmen şablonunda görünür
          // ama sınıf kartı / yoklama grid'i (SlotBooking okuyan taraf) dersi göremez —
          // asimetri buradan doğuyordu. Boş/etüt/available slotları kapalı kalmaya devam eder.
          cell = (entry?.type === 'ders' && !offDays.has(day.index))
            ? computeCellFromEntry(entry, existing)
            : { booked: false, disabled: true };
        } else if (offDays.has(day.index)) {
          cell = { booked: false, disabled: true };
        } else if (isMezunOnlySlot) {
          const groups = teacher.allowedGroups || [];
          const onlyMezun = groups.length > 0 && groups.every(g => g === 'mezun');
          // Route paritesi (program/route.ts): müdür bu slota DERS yazdıysa (mezun
          // sınıfı veya sınıf-penceresi istisnası orada doğrulanır) şablon girdisi
          // karma-gruplu öğretmende de materyalize olmalı. Aksi hâlde ders öğretmen
          // panelinde (şablon) görünürken grid'e hiç düşmez → müdür yoklama özeti
          // ve devamsızlık slot etiketi dersi göremez. Etüt/boş slotlar karma
          // öğretmen için kapalı kalmaya devam eder (kural amacı korunur).
          if (!onlyMezun && entry?.type !== 'ders') {
            cell = { booked: false, disabled: true };
          } else {
            cell = computeCellFromEntry(entry, existing);
          }
        } else {
          cell = computeCellFromEntry(entry, existing);
        }

        newRows.push({
          orgSlug, branch, weekKey, teacherId: teacher.id, dayIndex: day.index, slotId: slot.id,
          ...scalarFromCell(cell),
        });
      }
    }

    // Eski satırları sil, yenilerini oluştur — tx client'la, tenant AÇIKÇA (raw tx $extends
    // enjeksiyonundan GEÇMEZ — Faz 2a bulgusu; createMany'de orgSlug/branch newRows'a
    // yukarıda elle eklendi).
    await tx.slotBooking.deleteMany({ where: { orgSlug, branch, weekKey, teacherId: teacher.id } });
    if (newRows.length > 0) await tx.slotBooking.createMany({ data: newRows as never });
  });
}

// Tüm günler ve slotlar için grid döndürür (7-gün model)
export async function getTeacherWeekSlots(legacyTeacherId: string, weekKey: string): Promise<Record<number, SlotCell[]>> {
  const slotTimes = await getDaySlotTimes();
  const daySlotList: Record<number, { id: string }[]> = {}; // dayIndex → slot[] (id eşlemesi için)
  const grid: Record<number, SlotCell[]> = {};
  for (const day of ALL_DAYS) {
    const slots = daySlots(day.index, slotTimes.days[day.index]);
    daySlotList[day.index] = slots;
    grid[day.index] = slots.map(() => ({ booked: false, disabled: true }));
  }
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return grid;
  const rows = await tdb().slotBooking.findMany({ where: { weekKey, teacherId: teacher.id } });
  for (const row of rows) {
    const slots = daySlotList[row.dayIndex] || [];
    const slotIdx = slots.findIndex(s => s.id === row.slotId);
    if (slotIdx >= 0) grid[row.dayIndex][slotIdx] = cellFromRow(row);
  }
  return grid;
}

export async function getAllTeachers() {
  const rows = await tdb().teacher.findMany();
  return rows.map(t => ({
    id: t.legacyId, name: t.name, branches: t.branches,
    allowedGroups: t.allowedGroups, offDays: t.offDays,
    username: t.username, phone: t.phone || null, photoUrl: t.photoUrl || null,
  }));
}

// Bir günün TÜM öğretmen hücreleri TEK sorguda (mobil "Bugün" ekranı). Öğretmen
// başına getTeacherWeekSlots çağırmak yerine: 1 teacher + 1 slotBooking sorgusu.
export interface DayCellRow {
  teacherLegacyId: string;
  teacherName: string;
  slotId: string;
  cell: SlotCell;
}
export async function getDayCellsAllTeachers(weekKey: string, dayIndex: number): Promise<DayCellRow[]> {
  const teachers = await tdb().teacher.findMany({ select: { id: true, legacyId: true, name: true } });
  const byDbId = new Map(teachers.map((t) => [t.id, t]));
  const rows = await tdb().slotBooking.findMany({ where: { weekKey, dayIndex } });
  const out: DayCellRow[] = [];
  for (const row of rows) {
    const t = byDbId.get(row.teacherId);
    if (!t) continue;
    out.push({ teacherLegacyId: t.legacyId, teacherName: t.name, slotId: row.slotId, cell: cellFromRow(row) });
  }
  return out;
}

// Bir HAFTANIN tüm öğretmen hücreleri TEK sorguda, güne göre gruplu (mobil haftalık
// program). getDayCellsAllTeachers'ın 7-gün kardeşi: dayIndex filtresi kalkar,
// çıktı gün → hücreler. 1 teacher + 1 slotBooking sorgusu (tüm hafta).
export async function getWeekCellsAllTeachers(weekKey: string): Promise<Record<number, DayCellRow[]>> {
  const teachers = await tdb().teacher.findMany({ select: { id: true, legacyId: true, name: true } });
  const byDbId = new Map(teachers.map((t) => [t.id, t]));
  const rows = await tdb().slotBooking.findMany({ where: { weekKey } });
  const out: Record<number, DayCellRow[]> = {};
  for (const row of rows) {
    const t = byDbId.get(row.teacherId);
    if (!t) continue;
    (out[row.dayIndex] ??= []).push({ teacherLegacyId: t.legacyId, teacherName: t.name, slotId: row.slotId, cell: cellFromRow(row) });
  }
  return out;
}

// Tüm öğretmenlerin program şablonları TEK sorguda (etüt şablonu taraması için).
export interface TeacherTemplateRow {
  legacyId: string;
  name: string;
  template: Record<string, unknown>;
}
export async function getAllProgramTemplates(): Promise<TeacherTemplateRow[]> {
  const rows = await tdb().teacher.findMany({ select: { legacyId: true, name: true, programTemplate: true } });
  return rows.map((r) => ({ legacyId: r.legacyId, name: r.name, template: (r.programTemplate || {}) as Record<string, unknown> }));
}

export async function getAllStudents() {
  const rows = await tdb().student.findMany({ include: { class: true } });
  return rows.map(s => ({
    id: s.legacyId, name: s.name, cls: s.class?.legacyId || null,
    group: s.group, phone: s.phone || null,
  }));
}

// program:{legacyTeacherId} objesini oku (grid + etutSablonlari)
export async function getProgramTemplate(legacyTeacherId: string) {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  return (teacher?.programTemplate || {}) as Record<string, unknown>;
}

// program:{legacyTeacherId} objesini yaz (grid + etutSablonlari)
export async function setProgramTemplate(legacyTeacherId: string, data: object): Promise<void> {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return;
  await tdb().teacher.update({ where: { id: teacher.id }, data: { programTemplate: data } });
}

// program şablonunu sil (null yap). Prisma Json alanında DB NULL için DbNull kullanılır
// (eski koddaki düz null'ın çalışma zamanı karşılığı — DB etkisi birebir aynı).
export async function deleteProgramTemplate(legacyTeacherId: string): Promise<void> {
  const teacher = await tdb().teacher.findFirst({ where: { legacyId: legacyTeacherId } });
  if (!teacher) return;
  await tdb().teacher.update({ where: { id: teacher.id }, data: { programTemplate: Prisma.DbNull } });
}

// ── ETKİNLİK TAKVİMİ ENTEGRASYONU (tatil/sınav vb. → slot otomatik pasifleşmesi) ──────────────

function toYmd(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// weekKey + gün indexi (0=Pzt..6=Paz) → o günün takvim tarihi (YYYY-MM-DD).
export function dateStrForWeekDay(weekKey: string, dayIndex: number): string {
  const d = getMondayOfWeek(weekKey);
  d.setDate(d.getDate() + dayIndex);
  return toYmd(d);
}

export interface EtkinlikBlock {
  title: string;
  type: string;
  startTime?: string;
  endTime?: string;
  classes: string[];
}

// Etkinlik.data Json şeklinin bu modülün ihtiyaç duyduğu alt kümesi (route.ts'teki EtkinlikData ile örtüşür).
interface EtkinlikDataForBlock {
  classes?: string[];
  startTime?: string;
  endTime?: string;
}

// Bir haftanın (Pazartesi..Pazar) her günü için aktif etkinlikleri TEK sorguda getirir.
// Tarih aralığı çakışan tüm Etkinlik satırları çekilir, sonra 7 güne dağıtılır (N+1 önlenir).
export async function getWeekEvents(weekKey: string): Promise<Map<string, EtkinlikBlock[]>> {
  const monday = getMondayOfWeek(weekKey);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const mondayStr = toYmd(monday), sundayStr = toYmd(sunday);

  const rows = await tdb().etkinlik.findMany({
    where: { startDate: { lte: sundayStr }, OR: [{ endDate: null }, { endDate: { gte: mondayStr } }] },
  });

  const map = new Map<string, EtkinlikBlock[]>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const ds = toYmd(d);
    const active = rows
      .filter(r => r.startDate <= ds && (!r.endDate || r.endDate >= ds))
      .map(r => {
        const data = (r.data as EtkinlikDataForBlock | null) || {};
        return {
          title: r.title, type: r.type,
          startTime: data.startTime, endTime: data.endTime,
          classes: Array.isArray(data.classes) ? data.classes : [],
        };
      });
    if (active.length) map.set(ds, active);
  }
  return map;
}

// Verilen gün için aktif etkinlik listesi içinde, hedef sınıf + slot saat aralığıyla çakışan
// bir engelleyici var mı? classId null ise yalnız kurum geneli (sınıf hedefsiz) etkinlikler sayılır
// (grid seviyesi görsel kapatma — henüz öğrenciye özel değil). classId verilirse sınıf-hedefli
// etkinlikler de dahil edilir (rezervasyon anındaki gerçek kontrol).
export function findBlockingEvent(
  events: EtkinlikBlock[] | undefined, classId: string | null, slotStart: string, slotEnd: string,
): EtkinlikBlock | null {
  if (!events || events.length === 0) return null;
  for (const ev of events) {
    const isGeneral = ev.classes.length === 0;
    if (!isGeneral && (!classId || !ev.classes.includes(classId))) continue;
    if (ev.startTime && ev.endTime && !(slotStart < ev.endTime && slotEnd > ev.startTime)) continue;
    return ev;
  }
  return null;
}
