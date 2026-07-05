import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';

// GET /api/audit — son denetim kayıtlarını döndürür (sadece müdür). SQL: AuditLog.
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const rows = await tdb().auditLog.findMany({ orderBy: { at: 'desc' }, take: 500 });
  return NextResponse.json(rows.map(r => r.data));
}
