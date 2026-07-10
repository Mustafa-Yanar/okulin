import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';
import type { PaymentEntry } from '@/lib/finance';

export const GET = withAuth(['director', 'counselor', 'accountant'], async (_req, _ctx, session) => {
  try {
    const [studentCount, teacherCount] = await Promise.all([tdb().student.count(), tdb().teacher.count()]);
    let thisMonthCollection = 0;
    let pendingAmount = 0;
    if (session.role !== 'counselor') {
      const today = new Date().toISOString().slice(0, 10);
      const monthPrefix = today.slice(0, 7);
      const finances = await tdb().finance.findMany({ include: { installments: true } });
      for (const f of finances) {
        for (const p of ((f.payments as unknown as PaymentEntry[] | null) || [])) { // payments: Json ledger
          if (p.date && p.date.startsWith(monthPrefix)) thisMonthCollection += parseFloat(String(p.amount)) || 0;
        }
        for (const inst of f.installments) {
          if (!inst.paid && inst.dueDate && inst.dueDate < today) pendingAmount += parseFloat(String(inst.amount)) || 0;
        }
      }
    }
    return NextResponse.json({
      studentCount, teacherCount,
      thisMonthCollection: Math.round(thisMonthCollection * 100) / 100,
      pendingAmount: Math.round(pendingAmount * 100) / 100,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'İşlem başarısız' }, { status: 500 });
  }
});
