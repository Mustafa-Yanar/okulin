import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { logError, getErrors } from '@/lib/errlog';
import { errorLogRatelimit, getClientIp } from '@/lib/ratelimit';
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
// Auth ZORUNLU DEĞİL: hata giriş öncesi de olabilir. IP başına rate limit + boyut sınırı korur.
export async function POST(req) {
  const ip = getClientIp(req);
  const { success } = await errorLogRatelimit.limit(ip);
  if (!success) return NextResponse.json({ ok: false }, { status: 429 });

  const parsed = await parseBody(req, ErrorReportSchema);
  if (!parsed.ok) return parsed.response;

  // Varsa oturum bilgisini ekle (kim yaşadı) — yoksa anonim.
  let session = null;
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
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }
  const errors = await getErrors();
  return NextResponse.json(errors);
}
