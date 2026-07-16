import { NextResponse, type NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { orgFromHost } from '@/lib/org';
import { parseBody } from '@/lib/validate';
import { MobileRefreshSchema } from '@/lib/mobile/contracts';
import { refreshMobileSession } from '@/lib/mobile/sessions';

// Refresh token rotation (spec §7): her kullanım yeni çift üretir, eskisi geçersizleşir;
// grace (30sn) dışı eski token kullanımı oturumu KAPATIR (reuse detection —
// lib/mobile/policy.ts). Tenant kilidi: arama tdb() üzerinden → başka kurumun
// host'una sunulan token bulunamaz. Fail-closed: yalnız kurum host'unda.
// Bilinçli withAuth istisnası: access token süresi dolmuşken çağrılır — Bearer yok.
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!orgFromHost(headers().get('host'))) {
    return NextResponse.json({ error: 'Geçersiz kurum adresi.' }, { status: 400 });
  }
  const parsed = await parseBody(req, MobileRefreshSchema);
  if (!parsed.ok) return parsed.response;
  const r = await refreshMobileSession(parsed.data.refreshToken);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ...r.pair, session: r.payload });
}
