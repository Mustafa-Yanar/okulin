import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/redis';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zPassword, zId } from '@/lib/validate';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const AccountantCreateSchema = z.object({ name: zName, password: zPassword });
const AccountantUpdateSchema = z.object({ id: zId, name: zName, password: z.string().max(200).optional() });
const AccountantDeleteSchema = z.object({ id: zId });

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

  const parsed = await parseBody(req, AccountantCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password } = parsed.data;

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
  const accountant = {
    id, name, username, passwordHash: hash,
    mustChangePassword: true,  // ilk girişte muhasebeci kendi şifresini belirleyecek
  };
  await redis.set(`accountant:${id}`, accountant);
  await redis.sadd('accountants', id);
  await addToIndex(username, 'accountant', id);

  return NextResponse.json({ id, name, username });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, AccountantUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, password } = parsed.data;
  const accountant = await redis.get(`accountant:${id}`);
  if (!accountant) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });

  const updated = { ...accountant, name, username: name };
  if (password) {
    updated.passwordHash = await bcrypt.hash(password, 10);
  }
  await redis.set(`accountant:${id}`, updated);
  await updateIndexUsername(accountant.username, name, 'accountant', id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, AccountantDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;
  const accountant = await redis.get(`accountant:${id}`);
  await redis.del(`accountant:${id}`);
  await redis.srem('accountants', id);
  if (accountant?.username) await removeFromIndex(accountant.username, 'accountant', id);
  await logAudit({
    ...actorFrom(session),
    action: 'accountant.delete',
    target: { type: 'accountant', id, name: accountant?.name || id },
    detail: `Muhasebeci silindi: ${accountant?.name || id}`,
  });
  return NextResponse.json({ ok: true });
}
