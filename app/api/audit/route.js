import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// GET /api/audit — son denetim kayıtlarını döndürür (sadece müdür).
// audit:* key'lerini SCAN ile toplar, ts'ye göre yeniden eskiye sıralar.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  if (isSqlEnabled()) {
    const rows = await tdb().auditLog.findMany({ orderBy: { at: 'desc' }, take: 500 });
    return NextResponse.json(rows.map(r => r.data));
  }

  const entries = [];
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, { match: 'audit:*', count: 200 });
    cursor = String(next);
    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      keys.forEach(k => pipeline.get(k));
      const vals = await pipeline.exec();
      vals.forEach(v => { if (v) entries.push(v); });
    }
  } while (cursor !== '0');

  entries.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));
  return NextResponse.json(entries.slice(0, 500));
}
