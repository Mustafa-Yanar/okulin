import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';

// GET /api/archive?type=teacher&id=xxx  veya  ?type=student&id=xxx
export async function GET(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'teacher' | 'student'
  const id = searchParams.get('id');

  if (!type || !id) return NextResponse.json({ error: 'type ve id gerekli' }, { status: 400 });

  // Tüm arşiv key'lerini tara
  const pattern = `archive:${type}:${id}:*`;
  const keys = await redis.keys(pattern);

  if (!keys || keys.length === 0) return NextResponse.json({ weeks: [] });

  const pipeline = redis.pipeline();
  keys.forEach(k => pipeline.get(k));
  const results = await pipeline.exec();

  const weeks = keys
    .map((k, i) => {
      const weekKey = k.split(':')[3]; // archive:teacher:xxx:2026-W20
      return { weekKey, entries: results[i] || [] };
    })
    .filter(w => w.entries.length > 0)
    .sort((a, b) => b.weekKey.localeCompare(a.weekKey)); // en yeni önce

  return NextResponse.json({ weeks });
}
