import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAuth, initialPassword } from '@/lib/auth';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';
import { newId as makeId } from '@/lib/id';

// Muhasebeci hesapları — müdür oluşturur/yönetir.

const zPhone = z.string().max(40).optional();
// Şifre opsiyonel: boşsa telefon, o da yoksa "12345678" (lib/auth.initialPassword).
const CreateSchema = z.object({ name: zName, password: z.string().max(200).optional(), phone: zPhone });
const UpdateSchema = z.object({ id: zId, name: zName, password: z.string().max(200).optional(), phone: zPhone });
const DeleteSchema = z.object({ id: zId });

export const GET = withAuth(['director'], async () => {
  const rows = await tdb().accountant.findMany();
  return NextResponse.json(rows.map(a => ({ id: a.legacyId, name: a.name, username: a.username, phone: a.phone || '' })));
});

export const POST = withAuth(['director'], async (req) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password, phone } = parsed.data;
  const username = name;

  const dup = await tdb().accountant.findFirst({ where: { username } });
  if (dup) return NextResponse.json({ error: 'Bu isimde bir muhasebeci zaten kayıtlı' }, { status: 400 });
  const id = makeId();
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  await tdb().accountant.create({ data: withScope({ legacyId: id, name, username, passwordHash: hash, phone: normPhone, mustChangePassword: true }) });
  return NextResponse.json({ id, name, username });
});

export const PUT = withAuth(['director'], async (req) => {
  const parsed = await parseBody(req, UpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, password, phone } = parsed.data;

  const a = await tdb().accountant.findFirst({ where: { legacyId: id } });
  if (!a) return NextResponse.json({ error: 'Muhasebeci bulunamadı' }, { status: 404 });
  const data: { name: string; username: string; phone: string; passwordHash?: string } =
    { name, username: name, phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (a.phone || '') };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().accountant.update({ where: { id: a.id }, data });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth(['director'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, DeleteSchema);
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
});
