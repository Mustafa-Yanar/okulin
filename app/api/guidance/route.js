import { NextResponse } from 'next/server';
import { getSession, canReadStudent } from '@/lib/auth';
import { getWeekKey } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

const GuidancePostSchema = z.object({ entries: z.record(z.unknown()) });
const GuidanceReviewSchema = z.object({ studentId: zId, weekKey: z.string().min(1).max(40) });

// GET /api/guidance?studentId=...&week=...
// Tek hafta için kayıt döner. studentId yoksa, öğrenci kendi kaydını ister.
// Müdür her öğrencinin kaydını çekebilir.
// Aynı zamanda ?listAll=1&studentId=... ile öğrencinin tüm haftalarını listeler (müdür için).
export async function GET(req) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  let studentId = searchParams.get('studentId');
  const listAll = searchParams.get('listAll') === '1';

  if (session.role === 'student') {
    studentId = session.id;
  } else if (session.role === 'parent') {
    if (!canReadStudent(session, studentId)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  } else if ((session.role !== 'director' && session.role !== 'counselor') && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  if (listAll) {
    const rows = await tdb().guidance.findMany({ where: { studentId } });
    if (rows.length === 0) return NextResponse.json({ weeks: [] });
    const weeks = rows.map(r => ({ weekKey: r.week, ...(r.data || {}) }))
      .sort((a, b) => b.weekKey.localeCompare(a.weekKey));
    return NextResponse.json({ weeks });
  }

  const weekKey = searchParams.get('week') || getWeekKey();
  const row = await tdb().guidance.findFirst({ where: { studentId, week: weekKey } });
  return NextResponse.json({ weekKey, ...(row?.data || { entries: {}, reviewed: false }) });
}

// POST /api/guidance
// Body: { entries: { [subject]: { correct, wrong, empty } } }
// Öğrenci sadece kendi mevcut haftasına yazabilir.
export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'student') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, GuidancePostSchema);
  if (!parsed.ok) return parsed.response;
  const { entries } = parsed.data;

  // Sayısal değer doğrulama
  const cleaned = {};
  for (const [subject, val] of Object.entries(entries)) {
    if (!val || typeof val !== 'object') continue;
    const correct = parseInt(val.correct) || 0;
    const wrong = parseInt(val.wrong) || 0;
    const empty = parseInt(val.empty) || 0;
    if (correct === 0 && wrong === 0 && empty === 0) continue;
    if (correct < 0 || wrong < 0 || empty < 0) {
      return NextResponse.json({ error: 'Negatif değer girilemez' }, { status: 400 });
    }
    cleaned[subject] = { correct, wrong, empty };
  }

  const weekKey = getWeekKey();
  const payload = {
    entries: cleaned,
    reviewed: false,
    submittedAt: new Date().toISOString(),
  };
  const existing = await tdb().guidance.findFirst({ where: { studentId: session.id, week: weekKey } });
  if (existing) await tdb().guidance.update({ where: { id: existing.id }, data: { data: payload } });
  else await tdb().guidance.create({ data: { studentId: session.id, week: weekKey, data: payload } });
  return NextResponse.json({ ok: true, weekKey });
}

// PUT /api/guidance/review
// Müdür onaylar
export async function PUT(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const parsed = await parseBody(req, GuidanceReviewSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, weekKey } = parsed.data;
  const existing = await tdb().guidance.findFirst({ where: { studentId, week: weekKey } });
  if (!existing) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  const updated = { ...(existing.data || {}), reviewed: true, reviewedAt: new Date().toISOString() };
  await tdb().guidance.update({ where: { id: existing.id }, data: { data: updated } });
  return NextResponse.json({ ok: true });
}
