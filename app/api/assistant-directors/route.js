import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/db';
import { getSession, initialPassword } from '@/lib/auth';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';
import { newId as makeId } from '@/lib/id';

// Müdür yardımcısı (assistant_director) hesapları — müdür oluşturur/yönetir.
// Müdür yardımcısı = müdürle BİREBİR aynı yetki (login sonrası oturum role='director'
// + asst:true bayrağı; bkz app/api/auth/route.js). Rehber/Muhasebeci deseninin eşi.

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

  if (isSqlEnabled()) {
    const rows = await tdb().assistantDirector.findMany();
    return NextResponse.json(rows.map(a => ({ id: a.legacyId, name: a.name, username: a.username, phone: a.phone || '' })));
  }

  const ids = await redis.smembers('assistant_directors');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`assistant_director:${id}`));
  const results = await pipeline.exec();
  const list = results.filter(Boolean).map(a => ({
    id: a.id, name: a.name, username: a.username, phone: a.phone || '',
  }));
  return NextResponse.json(list);
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

  if (isSqlEnabled()) {
    const dup = await tdb().assistantDirector.findFirst({ where: { username } });
    if (dup) return NextResponse.json({ error: 'Bu isimde bir müdür yardımcısı zaten kayıtlı' }, { status: 400 });
    const id = makeId();
    const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
    const initPassword = initialPassword(password, normPhone);
    const hash = await bcrypt.hash(initPassword, 10);
    await tdb().assistantDirector.create({ data: { legacyId: id, name, username, passwordHash: hash, phone: normPhone, mustChangePassword: true } });
    // NOT: userIndex (SQL'de login doğrudan sorgular) bayrak-açıkta atlandı → auth göçü.
    return NextResponse.json({ id, name, username });
  }

  // Aynı isimde müdür yardımcısı var mı kontrol et
  const existingIds = await redis.smembers('assistant_directors');
  if (existingIds && existingIds.length > 0) {
    const pipeline = redis.pipeline();
    existingIds.forEach(id => pipeline.get(`assistant_director:${id}`));
    const existing = await pipeline.exec();
    if (existing.some(a => a && a.username === username)) {
      return NextResponse.json({ error: 'Bu isimde bir müdür yardımcısı zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  // İlk şifre: girilen şifre → telefon → "12345678". İlk girişte zorunlu değişim.
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  const rec = {
    id, name, username, passwordHash: hash,
    phone: normPhone,
    mustChangePassword: true, // ilk girişte müdür yardımcısı kendi şifresini belirler
  };
  await redis.set(`assistant_director:${id}`, rec);
  await redis.sadd('assistant_directors', id);
  await addToIndex(username, 'assistant_director', id);

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

  if (isSqlEnabled()) {
    const a = await tdb().assistantDirector.findFirst({ where: { legacyId: id } });
    if (!a) return NextResponse.json({ error: 'Müdür yardımcısı bulunamadı' }, { status: 404 });
    const data = { name, username: name, phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (a.phone || '') };
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    await tdb().assistantDirector.update({ where: { id: a.id }, data });
    // NOT: updateIndexUsername → SQL login doğrudan sorgular (userIndex yok) → auth göçü.
    return NextResponse.json({ ok: true });
  }

  const rec = await redis.get(`assistant_director:${id}`);
  if (!rec) return NextResponse.json({ error: 'Müdür yardımcısı bulunamadı' }, { status: 404 });

  const updated = { ...rec, name, username: name,
    phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (rec.phone || ''),
  };
  if (password) updated.passwordHash = await bcrypt.hash(password, 10);
  await redis.set(`assistant_director:${id}`, updated);
  await updateIndexUsername(rec.username, name, 'assistant_director', id);
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

  if (isSqlEnabled()) {
    const a = await tdb().assistantDirector.findFirst({ where: { legacyId: id } });
    if (a) await tdb().assistantDirector.delete({ where: { id: a.id } });
    await logAudit({
      ...actorFrom(session),
      action: 'assistantDirector.delete',
      target: { type: 'assistant_director', id, name: a?.name || id },
      detail: `Müdür yardımcısı silindi: ${a?.name || id}`,
    });
    return NextResponse.json({ ok: true });
  }

  const rec = await redis.get(`assistant_director:${id}`);
  await redis.del(`assistant_director:${id}`);
  await redis.srem('assistant_directors', id);
  if (rec?.username) await removeFromIndex(rec.username, 'assistant_director', id);
  await logAudit({
    ...actorFrom(session),
    action: 'assistantDirector.delete',
    target: { type: 'assistant_director', id, name: rec?.name || id },
    detail: `Müdür yardımcısı silindi: ${rec?.name || id}`,
  });
  return NextResponse.json({ ok: true });
}
