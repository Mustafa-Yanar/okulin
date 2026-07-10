import twilio from 'twilio';
import { normalizeTurkishMobile } from './phone';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifySid = process.env.TWILIO_VERIFY_SID;

function client() {
  if (!accountSid || !authToken) throw new Error('Twilio yapılandırılmamış');
  return twilio(accountSid, authToken);
}

// Kanonik 10 haneli Türk numarasını E.164'e çevir.
// Girdi normalizeTurkishMobile çıktısı (10 hane, '5' ile başlar).
export function toE164(phone: string | null | undefined): string {
  const canonical = normalizeTurkishMobile(phone);
  if (canonical) return `+90${canonical}`;
  // Zaten +90 ile geliyorsa olduğu gibi döndür
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('90') && digits.length === 12) return `+${digits}`;
  return `+${digits}`;
}

export async function sendOtp(phone: string): Promise<string> {
  const e164 = toE164(phone);
  // verifySid env'den gelir; tanımsızsa Twilio çalışma anında hata verir (eski davranış).
  await client().verify.v2.services(verifySid as string).verifications.create({
    to: e164,
    channel: 'sms',
  });
  return e164;
}

export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  const e164 = toE164(phone);
  const result = await client().verify.v2.services(verifySid as string)
    .verificationChecks.create({ to: e164, code });
  return result.status === 'approved';
}
