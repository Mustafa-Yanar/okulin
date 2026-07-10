import { NextResponse } from 'next/server';
import { getSession, withAuth, type Session } from '@/lib/auth';
import { logError, getErrors } from '@/lib/errlog';
import { errorLogRatelimit, getClientIp, safeLimit } from '@/lib/ratelimit';
import { parseBody, z } from '@/lib/validate';

// İstemci hata raporu gövdesi (hepsi opsiyonel, message zorunlu).
const ErrorReportSchema = z.object({
  message: z.string().min(1).max(2000),
  stack: z.string().max(8000).optional(),
  source: z.enum(['window', 'unhandledrejection', 'react', 'manual']).optional(),
  url: z.string().max(500).optional(),
  componentStack: z.string().max(8000).optional(),
});

// POST /api/log — istemci hatası kaydet.
// Bilinçli withAuth istisnası: auth ZORUNLU DEĞİL — hata giriş öncesi de olabilir.
// IP başına rate limit + boyut sınırı korur.
export async function POST(req: Request) {
  const ip = getClientIp(req);
  const { success } = await safeLimit(errorLogRatelimit, ip);
  if (!success) return NextResponse.json({ error: 'Çok fazla istek' }, { status: 429 });

  const parsed = await parseBody(req, ErrorReportSchema);
  if (!parsed.ok) return parsed.response;

  // Varsa oturum bilgisini ekle (kim yaşadı) — yoksa anonim.
  let session: Session | null = null;
  try { session = await getSession(); } catch {}

  await logError({
    ...parsed.data,
    userAgent: req.headers.get('user-agent') || '',
    role: session?.role || '',
    userId: session?.id || '',
    userName: session?.name || '',
  });

  return NextResponse.json({ ok: true });
}

// GET /api/log — son hata kayıtları (sadece müdür).
export const GET = withAuth(['director'], async () => {
  const errors = await getErrors();
  return NextResponse.json(errors);
});
