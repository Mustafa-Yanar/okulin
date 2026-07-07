import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { EXPENSE_CATEGORIES } from '@/lib/constants';
import { tdb } from '@/lib/sqldb';
import { getOrgConfig } from '@/lib/config';

// Kurum giderleri — personel ödemeleri (maaş + ek ödemeler) ve kategorili
// harcama kalemleri. Tenant-scoped (@/lib/db). Yetki: director + accountant.
// Anahtar: `expenses` (set) → `expense:<id>`.

function canAccess(session) {
  return session && (session.role === 'director' || session.role === 'accountant');
}

import { newId as genId } from '@/lib/id';

const ExtraSchema = z.object({ label: z.string().max(120).optional(), amount: zMoney.optional() });

const ExpenseSchema = z.object({
  id: zId.optional(), // PUT için
  type: z.enum(['personnel', 'general']),
  date: z.string().max(40).optional(),
  description: z.string().max(1000).optional(),
  // personnel
  personnelId: z.string().max(100).nullable().optional(),
  personnelName: z.string().max(200).optional(),
  period: z.string().max(7).optional(), // YYYY-MM
  salary: zMoney.optional(),
  extras: z.array(ExtraSchema).max(50).optional(),
  // general
  category: z.string().max(80).optional(),
  amount: zMoney.optional(),
});

const ExpenseDeleteSchema = z.object({ id: zId });

// Gelen veriyi normalize edip kalıcı kayıt nesnesi üret (POST + PUT ortak).
function buildRecord(data, base, session, validCategories) {
  const date = data.date || new Date().toISOString().slice(0, 10);
  if (data.type === 'personnel') {
    const salary = parseFloat(data.salary) || 0;
    const extras = (data.extras || [])
      .map(e => ({ label: (e.label || '').trim(), amount: parseFloat(e.amount) || 0 }))
      .filter(e => e.amount > 0 || e.label);
    const extrasTotal = extras.reduce((s, e) => s + e.amount, 0);
    return {
      ...base,
      type: 'personnel',
      date,
      personnelId: data.personnelId || null,
      personnelName: (data.personnelName || '').trim(),
      period: data.period || date.slice(0, 7),
      salary,
      extras,
      amount: salary + extrasTotal,
      description: (data.description || '').trim(),
    };
  }
  // general — kurum kategorisi geçerliyse onu, değilse "Diğer". validCategories
  // verilmezse sabit listeye düş (geriye uyumluluk).
  const cats = validCategories || EXPENSE_CATEGORIES;
  const category = cats.includes(data.category) ? data.category : 'Diğer';
  return {
    ...base,
    type: 'general',
    date,
    category,
    amount: parseFloat(data.amount) || 0,
    description: (data.description || '').trim(),
  };
}

export async function GET(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const period = searchParams.get('period');
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let list = (await tdb().expense.findMany()).map((r) => r.data);
  if (type) list = list.filter(e => e.type === type);
  if (period) list = list.filter(e => (e.period || e.date?.slice(0, 7)) === period);
  if (from) list = list.filter(e => (e.date || '') >= from);
  if (to) list = list.filter(e => (e.date || '') <= to);
  list.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return NextResponse.json(list);
}

export async function POST(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, ExpenseSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;

  const id = genId();
  const base = {
    id,
    createdBy: session.name,
    createdByRole: session.role,
    createdAt: new Date().toISOString(),
  };
  const validCategories = await getOrgConfig('expenseCategories');
  const record = buildRecord(data, base, session, validCategories);

  if (record.type === 'personnel' && !record.personnelName) {
    return NextResponse.json({ error: 'Personel adı gerekli' }, { status: 400 });
  }
  if (record.amount <= 0) {
    return NextResponse.json({ error: 'Tutar sıfırdan büyük olmalı' }, { status: 400 });
  }

  await tdb().expense.create({ data: { legacyId: id, type: record.type, amount: record.amount, date: record.date, data: record } });
  await logAudit({ ...actorFrom(session), action: 'finance.expense.create', target: { type: 'expense', id, name: record.type === 'personnel' ? record.personnelName : record.category }, detail: `Gider eklendi (${record.type === 'personnel' ? 'personel: ' + record.personnelName : record.category}) — ${record.amount} TL` });
  return NextResponse.json({ ok: true, record });
}

export async function PUT(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, ExpenseSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  if (!data.id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });
  const validCategories = await getOrgConfig('expenseCategories');

  const ex = await tdb().expense.findFirst({ where: { legacyId: data.id } });
  if (!ex) return NextResponse.json({ error: 'Gider bulunamadı' }, { status: 404 });
  const old = ex.data || {};
  const record = buildRecord(data, { id: old.id || data.id, createdBy: old.createdBy, createdByRole: old.createdByRole, createdAt: old.createdAt, updatedBy: session.name, updatedAt: new Date().toISOString() }, session, validCategories);
  if (record.type === 'personnel' && !record.personnelName) return NextResponse.json({ error: 'Personel adı gerekli' }, { status: 400 });
  if (record.amount <= 0) return NextResponse.json({ error: 'Tutar sıfırdan büyük olmalı' }, { status: 400 });
  await tdb().expense.update({ where: { id: ex.id }, data: { type: record.type, amount: record.amount, date: record.date, data: record } });
  await logAudit({ ...actorFrom(session), action: 'finance.expense.update', target: { type: 'expense', id: data.id, name: record.type === 'personnel' ? record.personnelName : record.category }, detail: `Gider güncellendi — ${record.amount} TL` });
  return NextResponse.json({ ok: true, record });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, ExpenseDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const ex = await tdb().expense.findFirst({ where: { legacyId: id } });
  if (!ex) return NextResponse.json({ error: 'Gider bulunamadı' }, { status: 404 });
  await tdb().expense.delete({ where: { id: ex.id } });
  const old = ex.data || {};
  await logAudit({ ...actorFrom(session), action: 'finance.expense.delete', target: { type: 'expense', id, name: old.type === 'personnel' ? old.personnelName : old.category }, detail: `Gider silindi — ${old.amount} TL` });
  return NextResponse.json({ ok: true });
}
