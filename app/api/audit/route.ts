import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { tdb } from '@/lib/sqldb';

// GET /api/audit — son denetim kayıtlarını döndürür (sadece müdür). SQL: AuditLog.
export const GET = withAuth(['director'], async () => {
  const rows = await tdb().auditLog.findMany({ orderBy: { at: 'desc' }, take: 500 });
  return NextResponse.json(rows.map(r => r.data));
});
