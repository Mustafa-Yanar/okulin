import { NextResponse } from 'next/server';
import { gateRatelimit, getClientIp, formatResetWait, safeLimit } from '@/lib/ratelimit';
import { normalizeCode, hostForOrg } from '@/lib/orgcode';
import { tdb } from '@/lib/sqldb';

// Landing kurum kodu kapısı: kod → hedef subdomain çözer.
// Kurum-bağımsız (apex/landing'den çağrılır). Kod yoksa/pasifse 404.
export async function POST(req) {
  // Brute-force koruması (IP başına)
  const ip = getClientIp(req);
  const { success, reset } = await safeLimit(gateRatelimit, ip);
  if (!success) {
    return NextResponse.json(
      { error: `Çok fazla deneme. Lütfen ${formatResetWait(reset)} tekrar deneyin.` },
      { status: 429 }
    );
  }

  let body;
  try { body = await req.json(); } catch { body = {}; }
  const code = normalizeCode(body.code);
  if (!code || code.length < 4) {
    return NextResponse.json({ error: 'Geçersiz kurum kodu.' }, { status: 400 });
  }

  // Kod → kurum (Org.code; reverse kayda gerek yok). host = hostForOrg(slug,'main').
  const org = await tdb().org.findFirst({ where: { code } });
  if (!org) return NextResponse.json({ error: 'Bu koda ait kurum bulunamadı.' }, { status: 404 });
  if (org.active === false) return NextResponse.json({ error: 'Bu kurum şu anda aktif değil.' }, { status: 403 });
  return NextResponse.json({ ok: true, name: org.name, host: hostForOrg(org.slug, 'main') });
}
