import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/guidance/pending
// Müdür için: her öğrencinin bekleyen (reviewed: false) rehberlik hafta sayısı.
// Döndürür: { [studentId]: count }
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  let cursor = '0';
  const keys = [];
  do {
    const [next, found] = await redis.scan(cursor, { match: 'guidance:*', count: 200 });
    cursor = String(next);
    keys.push(...found);
  } while (cursor !== '0');

  if (keys.length === 0) return NextResponse.json({});

  const pipeline = redis.pipeline();
  keys.forEach(k => pipeline.get(k));
  const results = await pipeline.exec();

  const counts = {};
  keys.forEach((k, i) => {
    const data = results[i];
    if (!data || data.reviewed) return;
    const parts = k.split(':');
    // guidance:{studentId}:{weekKey} — weekKey içinde ":" yok ama yine de
    if (parts.length < 3) return;
    const studentId = parts[1];
    counts[studentId] = (counts[studentId] || 0) + 1;
  });

  return NextResponse.json(counts);
}
