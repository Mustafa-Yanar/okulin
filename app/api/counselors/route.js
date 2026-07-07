import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession, initialPassword } from '@/lib/auth';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';

// Rehber (guidance counselor) hesapları — müdür oluşturur/yönetir.
// Rehber = müdür yetkileri eksi muhasebe (bkz lib/auth.js isManager).
// Muhasebeci deseninin birebir eşi (api/accountants).

import { newId as makeId } from '@/lib/id';

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

  const rows = await tdb().counselor.findMany();
  return NextResponse.json(rows.map(c => ({ id: c.legacyId, name: c.name, username: c.username, phone: c.phone || '' })));
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

  const dup = await tdb().counselor.findFirst({ where: { username } });
  if (dup) return NextResponse.json({ error: 'Bu isimde bir rehber zaten kayıtlı' }, { status: 400 });
  const id = makeId();
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  await tdb().counselor.create({ data: { legacyId: id, name, username, passwordHash: hash, phone: normPhone, mustChangePassword: true } });
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

  const c = await tdb().counselor.findFirst({ where: { legacyId: id } });
  if (!c) return NextResponse.json({ error: 'Rehber bulunamadı' }, { status: 404 });
  const data = { name, username: name, phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (c.phone || '') };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().counselor.update({ where: { id: c.id }, data });
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

  const c = await tdb().counselor.findFirst({ where: { legacyId: id } });
  if (c) await tdb().counselor.delete({ where: { id: c.id } });
  await logAudit({
    ...actorFrom(session),
    action: 'counselor.delete',
    target: { type: 'counselor', id, name: c?.name || id },
    detail: `Rehber silindi: ${c?.name || id}`,
  });
  return NextResponse.json({ ok: true });
}
