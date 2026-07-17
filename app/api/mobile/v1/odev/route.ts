import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { OdevSubmitSchema } from '@/lib/mobile/contracts';
import { listOdevForStudent, listOdevForParent, submitOdev } from '@/lib/odev';
import { getOrgConfig } from '@/lib/config';
import { trToday, isPastDue } from '@/lib/mobile/today';
import type { ParentChildView } from '@/lib/mobile/api-types';

// Mobil ödev (spec §5.1): GET liste (öğrenci/veli), POST teslim (öğrenci). lib/odev
// servisini sarar (yeni iş mantığı yok). /api/odev cookie-only olduğundan mobil ayrı uç.
export const runtime = 'nodejs';

// lib/odev submission'ının wire şekline düzleştirilmesi (null → boş alanlar).
function subOut(sub: { status?: string; note?: string; score?: string; feedback?: string; submittedAt?: string; checkedAt?: string } | null) {
  return {
    status: sub?.status ?? '',
    note: sub?.note ?? '',
    score: sub?.score ?? '',
    feedback: sub?.feedback ?? '',
    submittedAt: sub?.submittedAt ?? '',
    checkedAt: sub?.checkedAt ?? '',
  };
}

export const GET = withMobileAuth(async (_req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const mods = await getOrgConfig('modules');
  if (mods.odev === false) return NextResponse.json({ error: 'Bu modül kurumunuzda kapalı' }, { status: 403 });
  const today = trToday().date;

  if (session.role === 'student') {
    const rows = await listOdevForStudent(String(session.cls ?? ''), String(session.id ?? ''));
    const items = rows.map((r) => {
      const s = subOut(r.sub as never);
      return {
        id: r.id, title: r.title, desc: r.desc, branch: r.branch, dueDate: r.dueDate,
        createdByName: r.createdByName, createdAt: r.createdAt ?? '',
        status: s.status, note: s.note, score: s.score, feedback: s.feedback,
        overdue: s.status === '' && isPastDue(r.dueDate, today),
      };
    });
    return NextResponse.json({ role: 'student', items });
  }

  if (session.role === 'parent') {
    const children: ParentChildView[] = (session.children ?? [])
      .map((c) => (typeof c === 'string' ? null : { id: String(c.id ?? ''), name: String(c.name ?? ''), cls: String(c.cls ?? '') }))
      .filter((c): c is ParentChildView => c != null && c.id !== '');
    const rows = await listOdevForParent(children.map((c) => ({ id: c.id, name: c.name, cls: c.cls })));
    const items = rows.map((r) => ({
      id: r.id, title: r.title, desc: r.desc, branch: r.branch, dueDate: r.dueDate,
      createdByName: r.createdByName, createdAt: r.createdAt ?? '',
      children: r.children.map((ch) => ({
        childId: String(ch.childId ?? ''), childName: String(ch.childName ?? ''),
        cls: String(ch.cls ?? ''), status: subOut(ch.sub as never).status,
      })),
    }));
    return NextResponse.json({ role: 'parent', items });
  }

  return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
});

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, OdevSubmitSchema);
  if (!parsed.ok) return parsed.response;
  // studentId + cls session'dan (öğrenci başkası adına teslim edemez) — web submit paritesi.
  const r = await submitOdev({ id: parsed.data.id, studentId: String(session.id ?? ''), cls: String(session.cls ?? ''), note: parsed.data.note, done: parsed.data.done });
  return NextResponse.json({ ok: true, status: r.status });
});
