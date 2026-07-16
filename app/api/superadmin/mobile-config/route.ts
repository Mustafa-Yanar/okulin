import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody } from '@/lib/validate';
import { MobileConfigUpdateSchema } from '@/lib/mobile/contracts';

// Mobil uygulama global konfigürasyonu — remote kill-switch (min sürüm / bakım /
// feature flag). GLOBAL tablo (kurum-bağımsız) → base prisma; yalnız superadmin.
export const runtime = 'nodejs';

export const GET = withAuth(['superadmin'], async () => {
  const cfg = await prisma.mobileAppConfig.findUnique({ where: { id: 'default' } });
  return NextResponse.json({ config: cfg });
});

export const PUT = withAuth(['superadmin'], async (req) => {
  const parsed = await parseBody(req, MobileConfigUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const cfg = await prisma.mobileAppConfig.upsert({
    where: { id: 'default' },
    create: { id: 'default', ...parsed.data, maintenanceMessage: parsed.data.maintenanceMessage ?? null },
    update: parsed.data,
  });
  return NextResponse.json({ ok: true, config: cfg });
});
