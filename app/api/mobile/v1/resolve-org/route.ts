import { NextResponse } from 'next/server';
import { gateRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
import { normalizeCode, hostForOrg } from '@/lib/orgcode';
import { normalizeBranding } from '@/lib/branding';
import { parseBody } from '@/lib/validate';
import { ResolveOrgSchema } from '@/lib/mobile/contracts';
import { tdb } from '@/lib/sqldb';

// Mobil kurum keşfi (spec §6): kurum kodu → canonical host + marka.
// /api/gate'in mobil karşılığı — apex'ten çağrılır, istemci YALNIZ dönen
// canonicalHost'a bağlanır (serbest girilmiş host'a asla).
// Bilinçli withAuth istisnası: ilk açılış akışı — oturum kavramı henüz yok.
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success, reset } = await safeLimit(gateRatelimit, ip);
  if (!success) {
    return NextResponse.json(
      { error: `Çok fazla deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }

  const parsed = await parseBody(req, ResolveOrgSchema);
  if (!parsed.ok) return parsed.response;
  const code = normalizeCode(parsed.data.code);
  if (!code || code.length < 4) {
    return NextResponse.json({ error: 'Geçersiz kurum kodu.' }, { status: 400 });
  }

  const org = await tdb().org.findFirst({ where: { code } }); // Org global tablo (SKIP)
  if (!org) return NextResponse.json({ error: 'Bu koda ait kurum bulunamadı.' }, { status: 404 });
  if (org.active === false) return NextResponse.json({ error: 'Bu kurum şu anda aktif değil.' }, { status: 403 });

  const branding = normalizeBranding(org);
  return NextResponse.json({
    ok: true,
    orgSlug: org.slug,
    branch: 'main', // kurum kodu main şubeye çözer (gate paritesi); şube geçişi deep-link işi
    name: branding.name,
    shortName: branding.shortName,
    logoUrl: branding.logoUrl,
    themeColor: branding.themeColor,
    canonicalHost: hostForOrg(org.slug, 'main'),
    active: true,
  });
}
