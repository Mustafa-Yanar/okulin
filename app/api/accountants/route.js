import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const ids = await redis.smembers('accountants');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`accountant:${id}`));
  const results = await pipeline.exec();
  const accountants = results.filter(Boolean).map(a => ({
    id: a.id, name: a.name, username: a.username,
  }));
  return NextResponse.json(accountants);
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { name, password } = await req.json();
  if (!name || !password) {
    return NextResponse.json({ error: 'İsim ve şifre gerekli' }, { status: 400 });
  }

  const username = name;

  // Aynı isimde muhasebeci var mı kontrol et
  const existingIds = await redis.smembers('accountants');
  if (existingIds && existingIds.length > 0) {
    const pipeline = redis.pipeline();
    existingIds.forEach(id => pipeline.get(`accountant:${id}`));
    const existing = await pipeline.exec();
    const found = existing.some(a => a && a.username === username);
    if (found) {
      return NextResponse.json({ error: 'Bu isimde bir muhasebeci zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  const hash = await bcrypt.hash(password, 10);
  const accountant = { id, name, username, passwordHash: hash };
  await redis.set(`accountant:${id}`, accountant);
  await redis.sadd('accountants', id);

  return NextResponse.json({ id, name, username });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { id, name, password } = await req.json();
  const accountant = await redis.get(`accountant:${id}`);
  if (!accountant) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });

  const updated = { ...accountant, name, username: name };
  if (password) {
    updated.passwordHash = await bcrypt.hash(password, 10);
  }
  await redis.set(`accountant:${id}`, updated);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const { id } = await req.json();
  await redis.del(`accountant:${id}`);
  await redis.srem('accountants', id);
  return NextResponse.json({ ok: true });
}
