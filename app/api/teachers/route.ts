import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { logAudit, actorFrom } from '@/lib/audit';
import { parseBody, z, zName, zId, zStringArray } from '@/lib/validate';
import {
  listTeachers, createTeacher, toggleTeacherOffDay, setTeacherPresets, updateTeacher, deleteTeacher,
} from '@/lib/teachers';

const zPhotoUrl = z.string().max(1_000_000).optional(); // base64 data URL (~400KB)
const zPhone = z.string().max(40).optional();
const zPresets = z.array(z.object({
  cls: z.string().max(60),   // registry legacyId (s_<uuid>) veya eski sabit kod
  course: z.string().max(40),
})).max(200);
const TeacherCreateSchema = z.object({
  // Şifre opsiyonel: boşsa öğretmen telefonu, o da yoksa "12345678" (lib/auth.initialPassword).
  name: zName, password: z.string().max(200).optional(),
  branches: zStringArray.refine(a => a.length > 0, { message: 'En az bir branş gerekli' }),
  allowedGroups: zStringArray.optional(), photoUrl: zPhotoUrl, phone: zPhone,
});
// PUT: ya toggle_off_day / set_presets özel aksiyonu ya normal güncelleme.
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
  return NextResponse.json(await listTeachers());
});

export const POST = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, TeacherCreateSchema);
  if (!parsed.ok) return parsed.response;

  const created = await createTeacher(parsed.data);
  return NextResponse.json(created);
});

export const PUT = withAuth('manage', async (req) => {
  const parsed = await parseBody(req, TeacherUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (body.action === 'toggle_off_day') {
    const { offDays } = await toggleTeacherOffDay(body.id, body.dayIndex, body.off);
    return NextResponse.json({ ok: true, offDays });
  }
  if (body.action === 'set_presets') {
    const { presets } = await setTeacherPresets(body.id, body.presets);
    return NextResponse.json({ ok: true, presets });
  }
  await updateTeacher(body);
  return NextResponse.json({ ok: true });
});

export const DELETE = withAuth('manage', async (req, _ctx, session) => {
  const parsed = await parseBody(req, TeacherDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  const info = await deleteTeacher(id);
  await logAudit({ ...actorFrom(session), action: 'teacher.delete', target: { type: 'teacher', id, name: info.name }, detail: `Öğretmen silindi: ${info.name}` });
  return NextResponse.json({ ok: true });
});
