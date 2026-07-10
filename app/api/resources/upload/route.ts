import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { withAuth } from '@/lib/auth';

// Vercel Blob client-side upload token üretici.
// PDF dosyaları doğrudan tarayıcıdan Blob'a yüklenir (4.5MB serverless gövde
// sınırına takılmamak için). Bu route sadece imzalı token üretir + yetki denetler.

export const POST = withAuth(['director', 'teacher'], async (req) => {
  const body = (await req.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ['application/pdf'],
        maximumSizeInBytes: 20 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      // onUploadCompleted localhost'ta tetiklenmez; metadata kaydını client yapar.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Yükleme başlatılamadı' }, { status: 400 });
  }
});
