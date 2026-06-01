import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSession } from '@/lib/auth';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB (PDF için geniş limit)
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

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

function cleanJson(raw) {
  return raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/, '').trim();
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'superadmin')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY yapılandırılmamış' }, { status: 500 });
  }

  let formData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Form verisi okunamadı' }, { status: 400 });
  }

  const file = formData.get('image');
  if (!file) return NextResponse.json({ error: 'image alanı eksik' }, { status: 400 });

  const mimeType = file.type || 'application/octet-stream';
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Sadece jpg, png, webp veya pdf desteklenir' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Dosya 20 MB\'dan küçük olmalı' }, { status: 400 });
  }

  const isPdf = mimeType === 'application/pdf';
  let base64Data;
  let effectiveMime;

  if (isPdf) {
    // PDF: Sharp gerekmez, doğrudan Gemini'ye gönder
    base64Data = Buffer.from(bytes).toString('base64');
    effectiveMime = 'application/pdf';
  } else {
    // Görüntü: Sharp ile 1600px'e küçült
    try {
      const processed = await sharp(Buffer.from(bytes))
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();
      base64Data = processed.toString('base64');
      effectiveMime = 'image/jpeg';
    } catch {
      return NextResponse.json({ error: 'Görüntü işlenemedi' }, { status: 400 });
    }
  }

  // Gemini çağrısı
  let raw = '';
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = isPdf ? PROMPT_PDF : PROMPT_IMAGE;
    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: effectiveMime } },
    ]);
    raw = result.response.text().trim();
  } catch (err) {
    return NextResponse.json({ error: 'Gemini API hatası: ' + err.message }, { status: 502 });
  }

  // JSON parse — her iki prompt da {"forms":[...]} döndürür
  try {
    const parsed = JSON.parse(cleanJson(raw));
    if (!Array.isArray(parsed.forms) || parsed.forms.length === 0) throw new Error('forms dizisi yok');
    return NextResponse.json({ forms: parsed.forms, pageCount: parsed.forms.length });
  } catch {
    return NextResponse.json({ forms: null, pageCount: 0, raw }, { status: 422 });
  }
}
