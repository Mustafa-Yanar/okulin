import { NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * Gövdeyi güvenle JSON'a çevirip Zod şemasıyla doğrular.
 *
 * Döner: { ok: true, data } | { ok: false, response }
 * - Bozuk JSON → 400 (eskiden req.json() 500 fırlatıyordu).
 * - Şema hatası → 400 + ilk anlamlı hata mesajı.
 *
 * Kullanım:
 *   const parsed = await parseBody(req, StudentCreateSchema);
 *   if (!parsed.ok) return parsed.response;
 *   const { name, cls } = parsed.data;
 */
export async function parseBody(req, schema) {
  let raw;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Geçersiz istek gövdesi (JSON bekleniyor)' }, { status: 400 }) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? `${first.path.join('.')}: ` : '';
    const msg = first?.message || 'Geçersiz veri';
    return { ok: false, response: NextResponse.json({ error: `${path}${msg}` }, { status: 400 }) };
  }
  return { ok: true, data: result.data };
}

// — Yeniden kullanılabilir alan şemaları —

// Ad/kullanıcı adı: boş olmayan, makul uzunlukta string (string olmayan → reddet).
// Trim YOK — saklı username ile birebir eşleşme ve mevcut davranış korunsun.
export const zName = z.string().min(1, 'Boş olamaz').max(200, 'Çok uzun');

// Şifre: boş olmayan string, makul üst sınır (DoS önler).
export const zPassword = z.string().min(1, 'Şifre boş olamaz').max(200, 'Çok uzun');

// Yeni şifre: client en az 6 karakter zorunlu kılıyor — sunucu da aynı kuralı uygular.
export const zNewPassword = z.string().min(6, 'En az 6 karakter').max(200, 'Çok uzun');

// Kayıt id'si: kısa alfanümerik token (makeId çıktısı) — tip karışıklığını engeller.
export const zId = z.string().min(1).max(100);

// Para: client string veya number gönderebilir → güvenli sayıya çevir, negatifi reddet.
export const zMoney = z.coerce.number().finite().min(0).max(100_000_000);

// String dizi (branş, grup vb.). Eleman tipini garanti eder → prototype pollution / crash önler.
export const zStringArray = z.array(z.string().max(200)).max(500);

export { z };
