import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { orgFromHost, branchFromHost } from '@/lib/org';
import { normalizeBranding } from '@/lib/branding';
import { getOrgConfig } from '@/lib/config';

// Mobil bootstrap (spec §9/3): sürüm kapısı + bakım + feature flag (remote
// kill-switch) + kurum host'unda marka/modüller. MobileAppConfig GLOBAL tek satır
// (superadmin yönetir) → base prisma.
// Bilinçli withAuth istisnası: login ÖNCESİ de çağrılır — kill-switch her durumda çalışmalı.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // bakım anahtarı asla cache'lenmesin

export async function GET() {
  const cfg = await prisma.mobileAppConfig.findUnique({ where: { id: 'default' } });

  // Kurum bölümü yalnız kurum host'unda (apex'te org sızdırılmaz — orgFromHost apex'te null).
  const host = headers().get('host');
  const orgSlug = orgFromHost(host);
  let org: Record<string, unknown> | null = null;
  if (orgSlug) {
    const rec = await prisma.org.findUnique({ where: { slug: orgSlug } });
    if (rec) {
      const modules = await getOrgConfig('modules'); // istek tenant bağlamı (x-org) bu org
      org = {
        slug: rec.slug,
        branch: branchFromHost(host) || 'main',
        ...normalizeBranding(rec),
        active: rec.active !== false,
        modules,
      };
    }
  }

  return NextResponse.json({
    minSupportedVersion: cfg?.minSupportedVersion || '0.0.0',
    recommendedVersion: cfg?.recommendedVersion || '0.0.0',
    maintenance: { active: cfg?.maintenance ?? false, message: cfg?.maintenanceMessage || null },
    flags: (cfg?.flags as Record<string, boolean> | null) || {},
    serverTime: new Date().toISOString(),
    org,
  });
}
