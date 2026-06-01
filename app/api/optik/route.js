import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getSession } from '@/lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const PROMPT = `Bu bir optik form (çoktan seçmeli sınav cevap kağıdı) fotoğrafı.
Karartılmış veya işaretlenmiş balonları oku.
Her soru için işaretlenen seçeneği tespit et: "A", "B", "C", "D" veya "E".
Eğer bir soru boş bırakılmışsa veya okunamıyorsa null yaz.
Cevapları soru numarasına göre sıralı JSON olarak döndür, başka hiçbir metin ekleme:
{"answers":["A","C",null,"B","E"],"total":5}`;

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'superadmin')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GEMINI_API_KEY yapılandırılmamış' }, { status: 500 });
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Form verisi okunamadı' }, { status: 400 });
  }

  const file = form.get('image');
  if (!file) return NextResponse.json({ error: 'image alanı eksik' }, { status: 400 });

  const mimeType = file.type || 'image/jpeg';
  if (!ALLOWED_TYPES.includes(mimeType)) {
    return NextResponse.json({ error: 'Sadece jpg, png, webp desteklenir' }, { status: 400 });
  }

  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Dosya 5 MB\'dan küçük olmalı' }, { status: 400 });
  }

  // Sharp ile boyut küçültme (uzun kenar → 1600px)
  let processed;
  try {
    processed = await sharp(Buffer.from(bytes))
      .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: 'Görüntü işlenemedi' }, { status: 400 });
  }

  const base64Image = processed.toString('base64');

  // Gemini Vision çağrısı
  let raw = '';
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await model.generateContent([
      PROMPT,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
    ]);
    raw = result.response.text().trim();
  } catch (err) {
    return NextResponse.json({ error: 'Gemini API hatası: ' + err.message }, { status: 502 });
  }

  // JSON parse
  try {
    // Gemini bazen ```json ... ``` sarıyor — temizle
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.answers)) throw new Error('answers dizisi yok');
    return NextResponse.json({ answers: parsed.answers, total: parsed.total ?? parsed.answers.length });
  } catch {
    // Parse başarısız — ham çıktıyı döndür, kullanıcı görsün
    return NextResponse.json({ answers: null, total: 0, raw }, { status: 422 });
  }
}
