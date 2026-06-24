import { NextResponse } from 'next/server';
import { rawRedis } from '@/lib/tenant';
import { gateRatelimit, getClientIp, formatResetWait } from '@/lib/ratelimit';
import { normalizeCode, hostForOrg } from '@/lib/orgcode';
import { useSql } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// Landing kurum kodu kapısı: kod → hedef subdomain çözer.
// Kurum-bağımsız (apex/landing'den çağrılır) → rawRedis (t: prefix YOK).
// orgcode:<KOD> → { slug, branch, name, host }. Kod yoksa/pasifse 404.
export async function POST(req) {
  // Brute-force koruması (IP başına)
  const ip = getClientIp(req);
  const { success, reset } = await gateRatelimit.limit(ip);
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

  // Kod → kurum (SQL: Org.code; reverse kayda gerek yok). host = hostForOrg(slug,'main').
  if (useSql()) {
    const org = await tdb().org.findFirst({ where: { code } });
    if (!org) return NextResponse.json({ error: 'Bu koda ait kurum bulunamadı.' }, { status: 404 });
    if (org.active === false) return NextResponse.json({ error: 'Bu kurum şu anda aktif değil.' }, { status: 403 });
    return NextResponse.json({ ok: true, name: org.name, host: hostForOrg(org.slug, 'main') });
  }

  let rec = await rawRedis.get(`orgcode:${code}`);
  if (typeof rec === 'string') { try { rec = JSON.parse(rec); } catch { rec = null; } }
  if (!rec || !rec.host) {
    return NextResponse.json({ error: 'Bu koda ait kurum bulunamadı.' }, { status: 404 });
  }

  // Kurum pasifse girişe izin verme
  let org = await rawRedis.get(`org:${rec.slug}`);
  if (typeof org === 'string') { try { org = JSON.parse(org); } catch { org = null; } }
  if (org && org.active === false) {
    return NextResponse.json({ error: 'Bu kurum şu anda aktif değil.' }, { status: 403 });
  }

  return NextResponse.json({ ok: true, name: rec.name, host: rec.host });
}
