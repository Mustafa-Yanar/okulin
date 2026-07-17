import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { parseBody } from '@/lib/validate';
import { NotifPrefUpdateSchema } from '@/lib/mobile/contracts';
import { categoriesForRole, getMutedCategories, setPref, NOTIF_CATEGORY_LABELS } from '@/lib/notify-prefs';

// Bildirim kategori tercihleri (spec §5.1). GET role-relevant kategori+durum listesi;
// POST tekil toggle. guvenlik kategorisi listede YOK (susturulamaz).
export const runtime = 'nodejs';

async function buildItems(role: string, userId: string) {
  const cats = categoriesForRole(role);
  const muted = await getMutedCategories(role, userId);
  return cats.map((category) => ({ category, label: NOTIF_CATEGORY_LABELS[category], enabled: !muted.has(category) }));
}

export const GET = withMobileAuth(async (_req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  return NextResponse.json({ items: await buildItems(session.role, String(session.id ?? '')) });
});

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const parsed = await parseBody(req, NotifPrefUpdateSchema);
  if (!parsed.ok) return parsed.response;
  // role-relevant olmayan kategori (ör. öğrenciye devamsizlik) reddedilir.
  if (!categoriesForRole(session.role).includes(parsed.data.category)) {
    return NextResponse.json({ error: 'Bu kategori rolünüz için geçerli değil' }, { status: 400 });
  }
  await setPref(session.role, String(session.id ?? ''), parsed.data.category, parsed.data.enabled);
  return NextResponse.json({ ok: true, items: await buildItems(session.role, String(session.id ?? '')) });
});
