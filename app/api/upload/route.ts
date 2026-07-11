import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

// Dosya içeriğinin ilk baytlarından (magic number) gerçek görüntü türünü belirler.
// Uzantı/client MIME değiştirilebilir; imza taklit edilemez → sahte içerik reddedilir.
const IMAGE_MIME: Record<'jpg' | 'png' | 'webp', string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};
function sniffImage(b: Uint8Array): keyof typeof IMAGE_MIME | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  // RIFF....WEBP
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

export const POST = withAuth('manage', async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Dosya bulunamadı' }, { status: 400 });

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return NextResponse.json({ error: 'Sadece jpg, png, webp desteklenir' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 300 * 1024) {
    return NextResponse.json({ error: 'Fotoğraf 300KB\'dan küçük olmalı' }, { status: 400 });
  }

  // Magic-byte doğrulama: gerçek içerik gerçekten jpg/png/webp mi? MIME'i imzadan türet
  // (client'ın gönderdiği file.type'a güvenme → maskeli içerik/data-URL enjeksiyonu önlenir).
  const buf = new Uint8Array(bytes);
  const kind = sniffImage(buf);
  if (!kind) {
    return NextResponse.json({ error: 'Dosya içeriği geçerli bir görüntü değil (jpg/png/webp)' }, { status: 400 });
  }

  const base64 = Buffer.from(bytes).toString('base64');
  const dataUrl = `data:${IMAGE_MIME[kind]};base64,${base64}`;

  return NextResponse.json({ url: dataUrl });
});
