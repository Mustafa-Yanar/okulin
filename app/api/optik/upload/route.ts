import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { withAuth } from '@/lib/auth';

// Optik form (PDF/görüntü) Blob client-upload token üretici — dosya doğrudan
// tarayıcıdan Blob'a yüklenir, Vercel'in ~4.5MB serverless gövde sınırına takılmaz.
// Gerçek boyut sınırı artık Gemini tarafında (bkz /api/optik): burada geniş bir
// üst sınır (fonksiyon bellek/zaman aşımı koruması) yeterli.
export const POST = withAuth(['director', 'counselor', 'superadmin'], 'deneme', async (req) => {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
        maximumSizeInBytes: 50 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Yükleme başlatılamadı' }, { status: 400 });
  }
});
