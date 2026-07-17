import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { trToday } from '@/lib/mobile/today';
import { buildStudentWeek, buildParentWeek, buildTeacherWeek, buildManagementWeek } from '@/lib/mobile/week';

// Rol-aware haftalık program (spec §5.1). ?week= ile gezinme (biçim doğrulanır;
// geçersizse bu haftaya düşer). ?child= yalnız veli. Servis HttpError → withMobileAuth çevirir.
export const runtime = 'nodejs';

const WEEK_RE = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/; // W01-W53 (İnceleme Codex #11: W00/W99 reddedilir → bu haftaya düşer)

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const raw = new URL(req.url).searchParams.get('week');
  const weekKey = raw && WEEK_RE.test(raw) ? raw : trToday().weekKey;

  if (session.role === 'student') return NextResponse.json(await buildStudentWeek(session, weekKey));
  if (session.role === 'parent') {
    const child = new URL(req.url).searchParams.get('child');
    return NextResponse.json(await buildParentWeek(session, weekKey, child));
  }
  if (session.role === 'teacher') return NextResponse.json(await buildTeacherWeek(session, weekKey));
  return NextResponse.json(buildManagementWeek(weekKey));
});
