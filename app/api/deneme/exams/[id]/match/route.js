import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getExam, saveExam, getNameMap, saveNameMap } from '@/lib/deneme/store';
import { parseBody, z } from '@/lib/validate';

const MatchSchema = z.object({
  matches: z.array(z.object({
    rowId: z.string().max(100).optional(),
    excelName: z.string().max(200),
    studentId: z.string().max(100).optional(),
  })).max(5000),
});

// İsim/satırı öğrenci id'sine bağlar (kalıcı namemap'e de yazar).
// body: { matches: [{ rowId?, excelName, studentId }] }  (boş studentId = eşleşmeyi kaldır)
// rowId verilirse o satır; yoksa isimle eşleşen ilk satır güncellenir.
export async function POST(req, { params }) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, MatchSchema);
  if (!parsed.ok) return parsed.response;
  const { matches } = parsed.data;
  const exam = await getExam(params.id);
  if (!exam) return NextResponse.json({ error: 'Deneme bulunamadı' }, { status: 404 });

  const nameMap = await getNameMap();
  for (const m of matches || []) {
    const row = m.rowId
      ? exam.rows.find((r) => r.id === m.rowId)
      : exam.rows.find((r) => r.excelName === m.excelName);
    if (row) row.studentId = m.studentId || '';
    const lower = String(m.excelName).toLowerCase();
    if (m.studentId) nameMap[lower] = m.studentId;
    else delete nameMap[lower];
  }

  await saveExam(exam);
  await saveNameMap(nameMap);
  return NextResponse.json({ ok: true });
}
