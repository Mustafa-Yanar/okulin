import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { listStudents, createStudent, updateStudent, deleteStudent, bulkDeleteStudents } from '@/lib/students';

const zPhone = z.string().max(40).optional();
const zBirthDate = z.string().max(20).optional(); // YYYY-MM-DD
const zDiplomaNotu = z.string().max(10).optional(); // mezun diploma notu 50-100 (OBP = ×5)
const zParentName = z.string().max(120).optional(); // veli adı soyadı (opsiyonel)
const zRelation = z.string().max(40).optional();    // yakınlık derecesi (Anne, Baba...)
const zNote = z.string().max(2000).optional();      // veliye özel not (yönetim görür)
// Veli ek alanları: yakınlık, not, 2. iletişim (ad/telefon/yakınlık)
const parentExtraFields = {
  parentRelation: zRelation, parentNote: zNote,
  parent2Name: zParentName, parent2Phone: zPhone, parent2Relation: zRelation,
};
const StudentCreateSchema = z.object({
  // Şifre opsiyonel: boş bırakılırsa öğrenci telefonu ilk şifre olur (serviste kontrol).
  name: zName, password: z.string().max(200).optional(), cls: z.string().min(1).max(40),
  phone: zPhone, parentPhone: zPhone, parentName: zParentName, birthDate: zBirthDate,
  diplomaNotu: zDiplomaNotu,
  ...parentExtraFields,
});
const StudentUpdateSchema = z.object({
  id: zId, name: zName, cls: z.string().min(1).max(40),
  password: z.string().max(200).optional(),
  phone: zPhone, parentPhone: zPhone, parentName: zParentName, birthDate: zBirthDate,
  diplomaNotu: zDiplomaNotu,
  ...parentExtraFields,
});
// Tekil { id } veya toplu { ids:[...] } silme.
const StudentDeleteSchema = z.object({
  id: zId.optional(),
  ids: z.array(zId).max(2000).optional(),
}).refine(d => d.id || (d.ids && d.ids.length), { message: 'id veya ids gerekli' });

export const GET = withAuth(async () => {
  return NextResponse.json(await listStudents());
});

// POST/PUT 'intake': kayıt akışı — müdür/rehber (manage kuralı) + muhasebeci
// (config permissions.accountant.intake). Silme 'manage'de kalır (kayıt geri
// alınabilir, silme finans geçmişini de götürür — muhasebeciye verilmez).
export const POST = withAuth('intake', async (req, _ctx, session) => {
  const parsed = await parseBody(req, StudentCreateSchema);
  if (!parsed.ok) return parsed.response;

  const created = await createStudent(parsed.data);
  await logAudit({
    ...actorFrom(session),
    action: 'student.create',
    target: { type: 'student', id: created.id, name: created.name },
    detail: `Öğrenci eklendi: ${created.name} (${created.cls})`,
  });
  return NextResponse.json(created);
});

export const PUT = withAuth('intake', async (req) => {
  const parsed = await parseBody(req, StudentUpdateSchema);
  if (!parsed.ok) return parsed.response;

  await updateStudent(parsed.data);
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth('manage', async (req, _ctx, session) => {
  const parsed = await parseBody(req, StudentDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id, ids } = parsed.data;

  if (ids) { // şema ids'i string[] garanti eder (boş dizi de toplu dala girer — mevcut davranış)
    const deleted = await bulkDeleteStudents(ids);
    await logAudit({ ...actorFrom(session), action: 'student.bulkDelete', detail: `${deleted} öğrenci toplu silindi` });
    return NextResponse.json({ ok: true, deleted });
  }
  const info = await deleteStudent(id!); // refine: ids yoksa id kesin dolu
  await logAudit({ ...actorFrom(session), action: 'student.delete', target: { type: 'student', id: id!, name: info.name }, detail: `Öğrenci silindi: ${info.name}${info.cls ? ` (${info.cls})` : ''}` });
  return NextResponse.json({ ok: true });
});
