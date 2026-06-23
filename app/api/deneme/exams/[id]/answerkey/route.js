import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getExam, saveExam } from '@/lib/deneme/store';
import { validateBoxes } from '@/lib/deneme/template';
import { parseBody, z } from '@/lib/validate';

function isManager(s) {
  return s && (s.role === 'director' || s.role === 'counselor');
}

const KeySchema = z.object({
  kitapcik: z.enum(['A', 'B']),
  answers: z.record(z.string().max(400)),
});

// Bir kitapçığın cevap anahtarını kaydet/güncelle (müdür/rehber).
// body: { kitapcik:'A'|'B', answers:{ [boxKey]: 'ABCDE...' } }
export async function PUT(req, { params }) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, KeySchema);
  if (!parsed.ok) return parsed.response;
  const { kitapcik, answers } = parsed.data;

  const exam = await getExam(params.id);
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });

  const check = validateBoxes(exam.examType, answers);
  if (!check.ok) {
    const msg = check.errors
      .map((e) => `${e.label}: ${e.got}/${e.expected}`)
      .join(', ');
    return NextResponse.json({ error: `Eksik/fazla cevap → ${msg}`, errors: check.errors }, { status: 400 });
  }

  // Normalize: boşlukları temizleyip büyük harfe çevir (saklamada düzenli dursun).
  const clean = {};
  for (const [k, v] of Object.entries(answers)) {
    clean[k] = String(v).replace(/\s/g, '').toLocaleUpperCase('tr');
  }

  exam.answerKey = exam.answerKey || {};
  exam.answerKey[kitapcik] = clean;
  await saveExam(exam);

  return NextResponse.json({ ok: true });
}
