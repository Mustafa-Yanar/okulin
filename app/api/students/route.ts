import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAuth, initialPassword } from '@/lib/auth';
import { getClass } from '@/lib/classes';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { tdb, withScope } from '@/lib/sqldb';
import type { Prisma } from '@prisma/client';

import { newId as makeId } from '@/lib/id';

// SQL satırı (class include) → mevcut sözleşme şekli (id/cls = legacyId).
type StudentWithClass = Prisma.StudentGetPayload<{ include: { class: true } }>;
const studentOut = (s: StudentWithClass) => ({
  id: s.legacyId, name: s.name, username: s.username, cls: s.class?.legacyId || '', group: s.group,
  phone: s.phone || '', parentPhone: s.parentPhone || '', parentName: s.parentName || '', birthDate: s.birthDate || '',
  diplomaNotu: s.diplomaNotu ?? '', obp: s.diplomaNotu ? Math.round(s.diplomaNotu * 5 * 100) / 100 : null,
  parentRelation: s.parentRelation || '', parentNote: s.parentNote || '',
  parent2Name: s.parent2Name || '', parent2Phone: s.parent2Phone || '', parent2Relation: s.parent2Relation || '',
});

const zPhone = z.string().max(40).optional();
const zBirthDate = z.string().max(20).optional(); // YYYY-MM-DD
const zDiplomaNotu = z.string().max(10).optional(); // mezun diploma notu 50-100 (OBP = ×5)

// Diploma notu string'ini doğrula → number (50-100) veya '' döndür; geçersizse null.
// group !== 'mezun' ise her zaman '' (OBP yalnız mezunda tutulur).
function normDiplomaNotu(raw: unknown, group: string): number | '' | null {
  if (group !== 'mezun') return '';
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  const v = parseFloat(s.replace(',', '.'));
  if (isNaN(v) || v < 50 || v > 100) return null; // geçersiz
  return Math.round(v * 100) / 100;
}
const zParentName = z.string().max(120).optional(); // veli adı soyadı (opsiyonel)
const zRelation = z.string().max(40).optional();    // yakınlık derecesi (Anne, Baba...)
const zNote = z.string().max(2000).optional();      // veliye özel not (yönetim görür)
// Veli ek alanları: yakınlık, not, 2. iletişim (ad/telefon/yakınlık)
const parentExtraFields = {
  parentRelation: zRelation, parentNote: zNote,
  parent2Name: zParentName, parent2Phone: zPhone, parent2Relation: zRelation,
};
const StudentCreateSchema = z.object({
  // Şifre opsiyonel: boş bırakılırsa öğrenci telefonu ilk şifre olur (aşağıda kontrol).
  name: zName, password: z.string().max(200).optional(), cls: z.string().min(1).max(40),
  phone: zPhone, parentPhone: zPhone, parentName: zParentName, birthDate: zBirthDate,
  diplomaNotu: zDiplomaNotu,
  ...parentExtraFields,
});
const StudentUpdateSchema = z.object({
  id: zId, name: zName, cls: z.string().min(1).max(40),
  password: z.string().max(200).optional(),
  phone: zPhone, parentPhone: zPhone, parentName: zParentName, birthDate: zBirthDate,
  diplomaNotu: zDiplomaNotu,
  ...parentExtraFields,
});
// Tekil { id } veya toplu { ids:[...] } silme.
const StudentDeleteSchema = z.object({
  id: zId.optional(),
  ids: z.array(zId).max(2000).optional(),
}).refine(d => d.id || (d.ids && d.ids.length), { message: 'id veya ids gerekli' });

export const GET = withAuth(async () => {
  const rows = await tdb().student.findMany({ include: { class: true } });
  return NextResponse.json(rows.map(studentOut));
});

// POST/PUT 'intake': kayıt akışı — müdür/rehber (manage kuralı) + muhasebeci
// (config permissions.accountant.intake). Silme 'manage'de kalır (kayıt geri
// alınabilir, silme finans geçmişini de götürür — muhasebeciye verilmez).
export const POST = withAuth('intake', async (req, ctx, session) => {
  const parsed = await parseBody(req, StudentCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password, cls, phone, parentPhone, parentName, birthDate, diplomaNotu,
          parentRelation, parentNote, parent2Name, parent2Phone, parent2Relation } = parsed.data;

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  // Grup, şube kaydının köprü alanından gelir (registry boşsa constants'tan türetilir).
  const group = (await getClass(cls))?.group;
  if (!group) return NextResponse.json({ error: 'Geçersiz sınıf' }, { status: 400 });

  // Diploma notu (yalnız mezun): geçerli değilse hata; OBP = ×5 türetilir.
  const diploma = normDiplomaNotu(diplomaNotu, group);
  if (diploma === null) return NextResponse.json({ error: 'Diploma notu 50 ile 100 arasında olmalı' }, { status: 400 });

  // Telefon doğrulama (opsiyonel ama verilmişse geçerli Türk cep olmalı)
  let normPhone: string | null = '';
  if (phone) {
    normPhone = normalizeTurkishMobile(phone);
    if (!normPhone) return NextResponse.json({ error: 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
  }

  // Veli bilgileri ZORUNLU (öğrenci-veli bağı + veli paneli için)
  if (!(parentName || '').trim()) {
    return NextResponse.json({ error: 'Veli adı soyadı zorunludur' }, { status: 400 });
  }
  if (!parentPhone) {
    return NextResponse.json({ error: 'Veli telefonu zorunludur' }, { status: 400 });
  }
  const normParentPhone = normalizeTurkishMobile(parentPhone);
  if (!normParentPhone) return NextResponse.json({ error: 'Veli telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });

  // 2. iletişim telefonu (opsiyonel ama verilmişse geçerli olmalı)
  let normParent2Phone: string | null = '';
  if (parent2Phone) {
    normParent2Phone = normalizeTurkishMobile(parent2Phone);
    if (!normParent2Phone) return NextResponse.json({ error: '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
  }

  // Şifre kuralı (lib/auth.initialPassword): girilmişse o; boşsa öğrenci telefonu;
  // telefon da yoksa sabit "12345678". İlk girişte zorunlu değişim (mustChangePassword).
  const initPassword = initialPassword(password, normPhone);

  const dup = await tdb().student.findFirst({ where: { username } });
  if (dup) return NextResponse.json({ error: 'Bu isimde bir öğrenci zaten kayıtlı' }, { status: 400 });
  const clsRow = await tdb().class.findFirst({ where: { legacyId: cls } });
  const hash = await bcrypt.hash(initPassword, 10);
  const legacyId = makeId();
  await tdb().student.create({ data: withScope({
    legacyId, name, username, passwordHash: hash, classId: clsRow?.id || null, group,
    phone: normPhone, parentPhone: normParentPhone, parentName: (parentName || '').trim(),
    parentRelation: (parentRelation || '').trim(), parentNote: (parentNote || '').trim(),
    parent2Name: (parent2Name || '').trim(), parent2Phone: normParent2Phone, parent2Relation: (parent2Relation || '').trim(),
    birthDate: birthDate || '', diplomaNotu: (diploma === '' ? null : diploma), mustChangePassword: true,
  }) });
  await logAudit({
    ...actorFrom(session),
    action: 'student.create',
    target: { type: 'student', id: legacyId, name },
    detail: `Öğrenci eklendi: ${name} (${cls})`,
  });
  return NextResponse.json({ id: legacyId, name, username, cls, group });
});

export const PUT = withAuth('intake', async (req) => {
  const parsed = await parseBody(req, StudentUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, password, cls, phone, parentPhone, parentName, birthDate, diplomaNotu,
          parentRelation, parentNote, parent2Name, parent2Phone, parent2Relation } = parsed.data;

  const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
  if (!s) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });
  const group = (await getClass(cls))?.group || s.group;
  let diploma: number | '' | null = s.diplomaNotu ?? '';
  if (diplomaNotu !== undefined) {
    diploma = normDiplomaNotu(diplomaNotu, group);
    if (diploma === null) return NextResponse.json({ error: 'Diploma notu 50 ile 100 arasında olmalı' }, { status: 400 });
  } else if (group !== 'mezun') diploma = '';
  const clsRow = await tdb().class.findFirst({ where: { legacyId: cls } });
  const data: { name: string; username: string; classId: string | null; group: string; diplomaNotu: number | null; birthDate: string; parentName: string; parentRelation: string; parentNote: string; parent2Name: string; parent2Relation: string; phone?: string; parentPhone?: string; parent2Phone?: string; passwordHash?: string } = {
    name, username: name, classId: clsRow?.id ?? s.classId, group, diplomaNotu: (diploma === '' ? null : diploma),
    birthDate: birthDate !== undefined ? birthDate : (s.birthDate || ''),
    parentName: parentName !== undefined ? (parentName || '').trim() : (s.parentName || ''),
    parentRelation: parentRelation !== undefined ? (parentRelation || '').trim() : (s.parentRelation || ''),
    parentNote: parentNote !== undefined ? (parentNote || '').trim() : (s.parentNote || ''),
    parent2Name: parent2Name !== undefined ? (parent2Name || '').trim() : (s.parent2Name || ''),
    parent2Relation: parent2Relation !== undefined ? (parent2Relation || '').trim() : (s.parent2Relation || ''),
  };
  if (phone !== undefined) {
    if (phone) { const n = normalizeTurkishMobile(phone); if (!n) return NextResponse.json({ error: 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 }); data.phone = n; }
    else data.phone = '';
  }
  if (parentPhone !== undefined) {
    if (parentPhone) { const n = normalizeTurkishMobile(parentPhone); if (!n) return NextResponse.json({ error: 'Veli telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 }); data.parentPhone = n; }
    else data.parentPhone = '';
  }
  if (parent2Phone !== undefined) {
    if (parent2Phone) { const n = normalizeTurkishMobile(parent2Phone); if (!n) return NextResponse.json({ error: '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 }); data.parent2Phone = n; }
    else data.parent2Phone = '';
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().student.update({ where: { id: s.id }, data });
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth('manage', async (req, ctx, session) => {
  const parsed = await parseBody(req, StudentDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id, ids } = parsed.data;

  if (ids && Array.isArray(ids)) {
    await tdb().student.deleteMany({ where: { legacyId: { in: ids } } }); // cascade: finance/behavior
    await logAudit({ ...actorFrom(session), action: 'student.bulkDelete', detail: `${ids.length} öğrenci toplu silindi` });
    return NextResponse.json({ ok: true, deleted: ids.length });
  }
  const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
  if (s) await tdb().student.delete({ where: { id: s.id } });
  await logAudit({ ...actorFrom(session), action: 'student.delete', target: { type: 'student', id, name: s?.name || id }, detail: `Öğrenci silindi: ${s?.name || id}${s?.class?.legacyId ? ` (${s.class.legacyId})` : ''}` });
  return NextResponse.json({ ok: true });
});
