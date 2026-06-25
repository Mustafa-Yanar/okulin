import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

function canAccess(session) {
  return session && ['director', 'counselor', 'accountant'].includes(session.role);
}

export async function GET() {
  const session = await getSession();
  if (!canAccess(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  try {
    if (isSqlEnabled()) {
      const [studentCount, teacherCount] = await Promise.all([tdb().student.count(), tdb().teacher.count()]);
      let thisMonthCollection = 0;
      let pendingAmount = 0;
      if (session.role !== 'counselor') {
        const today = new Date().toISOString().slice(0, 10);
        const monthPrefix = today.slice(0, 7);
        const finances = await tdb().finance.findMany({ include: { installments: true } });
        for (const f of finances) {
          for (const p of (f.payments || [])) {
            if (p.date && p.date.startsWith(monthPrefix)) thisMonthCollection += parseFloat(p.amount) || 0;
          }
          for (const inst of f.installments) {
            if (!inst.paid && inst.dueDate && inst.dueDate < today) pendingAmount += parseFloat(inst.amount) || 0;
          }
        }
      }
      return NextResponse.json({
        studentCount, teacherCount,
        thisMonthCollection: Math.round(thisMonthCollection * 100) / 100,
        pendingAmount: Math.round(pendingAmount * 100) / 100,
      });
    }

    const [studentIds, teacherIds] = await Promise.all([
      redis.smembers('students'),
      redis.smembers('teachers'),
    ]);

    const studentCount = studentIds.length;
    const teacherCount = teacherIds.length;

    // Finans istatistikleri (yalnız director ve accountant görebilir)
    let thisMonthCollection = 0;
    let pendingAmount = 0;

    if (session.role !== 'counselor' && studentIds.length > 0) {
      const pl = redis.pipeline();
      for (const id of studentIds) pl.get(`finance:${id}`);
      const records = await pl.exec();

      const today = new Date().toISOString().slice(0, 10);
      const monthPrefix = today.slice(0, 7); // YYYY-MM

      for (const record of records) {
        if (!record) continue;

        // Bu ay yapılan ödemeler
        const payments = record.payments || [];
        for (const p of payments) {
          if (p.date && p.date.startsWith(monthPrefix)) {
            thisMonthCollection += parseFloat(p.amount) || 0;
          }
        }

        // Vadesi geçmiş ödenmemiş taksitler
        const installments = record.installments || [];
        for (const inst of installments) {
          if (!inst.paid && inst.dueDate && inst.dueDate < today) {
            pendingAmount += parseFloat(inst.amount) || 0;
          }
        }
      }
    }

    return NextResponse.json({
      studentCount,
      teacherCount,
      thisMonthCollection: Math.round(thisMonthCollection * 100) / 100,
      pendingAmount: Math.round(pendingAmount * 100) / 100,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
