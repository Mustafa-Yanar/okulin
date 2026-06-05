import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/db';
import { getSession, initialPassword } from '@/lib/auth';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zId } from '@/lib/validate';

// Rehber (guidance counselor) hesapları — müdür oluşturur/yönetir.
// Rehber = müdür yetkileri eksi muhasebe (bkz lib/auth.js isManager).
// Muhasebeci deseninin birebir eşi (api/accountants).

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const zPhone = z.string().max(40).optional();
// Şifre opsiyonel: boşsa telefon, o da yoksa "12345678" (lib/auth.initialPassword).
const CreateSchema = z.object({ name: zName, password: z.string().max(200).optional(), phone: zPhone });
const UpdateSchema = z.object({ id: zId, name: zName, password: z.string().max(200).optional(), phone: zPhone });
const DeleteSchema = z.object({ id: zId });

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const ids = await redis.smembers('counselors');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`counselor:${id}`));
  const results = await pipeline.exec();
  const counselors = results.filter(Boolean).map(c => ({
    id: c.id, name: c.name, username: c.username, phone: c.phone || '',
  }));
  return NextResponse.json(counselors);
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password, phone } = parsed.data;
  const username = name;

  // Aynı isimde rehber var mı kontrol et
  const existingIds = await redis.smembers('counselors');
  if (existingIds && existingIds.length > 0) {
    const pipeline = redis.pipeline();
    existingIds.forEach(id => pipeline.get(`counselor:${id}`));
    const existing = await pipeline.exec();
    if (existing.some(c => c && c.username === username)) {
      return NextResponse.json({ error: 'Bu isimde bir rehber zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  // İlk şifre: girilen şifre → telefon → "12345678". İlk girişte zorunlu değişim.
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  const counselor = {
    id, name, username, passwordHash: hash,
    phone: normPhone,
    mustChangePassword: true, // ilk girişte rehber kendi şifresini belirler
  };
  await redis.set(`counselor:${id}`, counselor);
  await redis.sadd('counselors', id);
  await addToIndex(username, 'counselor', id);

  return NextResponse.json({ id, name, username });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, UpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, password, phone } = parsed.data;
  const counselor = await redis.get(`counselor:${id}`);
  if (!counselor) return NextResponse.json({ error: 'Rehber bulunamadı' }, { status: 404 });

  const updated = { ...counselor, name, username: name,
    phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (counselor.phone || ''),
  };
  if (password) updated.passwordHash = await bcrypt.hash(password, 10);
  await redis.set(`counselor:${id}`, updated);
  await updateIndexUsername(counselor.username, name, 'counselor', id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, DeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;
  const counselor = await redis.get(`counselor:${id}`);
  await redis.del(`counselor:${id}`);
  await redis.srem('counselors', id);
  if (counselor?.username) await removeFromIndex(counselor.username, 'counselor', id);
  await logAudit({
    ...actorFrom(session),
    action: 'counselor.delete',
    target: { type: 'counselor', id, name: counselor?.name || id },
    detail: `Rehber silindi: ${counselor?.name || id}`,
  });
  return NextResponse.json({ ok: true });
}
