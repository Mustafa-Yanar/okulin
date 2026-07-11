import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { listExams, saveExam, addExamToIndex } from '@/lib/deneme/store';
import { getTemplate, flatSubjects } from '@/lib/deneme/template';
import { parseBody, z } from '@/lib/validate';

import { newSortableId as uuid } from '@/lib/id';
import type { DenemeExam } from '@/lib/deneme/types';

// Deneme listesi (meta) — giriş yapan herkes görür.
export const GET = withAuth('auth', 'deneme', async () => {
  const index = await listExams();
  return NextResponse.json({ exams: index });
});

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().max(40).optional(),
  examType: z.enum(['TYT', 'AYT', 'LGS']),
  kitapcikSayisi: z.number().int().min(1).max(2).optional(),
});

// Yeni boş sınav oluştur (müdür/rehber). Cevap anahtarı ve veri sonra eklenir.
export const POST = withAuth(['director', 'counselor'], 'deneme', async (req) => {

  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, date, examType, kitapcikSayisi = 1 } = parsed.data;

  if (!getTemplate(examType)) {
    return NextResponse.json({ error: 'Geçersiz sınav türü' }, { status: 400 });
  }

  const id = uuid();
  const iso = date ? new Date(date).toISOString() : new Date().toISOString();
  const exam: DenemeExam = {
    id,
    name: name.trim(),
    examType,
    category: null,
    date: iso,
    kitapcikSayisi,
    subjectKeys: flatSubjects(examType).map((s) => s.key),
    answerKey: {}, // { A:{boxKey:rawString}, B:{...} } — answerkey route doldurur
    rows: [],
    createdAt: Date.now(),
  };
  await saveExam(exam);

  const meta = { id, name: exam.name, examType, category: null, date: iso, createdAt: exam.createdAt };
  await addExamToIndex();

  return NextResponse.json({ ok: true, examId: id, exam: meta });
});
