import crypto from 'node:crypto';

// Ödeme sağlayıcı gizli anahtarlarını (merchant_key, merchant_salt) BEKLEMEDE
// şifrelemek için AES-256-GCM. Düz secret Redis'e ASLA yazılmaz.
//
// Ana anahtar: env PAYMENT_ENC_KEY.
//  - 64 hex karakter ise (32 bayt) doğrudan kullanılır.
//  - değilse SHA-256'dan 32 baytlık anahtar türetilir (her string'i kabul et).
//
// Saklama biçimi:  v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
// GCM auth tag, kurcalamayı yakalar → decrypt bozuk veride hata fırlatır.

function masterKey(): Buffer {
  const raw = process.env.PAYMENT_ENC_KEY;
  if (!raw) throw new Error('PAYMENT_ENC_KEY tanımlı değil');
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

// Düz metni şifreler. Boş/undefined ise null döner (alan girilmemiş demektir).
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === undefined || plain === null || plain === '') return null;
  const key = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

// Şifreli değeri çözer. Boş ise null. Biçim/anahtar bozuksa hata fırlatır.
export function decryptSecret(enc: string | null | undefined): string | null {
  if (!enc) return null;
  const parts = String(enc).split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Geçersiz şifreli biçim');
  const key = masterKey();
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(ct), decipher.final()]);
  return out.toString('utf8');
}
