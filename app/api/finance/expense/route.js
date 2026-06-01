import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zId, zMoney } from '@/lib/validate';
import { EXPENSE_CATEGORIES } from '@/lib/constants';

// Kurum giderleri — personel ödemeleri (maaş + ek ödemeler) ve kategorili
// harcama kalemleri. Tenant-scoped (@/lib/db). Yetki: director + accountant.
// Anahtar: `expenses` (set) → `expense:<id>`.

function canAccess(session) {
  return session && (session.role === 'director' || session.role === 'accountant');
}

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

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
function buildRecord(data, base, session) {
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
  // general
  const category = EXPENSE_CATEGORIES.includes(data.category) ? data.category : 'Diğer';
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

  const ids = await redis.smembers('expenses');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`expense:${id}`));
  let list = (await pipeline.exec()).filter(Boolean);

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
  const record = buildRecord(data, base, session);

  if (record.type === 'personnel' && !record.personnelName) {
    return NextResponse.json({ error: 'Personel adı gerekli' }, { status: 400 });
  }
  if (record.amount <= 0) {
    return NextResponse.json({ error: 'Tutar sıfırdan büyük olmalı' }, { status: 400 });
  }

  await redis.set(`expense:${id}`, record);
  await redis.sadd('expenses', id);

  await logAudit({
    ...actorFrom(session),
    action: 'finance.expense.create',
    target: { type: 'expense', id, name: record.type === 'personnel' ? record.personnelName : record.category },
    detail: `Gider eklendi (${record.type === 'personnel' ? 'personel: ' + record.personnelName : record.category}) — ${record.amount} TL`,
  });
  return NextResponse.json({ ok: true, record });
}

export async function PUT(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, ExpenseSchema);
  if (!parsed.ok) return parsed.response;
  const data = parsed.data;
  if (!data.id) return NextResponse.json({ error: 'id gerekli' }, { status: 400 });

  const existing = await redis.get(`expense:${data.id}`);
  if (!existing) return NextResponse.json({ error: 'Gider bulunamadı' }, { status: 404 });

  const base = {
    id: existing.id,
    createdBy: existing.createdBy,
    createdByRole: existing.createdByRole,
    createdAt: existing.createdAt,
    updatedBy: session.name,
    updatedAt: new Date().toISOString(),
  };
  const record = buildRecord(data, base, session);

  if (record.type === 'personnel' && !record.personnelName) {
    return NextResponse.json({ error: 'Personel adı gerekli' }, { status: 400 });
  }
  if (record.amount <= 0) {
    return NextResponse.json({ error: 'Tutar sıfırdan büyük olmalı' }, { status: 400 });
  }

  await redis.set(`expense:${data.id}`, record);
  await logAudit({
    ...actorFrom(session),
    action: 'finance.expense.update',
    target: { type: 'expense', id: data.id, name: record.type === 'personnel' ? record.personnelName : record.category },
    detail: `Gider güncellendi — ${record.amount} TL`,
  });
  return NextResponse.json({ ok: true, record });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, ExpenseDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const existing = await redis.get(`expense:${id}`);
  if (!existing) return NextResponse.json({ error: 'Gider bulunamadı' }, { status: 404 });

  await redis.srem('expenses', id);
  await redis.del(`expense:${id}`);

  await logAudit({
    ...actorFrom(session),
    action: 'finance.expense.delete',
    target: { type: 'expense', id, name: existing.type === 'personnel' ? existing.personnelName : existing.category },
    detail: `Gider silindi — ${existing.amount} TL`,
  });
  return NextResponse.json({ ok: true });
}
