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
const zTc = z.string().max(11).optional();          // TC kimlik no (muhasebe belgeleri, opsiyonel)
const zAddress = z.string().max(300).optional();    // veli adresi (senet, opsiyonel)
// Veli ek alanları: yakınlık, not, 2. iletişim (ad/telefon/yakınlık) + muhasebe (TC/adres)
const parentExtraFields = {
  parentRelation: zRelation, parentNote: zNote,
  parent2Name: zParentName, parent2Phone: zPhone, parent2Relation: zRelation,
  tcNo: zTc, parentTcNo: zTc, parentAddress: zAddress,
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

// Tam öğrenci listesi (telefon/veli telefonu/doğum tarihi/diploma notu dahil PII) —
// yalnız personel rolleri. student/parent burada YOK: kendi verilerini ayrı, filtreli
// uçlardan görürler (canReadStudent ile korunan rotalar).
export const GET = withAuth(['director', 'teacher', 'counselor', 'accountant'], async (_req, _ctx, session) => {
  const list = await listStudents();
  // Yönetim notları (veliye özel not + muafiyet gerekçesi) yalnız müdür/rehberliğe:
  // "raporlu/ailevi izin" gibi hassas gerekçeler öğretmen ve muhasebeye gitmez (KVKK).
  // Muafiyet TARİHLERİ kalır — öğretmen paneli "Muaf" rozetini onlarla türetir.
  if (session.role === 'teacher' || session.role === 'accountant') {
    return NextResponse.json(list.map((s) => ({ ...s, parentNote: '', exemptNote: '' })));
  }
  return NextResponse.json(list);
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
