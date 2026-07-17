import { NextResponse } from 'next/server';
import { mobileContentRatelimit, formatResetWait, safeLimit } from '@/lib/ratelimit';

// İçerik uçları ortak rate-limit yanıtı (notifications + screens/today).
// null = devam; NextResponse = 429 döndür.
export async function contentLimited(sid: string): Promise<NextResponse | null> {
  const hit = await safeLimit(mobileContentRatelimit, `sid:${sid}`);
  if (hit.success) return null;
  return NextResponse.json(
    { error: `Çok fazla istek. Lütfen ${formatResetWait(hit.reset)} tekrar deneyin.` },
    { status: 429 },
  );
}
