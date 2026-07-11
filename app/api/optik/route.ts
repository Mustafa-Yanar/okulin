import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, FileState } from '@google/generative-ai/server';
import { del } from '@vercel/blob';
import { withAuth } from '@/lib/auth';

// Gemini generateContent inline_data toplam istek boyutunu ~20MB'la sınırlıyor.
// base64 ~%33 şişirdiği için ham dosya bu eşiğin altında kalmalı; üstündeki
// PDF'ler Gemini Files API'a (uploadFile → fileData referansı) yönlendirilir.
const INLINE_LIMIT_BYTES = 14 * 1024 * 1024;
// Kendi fonksiyonumuzun bellek/süre sınırını koruyan üst tavan — gerçek dosyalar
// (taranmış optik formlar) bunun çok altında kalır, pratikte "sınırsız" davranır.
const HARD_LIMIT_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// Vercel Blob public store URL'i — SSRF'i önlemek için sadece bu host'tan fetch edilir.
const BLOB_HOST_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\//i;

const PROMPT_IMAGE = `Bu bir optik form (çoktan seçmeli sınav cevap kağıdı) fotoğrafı.
Karartılmış veya işaretlenmiş balonları oku.
Her soru için işaretlenen seçeneği tespit et: "A", "B", "C", "D" veya "E".
Eğer bir soru boş bırakılmışsa veya okunamıyorsa null yaz.
Cevapları soru numarasına göre sıralı JSON olarak döndür, başka hiçbir metin ekleme:
{"forms":[{"page":1,"answers":["A","C",null,"B","E"],"total":5}]}`;

const PROMPT_PDF = `Bu PDF bir veya birden fazla optik form (çoktan seçmeli sınav cevap kağıdı) içeriyor.
Her sayfa ayrı bir öğrencinin cevap kağıdıdır.
Her sayfa için karartılmış/işaretli balonları oku.
Her soru için işaretlenen seçeneği tespit et: "A", "B", "C", "D" veya "E".
Boş veya okunamayan sorular için null yaz.
Tüm sayfaları sırasıyla JSON olarak döndür, başka hiçbir metin ekleme:
{"forms":[{"page":1,"answers":["A","C",null],"total":40},{"page":2,"answers":["B","A","C"],"total":40}]}`;

function cleanJson(raw: string): string {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
}

async function waitUntilActive(fileManager: GoogleAIFileManager, name: string): Promise<void> {
  for (let i = 0; i < 20; i++) { // ~20 × 1.5s = 30s üst sınır
    const meta = await fileManager.getFile(name);
    if (meta.state === FileState.ACTIVE) return;
    if (meta.state === FileState.FAILED) throw new Error('Gemini dosya işleme başarısız oldu');
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('Gemini dosya işleme zaman aşımına uğradı');
}

export const POST = withAuth(['director', 'counselor', 'superadmin'], 'deneme', async (req) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY yapılandırılmamış' }, { status: 500 });
  }

  let body: { url?: string; mimeType?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'İstek gövdesi okunamadı' }, { status: 400 });
  }

  const { url, mimeType } = body;
  if (!url || !BLOB_HOST_RE.test(url)) {
    return NextResponse.json({ error: 'Geçersiz dosya URL\'i' }, { status: 400 });
  }
  if (!mimeType || !ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Sadece jpg, png, webp veya pdf desteklenir' }, { status: 400 });
  }

  let bytes: ArrayBuffer;
  try {
    const fileRes = await fetch(url);
    if (!fileRes.ok) throw new Error('fetch başarısız');
    bytes = await fileRes.arrayBuffer();
  } catch {
    return NextResponse.json({ error: 'Dosya alınamadı' }, { status: 400 });
  } finally {
    // Optik taramalar geçici işlem girdisi — okuma sonrası Blob'da tutulmaz.
    del(url).catch(() => {});
  }

  if (bytes.byteLength > HARD_LIMIT_BYTES) {
    return NextResponse.json({ error: 'Dosya 50 MB\'dan küçük olmalı' }, { status: 400 });
  }

  const isPdf = mimeType === 'application/pdf';
  let raw = '';
  let uploadedGeminiFile: string | null = null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    if (isPdf && bytes.byteLength > INLINE_LIMIT_BYTES) {
      // Büyük PDF: Gemini Files API — yükle, işlenmesini bekle, URI ile referansla.
      const fileManager = new GoogleAIFileManager(apiKey);
      const uploaded = await fileManager.uploadFile(Buffer.from(bytes), { mimeType: 'application/pdf' });
      uploadedGeminiFile = uploaded.file.name;
      await waitUntilActive(fileManager, uploaded.file.name);
      const result = await model.generateContent([
        PROMPT_PDF,
        { fileData: { fileUri: uploaded.file.uri, mimeType: 'application/pdf' } },
      ]);
      raw = result.response.text().trim();
    } else if (isPdf) {
      const base64Data = Buffer.from(bytes).toString('base64');
      const result = await model.generateContent([
        PROMPT_PDF,
        { inlineData: { data: base64Data, mimeType: 'application/pdf' } },
      ]);
      raw = result.response.text().trim();
    } else {
      // Görüntü: Sharp ile 1600px'e küçült (her zaman inline sınırının çok altında kalır)
      let processed: Buffer;
      try {
        processed = await sharp(Buffer.from(bytes))
          .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
      } catch {
        return NextResponse.json({ error: 'Görüntü işlenemedi' }, { status: 400 });
      }
      const result = await model.generateContent([
        PROMPT_IMAGE,
        { inlineData: { data: processed.toString('base64'), mimeType: 'image/jpeg' } },
      ]);
      raw = result.response.text().trim();
    }
  } catch (err) {
    return NextResponse.json({ error: 'Gemini API hatası: ' + (err instanceof Error ? err.message : err) }, { status: 502 });
  } finally {
    if (uploadedGeminiFile) {
      const fileManager = new GoogleAIFileManager(apiKey);
      fileManager.deleteFile(uploadedGeminiFile).catch(() => {});
    }
  }

  // JSON parse — her iki prompt da {"forms":[...]} döndürür
  try {
    const parsed = JSON.parse(cleanJson(raw));
    if (!Array.isArray(parsed.forms) || parsed.forms.length === 0) throw new Error('forms dizisi yok');
    return NextResponse.json({ forms: parsed.forms, pageCount: parsed.forms.length });
  } catch {
    return NextResponse.json({ forms: null, pageCount: 0, raw }, { status: 422 });
  }
});
