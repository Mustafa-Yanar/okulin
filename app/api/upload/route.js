import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';

export const POST = withAuth('manage', async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!file) return NextResponse.json({ error: 'Dosya bulunamadı' }, { status: 400 });

  const ext = file.name.split('.').pop().toLowerCase();
  if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
    return NextResponse.json({ error: 'Sadece jpg, png, webp desteklenir' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 300 * 1024) {
    return NextResponse.json({ error: 'Fotoğraf 300KB\'dan küçük olmalı' }, { status: 400 });
  }

  const base64 = Buffer.from(bytes).toString('base64');
  const mimeType = file.type || 'image/jpeg';
  const dataUrl = `data:${mimeType};base64,${base64}`;

  return NextResponse.json({ url: dataUrl });
});
