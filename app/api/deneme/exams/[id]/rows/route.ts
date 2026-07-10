import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { getExam, saveExam, getNameMap, normName, getAllStudents } from '@/lib/deneme/store';
import { gradeFlat } from '@/lib/deneme/grade';
import { parseBody, z } from '@/lib/validate';

import { newSortableId as rowId } from '@/lib/id';

const AddSchema = z.object({
  source: z.enum(['optik', 'dat', 'manual']).optional(),
  kitapcik: z.enum(['A', 'B']).optional(),
  students: z
    .array(
      z.object({
        name: z.string().max(200),
        // Öğrenci başına kitapçık (.dat karışık A/B içerir); yoksa batch kitapcik.
        kitapcik: z.enum(['A', 'B']).optional(),
        // Cevaplar düz dizi: 'A'..'E' | null | '' (booklet sırası)
        answers: z.array(z.string().nullable()).max(400),
      })
    )
    .min(1)
    .max(2000),
});

// Sınava öğrenci satırı ekle (optik/manuel/.dat). Anahtar varsa anında puanlar,
// isimden öğrenci eşleştirir (kalıcı namemap + öğrenci adı/kullanıcı adı).
export const POST = withAuth(['director', 'counselor'], async (req, ctx) => {

  const parsed = await parseBody(req, AddSchema);
  if (!parsed.ok) return parsed.response;
  const { source = 'optik', kitapcik = 'A', students } = parsed.data;

  const exam = await getExam(String(ctx.params?.id));
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });
  if (!Array.isArray(exam.rows)) exam.rows = [];

  // İsim → studentId eşleştirme kaynakları
  const nameMap = await getNameMap();
  const allStudents = await getAllStudents();
  const byName: Record<string, string> = {};
  for (const s of allStudents) {
    byName[normName(s.name)] = s.id;
    if (s.username) byName[normName(s.username)] = s.id;
  }

  const unmatched: string[] = [];
  let added = 0;
  let matched = 0;

  for (const st of students) {
    const name = String(st.name || '').trim() || 'İsimsiz';
    const lower = name.toLowerCase();
    const studentId = nameMap[lower] || byName[normName(name)] || '';
    if (studentId) matched++;
    else unmatched.push(name);

    const kit = st.kitapcik === 'B' ? 'B' : st.kitapcik === 'A' ? 'A' : kitapcik;
    const graded = gradeFlat(exam, st.answers, kit); // anahtar yoksa null
    exam.rows.push({
      id: rowId(),
      source,
      kitapcik: kit,
      excelName: name, // alt akış uyumu için alan adı korunur
      studentId,
      rawAnswers: st.answers,
      results: graded ? graded.results : {},
      toplamNet: graded ? graded.toplamNet : 0,
    });
    added++;
  }

  await saveExam(exam);

  return NextResponse.json({
    ok: true,
    added,
    matched,
    unmatched,
    rowCount: exam.rows.length,
    graded: students.length > 0 && !!gradeFlat(exam, students[0].answers, kitapcik),
  });
});

// Bir satırı sil. ?rowId=...
export const DELETE = withAuth(['director', 'counselor'], async (req, ctx) => {

  const { searchParams } = new URL(req.url);
  const rid = searchParams.get('rowId');
  if (!rid) return NextResponse.json({ error: 'rowId gerekli' }, { status: 400 });

  const exam = await getExam(String(ctx.params?.id));
  if (!exam) return NextResponse.json({ error: 'Sınav bulunamadı' }, { status: 404 });
  exam.rows = (exam.rows || []).filter((r) => r.id !== rid);
  await saveExam(exam);
  return NextResponse.json({ ok: true, rowCount: exam.rows.length });
});
