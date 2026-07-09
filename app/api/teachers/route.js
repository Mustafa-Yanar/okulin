import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAuth, initialPassword } from '@/lib/auth';
import { getWeekKey, initWeekForTeacher } from '@/lib/slots';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId, zStringArray } from '@/lib/validate';
import { COL_COURSES, colKeyForClass, classToGroup, ALL_CLASSES } from '@/lib/constants';
import { tdb } from '@/lib/sqldb';

// SQL TeacherPreset satırları → {cls, course} sözleşmesi (classId = legacy cls kodu).
const presetsOut = (rows) => (rows || []).map((p) => ({ cls: p.classId, course: p.course }));
// presets'i SQL'de değiştir (sil + yeniden oluştur). teacherId = SQL cuid.
async function replacePresetsSql(teacherCuid, clean) {
  await tdb().teacherPreset.deleteMany({ where: { teacherId: teacherCuid } });
  for (const p of clean) await tdb().teacherPreset.create({ data: { teacherId: teacherCuid, classId: p.cls, course: p.course } });
}

import { newId as makeId } from '@/lib/id';

// Ön eşleştirme listesini öğretmenin branşlarına + grup izinlerine göre süz.
// Geçersiz (branş dışı ders / izin dışı grup / bilinmeyen sınıf) satırlar sessizce atılır.
function sanitizePresets(list, teacher) {
  if (!Array.isArray(list)) return [];
  const branches = new Set(teacher.branches || []);
  const ag = teacher.allowedGroups || [];
  const groups = ag.length > 0 ? new Set(ag) : new Set(['ortaokul', 'lise', 'mezun']);
  const seen = new Set();
  const out = [];
  for (const p of list) {
    const cls = String(p?.cls || '');
    const course = String(p?.course || '');
    if (!ALL_CLASSES.includes(cls)) continue;
    if (seen.has(cls)) continue;                       // sınıf başına tek ders
    if (!groups.has(classToGroup(cls))) continue;
    if (!branches.has(course)) continue;
    if (!(COL_COURSES[colKeyForClass(cls)] || []).includes(course)) continue;
    seen.add(cls);
    out.push({ cls, course });
  }
  return out;
}

const zPhotoUrl = z.string().max(1_000_000).optional(); // base64 data URL (~400KB)
const zPhone = z.string().max(40).optional();
const zPresets = z.array(z.object({
  cls: z.string().max(10),
  course: z.string().max(40),
})).max(200);
const TeacherCreateSchema = z.object({
  // Şifre opsiyonel: boşsa öğretmen telefonu, o da yoksa "12345678" (lib/auth.initialPassword).
  name: zName, password: z.string().max(200).optional(),
  branches: zStringArray.refine(a => a.length > 0, { message: 'En az bir branş gerekli' }),
  allowedGroups: zStringArray.optional(), photoUrl: zPhotoUrl, phone: zPhone,
});
// PUT: ya toggle_off_day özel aksiyonu ya normal güncelleme.
const TeacherUpdateSchema = z.union([
  z.object({ action: z.literal('toggle_off_day'), id: zId, dayIndex: z.coerce.number().int().min(0).max(6), off: z.boolean() }),
  z.object({ action: z.literal('set_presets'), id: zId, presets: zPresets }),
  z.object({
    action: z.undefined().optional(), id: zId, name: zName,
    password: z.string().max(200).optional(), branches: zStringArray.optional(),
    allowedGroups: zStringArray.optional(), photoUrl: zPhotoUrl, phone: zPhone,
  }),
]);
const TeacherDeleteSchema = z.object({ id: zId });

export const GET = withAuth(async () => {
  const rows = await tdb().teacher.findMany({ include: { presets: true } });
  return NextResponse.json(rows.map((t) => ({
    id: t.legacyId, name: t.name, username: t.username, branches: t.branches || [],
    allowedGroups: t.allowedGroups || [], photoUrl: t.photoUrl || '',
    offDays: t.offDays || [], phone: t.phone || '', presets: presetsOut(t.presets),
  })));
});

export const POST = withAuth('manage', async (req) => {

  const parsed = await parseBody(req, TeacherCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password, branches, allowedGroups, photoUrl, phone } = parsed.data;

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  const dup = await tdb().teacher.findFirst({ where: { username } });
  if (dup) return NextResponse.json({ error: 'Bu isimde bir öğretmen zaten kayıtlı' }, { status: 400 });
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  const hash = await bcrypt.hash(initialPassword(password, normPhone), 10);
  const legacyId = makeId();
  await tdb().teacher.create({ data: {
    legacyId, name, username, passwordHash: hash, branches,
    allowedGroups: allowedGroups || [], photoUrl: photoUrl || '', phone: normPhone, mustChangePassword: true,
  } });
  await initWeekForTeacher(legacyId, getWeekKey());
  return NextResponse.json({ id: legacyId, name, username, branches, allowedGroups: allowedGroups || [], photoUrl: photoUrl || '' });
});

export const PUT = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, TeacherUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.action === 'toggle_off_day') {
    const { id, dayIndex, off } = body;
    const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
    if (!t) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
    const set = new Set(t.offDays || []);
    off ? set.add(dayIndex) : set.delete(dayIndex);
    const offDays = Array.from(set).sort((a, b) => a - b);
    const data = { offDays };
    // İzin günü AÇILDIYSA o günün şablon ders/etüt entry'lerini sil —
    // yoksa izin kalkınca eski dersler geri canlanır. Sonra slot grid'i yeniden kur.
    if (off) {
      const tmpl = JSON.parse(JSON.stringify(t.programTemplate || {}));
      if (tmpl[String(dayIndex)]) { delete tmpl[String(dayIndex)]; data.programTemplate = tmpl; }
    }
    await tdb().teacher.update({ where: { id: t.id }, data });
    await initWeekForTeacher(id, getWeekKey());
    return NextResponse.json({ ok: true, offDays });
  }
  if (body.action === 'set_presets') {
    const { id, presets } = body;
    const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
    if (!t) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
    const clean = sanitizePresets(presets, { branches: t.branches, allowedGroups: t.allowedGroups });
    await replacePresetsSql(t.id, clean);
    return NextResponse.json({ ok: true, presets: clean });
  }
  const { id, name, password, branches, allowedGroups, photoUrl, phone } = body;
  const t = await tdb().teacher.findFirst({ where: { legacyId: id }, include: { presets: true } });
  if (!t) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
  const data = {
    name, username: name,
    branches: branches !== undefined ? branches : (t.branches || []),
    allowedGroups: allowedGroups || t.allowedGroups,
    photoUrl: photoUrl !== undefined ? photoUrl : t.photoUrl,
    phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (t.phone || ''),
  };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().teacher.update({ where: { id: t.id }, data });
  if ((t.presets || []).length) {
    const clean = sanitizePresets(presetsOut(t.presets), { branches: data.branches, allowedGroups: data.allowedGroups });
    await replacePresetsSql(t.id, clean);
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth('manage', async (req, ctx, session) => {
  const parsed = await parseBody(req, TeacherDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
  if (t) await tdb().teacher.delete({ where: { id: t.id } }); // cascade: presets/etut/slot
  await logAudit({ ...actorFrom(session), action: 'teacher.delete', target: { type: 'teacher', id, name: t?.name || id }, detail: `Öğretmen silindi: ${t?.name || id}` });
  return NextResponse.json({ ok: true });
});
