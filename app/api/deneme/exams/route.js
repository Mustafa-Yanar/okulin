import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listExams, saveExam, addExamToIndex } from '@/lib/deneme/store';
import { getTemplate, flatSubjects } from '@/lib/deneme/template';
import { parseBody, z } from '@/lib/validate';

function isManager(s) {
  return s && (s.role === 'director' || s.role === 'counselor');
}

import { newSortableId as uuid } from '@/lib/id';

// Deneme listesi (meta) — giriş yapan herkes görür.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });
  const index = await listExams();
  return NextResponse.json({ exams: index });
}

const CreateSchema = z.object({
  name: z.string().min(1).max(200),
  date: z.string().max(40).optional(),
  examType: z.enum(['TYT', 'AYT', 'LGS']),
  kitapcikSayisi: z.number().int().min(1).max(2).optional(),
});

// Yeni boş sınav oluştur (müdür/rehber). Cevap anahtarı ve veri sonra eklenir.
export async function POST(req) {
  const session = await getSession();
  if (!isManager(session)) return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });

  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, date, examType, kitapcikSayisi = 1 } = parsed.data;

  if (!getTemplate(examType)) {
    return NextResponse.json({ error: 'Geçersiz sınav türü' }, { status: 400 });
  }

  const id = uuid();
  const iso = date ? new Date(date).toISOString() : new Date().toISOString();
  const exam = {
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
  await addExamToIndex(meta);

  return NextResponse.json({ ok: true, examId: id, exam: meta });
}
