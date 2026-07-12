import { NextResponse } from 'next/server';
import { currentOrg } from '@/lib/tenant';
import { withAuth } from '@/lib/auth';
import { normalizeBranding, isValidHex } from '@/lib/branding';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z } from '@/lib/validate';
import { tdb, tenant } from '@/lib/sqldb';
import type { Prisma } from '@prisma/client';

// Kurum (org) markası — SQL: Org modeli (name/shortName/logoUrl/themeColor).
// Kurum RESMİ bilgisi (ünvan/vergi/adres) — TenantConfig'te (şube-bazlı; muhasebe
// belgelerinde alacaklı kurum bilgisi + makbuz hardcoded'ını dinamikleştirir).
// GET: mevcut kurumun markası + resmi bilgisi. POST: müdür günceller.

// Bilinçli withAuth istisnası: login ekranı da okur — herkese açık.
export async function GET() {
  const org = currentOrg();
  const rec = await tdb().org.findFirst({ where: { slug: org } });
  const cfg = await tdb().tenantConfig.findFirst();
  const legal = {
    officialName: cfg?.officialName || '',
    taxOffice: cfg?.taxOffice || '',
    taxNo: cfg?.taxNo || '',
    officialAddress: cfg?.officialAddress || '',
  };
  return NextResponse.json({ org, branding: normalizeBranding(rec), legal });
}

// logoUrl güvenliği: yalnız kök-göreli (/...) veya http(s) — javascript: vb. şema engellenir.
function isSafeLogo(u: string): boolean {
  if (!u) return true; // boş = sıfırla
  return u.startsWith('/') || /^https?:\/\//i.test(u);
}

const OrgUpdateSchema = z.object({
  name: z.string().min(1, 'Kurum adı boş olamaz').max(120).optional(),
  shortName: z.string().max(60).optional(),
  logoUrl: z.string().max(500).optional(),
  themeColor: z.string().max(20).optional(),
  // Kurum resmi bilgisi (TenantConfig) — muhasebe belgeleri için
  officialName: z.string().max(200).optional(),
  taxOffice: z.string().max(120).optional(),
  taxNo: z.string().max(40).optional(),
  officialAddress: z.string().max(400).optional(),
});

export const POST = withAuth(['director'], async (req, _ctx, session) => {
  const parsed = await parseBody(req, OrgUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, shortName, logoUrl, themeColor, officialName, taxOffice, taxNo, officialAddress } = parsed.data;

  if (themeColor && !isValidHex(themeColor)) {
    return NextResponse.json({ error: 'Geçersiz renk — #RRGGBB biçiminde olmalı' }, { status: 400 });
  }
  if (logoUrl !== undefined && !isSafeLogo(logoUrl.trim())) {
    return NextResponse.json({ error: 'Geçersiz logo adresi (/, http://, https://)' }, { status: 400 });
  }

  const org = currentOrg();

  const data: Prisma.OrgUpdateInput = {};
  if (name !== undefined) data.name = name.trim();
  if (shortName !== undefined) data.shortName = shortName.trim() || null;
  if (logoUrl !== undefined) data.logoUrl = logoUrl.trim() || null;
  if (themeColor !== undefined) data.themeColor = themeColor || null;
  const existing = await tdb().org.findFirst({ where: { slug: org } });
  const nextBranding = existing
    ? await tdb().org.update({ where: { slug: org }, data })
    : await tdb().org.create({ data: { slug: org, name: (data.name as string) || org, ...data, active: true } as Prisma.OrgCreateInput });

  // Kurum resmi bilgisi (TenantConfig) — verilen alanlar güncellenir.
  const legalData: { officialName?: string | null; taxOffice?: string | null; taxNo?: string | null; officialAddress?: string | null } = {};
  if (officialName !== undefined) legalData.officialName = officialName.trim() || null;
  if (taxOffice !== undefined) legalData.taxOffice = taxOffice.trim() || null;
  if (taxNo !== undefined) legalData.taxNo = taxNo.trim() || null;
  if (officialAddress !== undefined) legalData.officialAddress = officialAddress.trim() || null;
  if (Object.keys(legalData).length > 0) {
    const { orgSlug, branch } = tenant();
    await tdb().tenantConfig.upsert({
      where: { orgSlug_branch: { orgSlug, branch } },
      create: { orgSlug, branch, ...legalData },
      update: legalData,
    });
  }

  await logAudit({
    ...actorFrom(session),
    action: 'org.brandingUpdate',
    target: { type: 'org', id: org, name: nextBranding.name || org },
    detail: `Kurum bilgisi güncellendi: ${nextBranding.name || org}`,
  });

  return NextResponse.json({ ok: true, branding: normalizeBranding(nextBranding) });
});
