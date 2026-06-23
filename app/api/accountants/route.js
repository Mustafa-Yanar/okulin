import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/db';
import { getSession, initialPassword } from '@/lib/auth';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { useSql } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const zPhone = z.string().max(40).optional();
// Şifre opsiyonel: boşsa telefon, o da yoksa "12345678" (lib/auth.initialPassword).
const AccountantCreateSchema = z.object({ name: zName, password: z.string().max(200).optional(), phone: zPhone });
const AccountantUpdateSchema = z.object({ id: zId, name: zName, password: z.string().max(200).optional(), phone: zPhone });
const AccountantDeleteSchema = z.object({ id: zId });

export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  if (useSql()) {
    const rows = await tdb().accountant.findMany();
    return NextResponse.json(rows.map(a => ({ id: a.legacyId, name: a.name, username: a.username, phone: a.phone || '' })));
  }

  const ids = await redis.smembers('accountants');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`accountant:${id}`));
  const results = await pipeline.exec();
  const accountants = results.filter(Boolean).map(a => ({
    id: a.id, name: a.name, username: a.username, phone: a.phone || '',
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
  const { name, password, phone } = parsed.data;

  const username = name;

  if (useSql()) {
    const dup = await tdb().accountant.findFirst({ where: { username } });
    if (dup) return NextResponse.json({ error: 'Bu isimde bir muhasebeci zaten kayıtlı' }, { status: 400 });
    const id = makeId();
    const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
    const initPassword = initialPassword(password, normPhone);
    const hash = await bcrypt.hash(initPassword, 10);
    await tdb().accountant.create({ data: { legacyId: id, name, username, passwordHash: hash, phone: normPhone, mustChangePassword: true } });
    // NOT: userIndex (SQL'de login doğrudan sorgular) bayrak-açıkta atlandı → auth göçü.
    return NextResponse.json({ id, name, username });
  }

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
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  // İlk şifre: girilen şifre → telefon → "12345678". İlk girişte zorunlu değişim.
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  const accountant = {
    id, name, username, passwordHash: hash,
    phone: normPhone,
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
  const { id, name, password, phone } = parsed.data;

  if (useSql()) {
    const a = await tdb().accountant.findFirst({ where: { legacyId: id } });
    if (!a) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });
    const data = { name, username: name, phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (a.phone || '') };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    await tdb().accountant.update({ where: { id: a.id }, data });
    // NOT: updateIndexUsername → SQL login doğrudan sorgular → auth göçü.
    return NextResponse.json({ ok: true });
  }

  const accountant = await redis.get(`accountant:${id}`);
  if (!accountant) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });

  const updated = { ...accountant, name, username: name,
    phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (accountant.phone || ''),
  };
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

  if (useSql()) {
    const a = await tdb().accountant.findFirst({ where: { legacyId: id } });
    if (a) await tdb().accountant.delete({ where: { id: a.id } });
    await logAudit({
      ...actorFrom(session),
      action: 'accountant.delete',
      target: { type: 'accountant', id, name: a?.name || id },
      detail: `Muhasebeci silindi: ${a?.name || id}`,
    });
    return NextResponse.json({ ok: true });
  }

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
