import { NextResponse } from 'next/server';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { parseTytExcel } from '@/lib/deneme/excel';
import { computeToplamNet } from '@/lib/deneme/analysis';
import { dkeys, normName, getAllStudents } from '@/lib/deneme/store';

function uuid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
  );
}

// Müdür Excel yükler: parse + isim eşleştirme + deneme kaydı. (Şimdilik TYT)
export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  const name = String(form.get('name') || '').trim();
  const examType = String(form.get('examType') || 'TYT');
  const date = String(form.get('date') || new Date().toISOString());

  if (!file) return NextResponse.json({ error: 'Dosya gerekli.' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Deneme adı gerekli.' }, { status: 400 });
  if (examType !== 'TYT') {
    return NextResponse.json({ error: 'Şimdilik sadece TYT yüklenebilir.' }, { status: 400 });
  }

  let parsed;
  try {
    const buffer = await file.arrayBuffer();
    parsed = parseTytExcel(buffer);
  } catch (e) {
    return NextResponse.json({ error: e?.message || 'Excel okunamadı.' }, { status: 400 });
  }

  // İsim -> studentId eşleştirme:
  // 1) kalıcı namemap (excelName.lower -> studentId)
  // 2) öğrenci name/username tam eşleşmesi
  const nameMap = (await redis.get(dkeys.nameMap)) || {};
  const students = await getAllStudents();
  const byName = {};
  for (const s of students) {
    byName[normName(s.name)] = s.id;
    if (s.username) byName[normName(s.username)] = s.id;
  }

  const rows = [];
  const unmatched = [];

  for (const pr of parsed.rows) {
    const lower = pr.excelName.toLowerCase();
    const studentId = nameMap[lower] || byName[normName(pr.excelName)] || '';
    if (!studentId) unmatched.push(pr.excelName);
    rows.push({
      studentId,
      excelName: pr.excelName,
      results: pr.results,
      toplamNet: computeToplamNet(pr.results),
    });
  }

  const id = uuid();
  const exam = {
    id,
    name,
    examType: 'TYT',
    category: null,
    date: new Date(date).toISOString(),
    subjectKeys: parsed.subjectKeys,
    rows,
    createdAt: Date.now(),
  };
  await redis.set(dkeys.exam(id), exam);

  const meta = { id, name, examType: 'TYT', category: null, date: exam.date, createdAt: exam.createdAt };
  const index = (await redis.get(dkeys.examsIndex)) || [];
  index.unshift(meta);
  await redis.set(dkeys.examsIndex, index);

  return NextResponse.json({
    ok: true,
    examId: id,
    rowCount: rows.length,
    matchedCount: rows.length - unmatched.length,
    unmatched,
    subjectKeys: parsed.subjectKeys,
  });
}
