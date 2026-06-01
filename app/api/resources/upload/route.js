import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { getSession } from '@/lib/auth';

// Vercel Blob client-side upload token üretici.
// PDF dosyaları doğrudan tarayıcıdan Blob'a yüklenir (4.5MB serverless gövde
// sınırına takılmamak için). Bu route sadece imzalı token üretir + yetki denetler.

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'teacher')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const body = await req.json();
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
    return NextResponse.json({ error: err.message || 'Yükleme başlatılamadı' }, { status: 400 });
  }
}
