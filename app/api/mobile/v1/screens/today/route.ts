import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { tdb } from '@/lib/sqldb';
import { contentLimited } from '@/lib/mobile/limits';
import { buildStudentToday, buildParentToday, buildTeacherToday, buildManagementToday } from '@/lib/mobile/today';

// Rol-aware "Bugün" aggregate ucu (spec §5.1/§9-1): tek istekte günün içeriği.
// Rol sınırı claim'lerden — istemci parametresiyle başka kullanıcı/sınıf çekilemez
// (veli ?child yalnız payload children içinden, today.ts 403 fırlatır).
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const unread = await tdb().notificationEvent.count({
    where: { role: session.role, userId: String(session.id ?? ''), readAt: null },
  });

  if (session.role === 'student') return NextResponse.json(await buildStudentToday(session, unread));
  if (session.role === 'parent') {
    const child = new URL(req.url).searchParams.get('child');
    return NextResponse.json(await buildParentToday(session, unread, child));
  }
  if (session.role === 'teacher') return NextResponse.json(await buildTeacherToday(session, unread));
  // director/accountant/counselor/org_admin (superadmin mobil token alamaz — Plan 2)
  return NextResponse.json(buildManagementToday(session, unread));
});
