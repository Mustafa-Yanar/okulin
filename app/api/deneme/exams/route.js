import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { dkeys } from '@/lib/deneme/store';

// Deneme listesi (meta) — giriş yapan herkes görür.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const index = (await redis.get(dkeys.examsIndex)) || [];
  return NextResponse.json({ exams: index });
}
