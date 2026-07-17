import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { tdb } from '@/lib/sqldb';
import { parseBody } from '@/lib/validate';
import { InboxReadSchema } from '@/lib/mobile/contracts';
import { contentLimited } from '@/lib/mobile/limits';

// Bildirim merkezi (spec §8 inbox): NotificationEvent kullanıcının kalıcı bildirim
// kaydı. GET: sayfalı liste + unreadCount. POST: okundu (tek/all). Kilit ekranı
// jenerikleştirmesi yalnız push metnine uygulanır (renderPush) — inbox tam içerik.
// NotificationEvent normal tenant tablosu → tdb() orgSlug/branch otomatik enjekte
// eder; role+userId koşulu IDOR sınırı (kullanıcı yalnız kendi kutusunu görür).
export const runtime = 'nodejs';

// Opak bileşik imleç "<createdAtISO>_<id>" (İnceleme Codex #4: yalnız createdAt
// aynı milisaniyedeki kayıtları sayfa sınırında atlardı). İstemci yorumlamaz.
function parseCursor(raw: string): { at: Date; id: string } | null {
  const sep = raw.indexOf('_');
  if (sep <= 0) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  if (Number.isNaN(at.getTime()) || !id) return null;
  return { at, id };
}

const itemOut = (e: { id: string; title: string; body: string; url: string | null; createdAt: Date; readAt: Date | null }) => ({
  id: e.id,
  title: e.title,
  body: e.body,
  url: e.url,
  createdAt: e.createdAt.toISOString(),
  read: e.readAt != null,
});

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const userId = String(session.id ?? '');
  const unreadWhere = { role: session.role, userId, readAt: null };

  // Tek-kayıt modu (İnceleme Codex #8): push tap'i eski sayfada kalmış bir event'i
  // işaret edebilir — içerik yine gösterilebilsin. Sahiplik koşulu aynı (IDOR yok).
  const idParam = searchParams.get('id');
  if (idParam) {
    const [e, unreadCount] = await Promise.all([
      tdb().notificationEvent.findFirst({ where: { id: idParam, role: session.role, userId } }),
      tdb().notificationEvent.count({ where: unreadWhere }),
    ]);
    if (!e) return NextResponse.json({ error: 'Bildirim bulunamadı' }, { status: 404 });
    return NextResponse.json({ items: [itemOut(e)], nextBefore: null, unreadCount });
  }

  const beforeRaw = searchParams.get('before');
  const before = beforeRaw ? parseCursor(beforeRaw) : null;
  if (beforeRaw && !before) {
    return NextResponse.json({ error: 'before geçersiz' }, { status: 400 });
  }
  const limitRaw = parseInt(searchParams.get('limit') || '20', 10);
  const take = Math.min(Math.max(Number.isNaN(limitRaw) ? 20 : limitRaw, 1), 50);

  const [rows, unreadCount] = await Promise.all([
    tdb().notificationEvent.findMany({
      where: {
        role: session.role,
        userId,
        ...(before
          ? { OR: [{ createdAt: { lt: before.at } }, { createdAt: before.at, id: { lt: before.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1, // bir fazlası: sonraki sayfa var mı
    }),
    tdb().notificationEvent.count({ where: unreadWhere }),
  ]);
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  const nextBefore = rows.length > take && last ? `${last.createdAt.toISOString()}_${last.id}` : null;
  return NextResponse.json({ items: page.map(itemOut), nextBefore, unreadCount });
});

export const POST = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  const limited = await contentLimited(session.sid);
  if (limited) return limited;

  const parsed = await parseBody(req, InboxReadSchema);
  if (!parsed.ok) return parsed.response;
  const userId = String(session.id ?? '');

  // refine tam-bir-tanesi'ni garantiler; all değilse eventId kesin var (! güvenli —
  // devices route'un parsed.data.sessionId! deseniyle aynı).
  const where = parsed.data.all
    ? { role: session.role, userId, readAt: null }
    : { id: parsed.data.eventId!, role: session.role, userId, readAt: null };
  const r = await tdb().notificationEvent.updateMany({ where, data: { readAt: new Date() } });

  if (!parsed.data.all && r.count === 0) {
    // Ayrım: zaten-okunmuş (idempotent tekrar → ok) vs hiç yok/başkasının (404).
    const exists = await tdb().notificationEvent.findFirst({
      where: { id: parsed.data.eventId!, role: session.role, userId },
      select: { id: true },
    });
    if (!exists) return NextResponse.json({ error: 'Bildirim bulunamadı' }, { status: 404 });
  }

  const unreadCount = await tdb().notificationEvent.count({ where: { role: session.role, userId, readAt: null } });
  return NextResponse.json({ ok: true, updated: r.count, unreadCount });
});
