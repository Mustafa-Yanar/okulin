import { NextResponse } from 'next/server';
import { rawRedis, currentOrg } from '@/lib/tenant';
import { getSession } from '@/lib/auth';
import { normalizeBranding, isValidHex } from '@/lib/branding';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';

// Kurum (org) markası — `org:<slug>` GLOBAL kayıt (t: prefix YOK; raw redis).
// GET: mevcut kurumun markasını döner (giriş gerekmez — login ekranı da okur).
// POST: yalnız müdür kendi kurumunun adı/kısa adı/logosu/tema rengini günceller.

export async function GET() {
  const org = currentOrg();
  const rec = await rawRedis.get(`org:${org}`);
  return NextResponse.json({ org, branding: normalizeBranding(rec) });
}

// logoUrl güvenliği: yalnız kök-göreli (/...) veya http(s) — javascript: vb. şema engellenir.
function isSafeLogo(u) {
  if (!u) return true; // boş = sıfırla
  return u.startsWith('/') || /^https?:\/\//i.test(u);
}

const OrgUpdateSchema = z.object({
  name: z.string().min(1, 'Kurum adı boş olamaz').max(120).optional(),
  shortName: z.string().max(60).optional(),
  logoUrl: z.string().max(500).optional(),
  themeColor: z.string().max(20).optional(),
});

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, OrgUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, shortName, logoUrl, themeColor } = parsed.data;

  if (themeColor && !isValidHex(themeColor)) {
    return NextResponse.json({ error: 'Geçersiz renk — #RRGGBB biçiminde olmalı' }, { status: 400 });
  }
  if (logoUrl !== undefined && !isSafeLogo(logoUrl.trim())) {
    return NextResponse.json({ error: 'Geçersiz logo adresi (/, http://, https://)' }, { status: 400 });
  }

  const org = currentOrg();
  const key = `org:${org}`;
  const existing = (await rawRedis.get(key)) || { slug: org, active: true, createdAt: new Date().toISOString() };
  const next = { ...existing };
  if (name !== undefined) next.name = name.trim();
  if (shortName !== undefined) next.shortName = shortName.trim() || undefined;
  if (logoUrl !== undefined) next.logoUrl = logoUrl.trim() || undefined;
  if (themeColor !== undefined) next.themeColor = themeColor || undefined;

  await rawRedis.set(key, next);
  await logAudit({
    ...actorFrom(session),
    action: 'org.brandingUpdate',
    target: { type: 'org', id: org, name: next.name || org },
    detail: `Kurum markası güncellendi: ${next.name || org}`,
  });

  return NextResponse.json({ ok: true, branding: normalizeBranding(next) });
}
