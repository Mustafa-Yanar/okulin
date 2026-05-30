import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getWeekKey } from '@/lib/slots';
import { parseBody, z, zId } from '@/lib/validate';

const GuidancePostSchema = z.object({ entries: z.record(z.unknown()) });
const GuidanceReviewSchema = z.object({ studentId: zId, weekKey: z.string().min(1).max(40) });

// guidance:{studentId}:{weekKey}
// → { entries: { [subject]: { correct, wrong, empty } }, reviewed: bool, submittedAt, reviewedAt }

function key(studentId, weekKey) {
  return `guidance:${studentId}:${weekKey}`;
}

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
  } else if (session.role !== 'director' && session.role !== 'teacher') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  if (!studentId) return NextResponse.json({ error: 'studentId gerekli' }, { status: 400 });

  if (listAll) {
    // Tüm guidance:{studentId}:* anahtarlarını scan
    let cursor = '0';
    const keys = [];
    do {
      const [next, found] = await redis.scan(cursor, { match: `guidance:${studentId}:*`, count: 100 });
      cursor = String(next);
      keys.push(...found);
    } while (cursor !== '0');
    if (keys.length === 0) return NextResponse.json({ weeks: [] });
    const pipeline = redis.pipeline();
    keys.forEach(k => pipeline.get(k));
    const results = await pipeline.exec();
    const weeks = keys.map((k, i) => {
      const weekKey = k.split(':').slice(2).join(':');
      return { weekKey, ...(results[i] || {}) };
    }).sort((a, b) => b.weekKey.localeCompare(a.weekKey));
    return NextResponse.json({ weeks });
  }

  const weekKey = searchParams.get('week') || getWeekKey();
  const data = await redis.get(key(studentId, weekKey));
  return NextResponse.json({ weekKey, ...(data || { entries: {}, reviewed: false }) });
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
  await redis.set(key(session.id, weekKey), payload, { ex: 60 * 60 * 24 * 180 }); // 6 ay
  return NextResponse.json({ ok: true, weekKey });
}

// PUT /api/guidance/review
// Müdür onaylar
export async function PUT(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const parsed = await parseBody(req, GuidanceReviewSchema);
  if (!parsed.ok) return parsed.response;
  const { studentId, weekKey } = parsed.data;
  const existing = await redis.get(key(studentId, weekKey));
  if (!existing) return NextResponse.json({ error: 'Kayıt bulunamadı' }, { status: 404 });
  const updated = { ...existing, reviewed: true, reviewedAt: new Date().toISOString() };
  await redis.set(key(studentId, weekKey), updated, { ex: 60 * 60 * 24 * 180 });
  return NextResponse.json({ ok: true });
}
