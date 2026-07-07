import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getSession, initialPassword } from '@/lib/auth';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { tdb } from '@/lib/sqldb';
import { newId as makeId } from '@/lib/id';

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

  const rows = await tdb().accountant.findMany();
  return NextResponse.json(rows.map(a => ({ id: a.legacyId, name: a.name, username: a.username, phone: a.phone || '' })));
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

  const dup = await tdb().accountant.findFirst({ where: { username } });
  if (dup) return NextResponse.json({ error: 'Bu isimde bir muhasebeci zaten kayıtlı' }, { status: 400 });
  const id = makeId();
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  await tdb().accountant.create({ data: { legacyId: id, name, username, passwordHash: hash, phone: normPhone, mustChangePassword: true } });
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

  const a = await tdb().accountant.findFirst({ where: { legacyId: id } });
  if (!a) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });
  const data = { name, username: name, phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (a.phone || '') };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().accountant.update({ where: { id: a.id }, data });
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
