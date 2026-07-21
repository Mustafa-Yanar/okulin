import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import {
  getWeekKey, getMondayOfWeek, initWeekForTeacher,
  getAllTeachers, getCurrentWeek, setCurrentWeek, getTeacherWeekSlots, getDaySlotTimes,
} from '@/lib/slots';
import { ALL_DAYS, daySlots } from '@/lib/constants';
import { listActiveTenants, runWithTenant, type TenantRef } from '@/lib/tenant';
import { freezeRecurringWeek } from '@/lib/etut/history';
import { shouldRollWeek, shiftWeekKey } from '@/lib/etut/weeks';

// Pazar 11:00 UTC+3 = 08:00 UTC → "0 8 * * 0"
// Bilinçli withAuth istisnası: cron ucu — oturum yok, CRON_SECRET Bearer doğrulanır.
// Öğretmen listesi / current_week / slot okuma / hafta init SQL'den.
// NOT: haftalık arşiv (archive:teacher|student) hâlâ Redis — arşiv alt-sistemi SQL'e
// taşınmadı (okuyan /api/archive de Redis). Tutarlı; ayrı bir göç işi.
// ÇOK-KURUM: aktif tüm kurum×şube üzerinde döner (runWithTenant); içindeki slots/redis
// çağrıları o kurumun bağlamına otomatik yönlenir (lib/db tenant-scoped Redis, tdb() SQL).

// Bir kurumu mevcut haftaya sıfırlar (düzeltme modu).
async function resetTenant(): Promise<{ weekKey: string }> {
  const current = getWeekKey();
  await setCurrentWeek(current);
  return { weekKey: current };
}

// Bir kurumu bir sonraki haftaya taşır: bu haftayı arşivle + tüm öğretmenlerin yeni
// haftasını init et + current_week'i ilerlet.
async function rollTenant(): Promise<{ previousWeek: string; newWeek: string; teachers: number; frozenEtut: number } | { message: string }> {
  const teachers = await getAllTeachers(); // SQL-aware (legacyId + name)
  if (!teachers || teachers.length === 0) return { message: 'No teachers' };

  const stored = await getCurrentWeek();
  const currentWeek = stored || getWeekKey();

  // Rollover idempotency guard (Faz 4 FIX-1, Codex kritik bulgusu): stored current_week
  // takvimden İLERİDEyse devir bu koşuda ZATEN yapılmıştır (retry/manuel çifte tetik) →
  // atla, hafta ATLAMASIN. Sınır: eşzamanlı (milisaniye-içi) çifte tetik hâlâ teorik bir
  // yarış — cron tek kaynaklı (Vercel schedule) olduğundan pratik risk kabul edildi;
  // gerekirse advisory-lock'lu bir weekly-roll marker tablosu Faz 5+'a bırakıldı.
  const actual = getWeekKey();
  if (!shouldRollWeek(currentWeek, actual)) {
    return { message: `Devir zaten yapılmış (stored=${currentWeek}, takvim=${actual})` };
  }

  const monday = getMondayOfWeek(currentWeek);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  const nextWeek = getWeekKey(nextMonday);

  // 1. Her öğretmenin bu haftaki booked slotlarını SQL grid'inden topla (arşiv için)
  const teacherArchiveMap: Record<string, object[]> = {}; // teacherId -> entries[]
  const studentArchiveMap: Record<string, object[]> = {}; // studentId -> entries[]
  const slotTimes = await getDaySlotTimes(); // 7-gün model

  for (const t of teachers) {
    const grid = await getTeacherWeekSlots(t.id, currentWeek); // SQL-aware
    for (const day of ALL_DAYS) {
      const slots = daySlots(day.index, slotTimes.days[day.index]);
      (grid[day.index] || []).forEach((sd, slotIdx) => {
        if (!sd || !sd.booked) return;
        const slot = slots[slotIdx];
        const entry = {
          day: day.index,
          dayLabel: day.label,
          slotId: slot?.id,
          slotLabel: slot?.label,
          studentId: sd.studentId,
          studentName: sd.studentName,
          studentCls: sd.studentCls,
          bookedBy: sd.bookedBy,
          fixed: !!sd.fixed,
          teacherId: t.id,
          teacherName: t.name,
          branch: sd.branch || '',
        };
        (teacherArchiveMap[t.id] ||= []).push(entry);
        if (sd.studentId) (studentArchiveMap[sd.studentId] ||= []).push(entry);
      });
    }
  }

  // 2. Arşivleri Redis'e yaz (arşiv alt-sistemi Redis — yukarıdaki NOT). lib/db
  //    tenant-scoped → anahtarlar runWithTenant bağlamındaki kuruma prefix'lenir.
  const writePipeline = redis.pipeline();
  let hasWriteOps = false;
  for (const [tid, entries] of Object.entries(teacherArchiveMap)) {
    writePipeline.set(`archive:teacher:${tid}:${currentWeek}`, entries);
    hasWriteOps = true;
  }
  for (const [sid, entries] of Object.entries(studentArchiveMap)) {
    writePipeline.set(`archive:student:${sid}:${currentWeek}`, entries);
    hasWriteOps = true;
  }
  if (hasWriteOps) await writePipeline.exec();

  // 2b. Faz 4: biten haftanın efektif RECURRING etüt rezervasyonlarını somut WEEK satırlarına
  // dondur (spec §3.3 freeze-on-rollover) — recurring sahibi sonradan değişse/iptal edilse
  // bile geçmiş haftaların görünümü (arşiv/geçmiş listeleri) değişmez. Freeze hatası rollover'ı
  // DURDURMAMALI (öğretmen init + hafta ilerletme daha kritik) — best-effort, -1 ile raporla.
  // Freeze self-heal (Faz 4 FIX-1, Codex Y2): geçmiş koşularda freeze hata verdiyse boşluk
  // kalmasın diye biten hafta + önceki 2 hafta idempotent dondurulur (donmuşta count=0).
  let frozenEtut = 0;
  try {
    for (const wk of [shiftWeekKey(currentWeek, -2), shiftWeekKey(currentWeek, -1), currentWeek]) {
      frozenEtut += await freezeRecurringWeek(wk);
    }
  } catch (e) {
    console.warn('[cron/weekly] freezeRecurringWeek failed', currentWeek, e);
    frozenEtut = -1;
  }

  // 3. Tüm öğretmenlerin yeni haftasını init et (SQL-aware).
  // Faz 4 FIX-1 (3 denetim mutabık): her initWeekForTeacher artık interactive tx açıyor —
  // sınırsız Promise.all havuzu tüketir (Neon pooler + Prisma pool). Per-teacher kilitler
  // ayrık; sıralı koşum güvenli ve admin/week advanceWeek ile aynı desen.
  for (const t of teachers) { await initWeekForTeacher(t.id, nextWeek); }

  await setCurrentWeek(nextWeek); // SQL-aware

  return { previousWeek: currentWeek, newWeek: nextWeek, teachers: teachers.length, frozenEtut };
}

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const isReset = searchParams.get('action') === 'reset';

  const tenants = await listActiveTenants();
  const results: Array<TenantRef & { result: unknown; error?: string }> = [];
  for (const t of tenants) {
    try {
      const result = await runWithTenant<unknown>(t.org, t.branch, async () => (isReset ? resetTenant() : rollTenant()));
      results.push({ ...t, result });
    } catch (e) {
      // bir kurumun hatası diğerlerini düşürmesin
      results.push({ ...t, result: null, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, mode: isReset ? 'reset' : 'roll', tenants: tenants.length, results });
}
