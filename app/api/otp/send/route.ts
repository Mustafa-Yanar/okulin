import { NextResponse } from 'next/server';
import { sendOtp } from '@/lib/sms';
import { parseBody, z } from '@/lib/validate';

const Schema = z.object({ phone: z.string().min(10).max(20) });

// Bilinçli withAuth istisnası: OTP login akışının parçası — oturum henüz yok.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Schema);
  if (!parsed.ok) return parsed.response;
  const { phone } = parsed.data;
  try {
    await sendOtp(phone);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error && err.message ? err.message : 'SMS gönderilemedi' }, { status: 500 });
  }
}
