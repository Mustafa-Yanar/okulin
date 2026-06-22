import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'crypto';
import redis from '@/lib/db';
import { getSession, initialPassword } from '@/lib/auth';
import { getWeekKey, initWeekForTeacher } from '@/lib/slots';
import { normalizeTeacher } from '@/lib/teacherMigrate';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zId, zStringArray } from '@/lib/validate';
import { COL_COURSES, colKeyForClass, classToGroup, ALL_CLASSES } from '@/lib/constants';
import { useSql } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

// SQL TeacherPreset satırları → {cls, course} sözleşmesi (classId = legacy cls kodu).
const presetsOut = (rows) => (rows || []).map((p) => ({ cls: p.classId, course: p.course }));
// presets'i SQL'de değiştir (sil + yeniden oluştur). teacherId = SQL cuid.
async function replacePresetsSql(teacherCuid, clean) {
  await tdb().teacherPreset.deleteMany({ where: { teacherId: teacherCuid } });
  for (const p of clean) await tdb().teacherPreset.create({ data: { teacherId: teacherCuid, classId: p.cls, course: p.course } });
}

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

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

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  if (useSql()) {
    const rows = await tdb().teacher.findMany({ include: { presets: true } });
    return NextResponse.json(rows.map((t) => ({
      id: t.legacyId, name: t.name, username: t.username, branches: t.branches || [],
      allowedGroups: t.allowedGroups || [], photoUrl: t.photoUrl || '',
      offDays: t.offDays || [], phone: t.phone || '', presets: presetsOut(t.presets),
    })));
  }

  const ids = await redis.smembers('teachers');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`teacher:${id}`));
  const results = await pipeline.exec();
  const teachers = results.filter(Boolean).map(normalizeTeacher).map(t => ({
    id: t.id, name: t.name, username: t.username, branches: t.branches || [],
    allowedGroups: t.allowedGroups || [], photoUrl: t.photoUrl || '',
    offDays: t.offDays || [], phone: t.phone || '',
    presets: Array.isArray(t.presets) ? t.presets : [],
  }));
  return NextResponse.json(teachers);
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, TeacherCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password, branches, allowedGroups, photoUrl, phone } = parsed.data;

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  if (useSql()) {
    const dup = await tdb().teacher.findFirst({ where: { username } });
    if (dup) return NextResponse.json({ error: 'Bu isimde bir öğretmen zaten kayıtlı' }, { status: 400 });
    const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
    const hash = await bcrypt.hash(initialPassword(password, normPhone), 10);
    const legacyId = makeId();
    await tdb().teacher.create({ data: {
      legacyId, name, username, passwordHash: hash, branches,
      allowedGroups: allowedGroups || [], photoUrl: photoUrl || '', phone: normPhone, mustChangePassword: true,
    } });
    // NOT: userIndex (SQL'de doğrudan sorgu) + initWeekForTeacher (slot göçü) bayrak-açıkta atlandı.
    return NextResponse.json({ id: legacyId, name, username, branches, allowedGroups: allowedGroups || [], photoUrl: photoUrl || '' });
  }

  // Aynı isimde öğretmen var mı kontrol et
  const teacherIds = await redis.smembers('teachers');
  if (teacherIds && teacherIds.length > 0) {
    const pipeline = redis.pipeline();
    teacherIds.forEach(tid => pipeline.get(`teacher:${tid}`));
    const teachers = await pipeline.exec();
    const exists = teachers.some(t => t && t.username === username);
    if (exists) {
      return NextResponse.json({ error: 'Bu isimde bir öğretmen zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  // Telefonu kanonik forma çevir (giriş şifresi = telefon olunca tutarlı olsun).
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  // İlk şifre: girilen şifre → telefon → "12345678". İlk girişte zorunlu değişim.
  const initPassword = initialPassword(password, normPhone);
  const hash = await bcrypt.hash(initPassword, 10);
  const teacher = {
    id, name, username, passwordHash: hash, branches,
    allowedGroups: allowedGroups || [], photoUrl: photoUrl || '',
    phone: normPhone,
    mustChangePassword: true,  // ilk girişte öğretmen kendi şifresini belirleyecek
  };
  await redis.set(`teacher:${id}`, teacher);
  await redis.sadd('teachers', id);
  await addToIndex(username, 'teacher', id);

  // Initialize current week slots
  const weekKey = getWeekKey();
  await initWeekForTeacher(id, weekKey);

  return NextResponse.json({ id, name, username, branches, allowedGroups: teacher.allowedGroups, photoUrl: teacher.photoUrl });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, TeacherUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  if (useSql()) {
    if (body.action === 'toggle_off_day') {
      const { id, dayIndex, off } = body;
      const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
      if (!t) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
      const set = new Set(t.offDays || []);
      off ? set.add(dayIndex) : set.delete(dayIndex);
      const offDays = Array.from(set).sort((a, b) => a - b);
      await tdb().teacher.update({ where: { id: t.id }, data: { offDays } });
      // NOT: program-gün-sil + initWeekForTeacher → program/slot SQL göçünde ele alınır.
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
    // NOT: updateIndexUsername → SQL login doğrudan sorgular (userIndex yok).
    return NextResponse.json({ ok: true });
  }

  // Özel aksiyon: bir günü izin/aktif yap. Şablonda o güne ait tüm entry'leri siler.
  if (body.action === 'toggle_off_day') {
    const { id, dayIndex, off } = body;
    const teacher = await redis.get(`teacher:${id}`);
    if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

    const offDays = new Set(teacher.offDays || []);
    if (off) offDays.add(dayIndex);
    else offDays.delete(dayIndex);

    const updated = { ...teacher, offDays: Array.from(offDays).sort() };

    // İzin günü olduysa: o günün şablon entry'lerini sil
    if (off) {
      const program = await redis.get(`program:${id}`);
      if (program && program[String(dayIndex)]) {
        delete program[String(dayIndex)];
        await redis.set(`program:${id}`, program);
      }
    }

    await redis.set(`teacher:${id}`, updated);

    // Bu haftayı ve sonraki 2 haftayı yeniden init et
    const cw = getWeekKey();
    await initWeekForTeacher(id, cw);
    return NextResponse.json({ ok: true, offDays: updated.offDays });
  }

  // Özel aksiyon: ön eşleştirme (sabit dersler) listesini güncelle.
  // CP-SAT preset'i — sınıf+ders düzeyinde, slot serbest. Branşa/gruba göre süzülür.
  if (body.action === 'set_presets') {
    const { id, presets } = body;
    const teacher = await redis.get(`teacher:${id}`);
    if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });
    const clean = sanitizePresets(presets, teacher);
    const updated = { ...teacher, presets: clean };
    await redis.set(`teacher:${id}`, updated);
    return NextResponse.json({ ok: true, presets: clean });
  }

  const { id, name, password, branches, allowedGroups, photoUrl, phone } = body;
  const teacher = await redis.get(`teacher:${id}`);
  if (!teacher) return NextResponse.json({ error: 'Öğretmen bulunamadı' }, { status: 404 });

  const updated = {
    ...teacher, name, username: name,
    branches: branches !== undefined ? branches : (teacher.branches || []),
    allowedGroups: allowedGroups || teacher.allowedGroups,
    photoUrl: photoUrl !== undefined ? photoUrl : teacher.photoUrl,
    // Telefonu kanonik forma çevir (geçersizse ham değeri koru, veri kaybetme).
    phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (teacher.phone || ''),
  };
  delete updated.branch;        // eski şema alanlarını temizle
  delete updated.extraBranches;
  // Branş/grup değiştiyse ön eşleştirmeleri yeni izinlere göre süz (artık geçersizleri at).
  if (Array.isArray(teacher.presets) && teacher.presets.length) {
    updated.presets = sanitizePresets(teacher.presets, updated);
  }
  if (password) {
    updated.passwordHash = await bcrypt.hash(password, 10);
  }
  await redis.set(`teacher:${id}`, updated);
  // İsim (=username) değiştiyse indeksi güncelle
  await updateIndexUsername(teacher.username, name, 'teacher', id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, TeacherDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id } = parsed.data;

  if (useSql()) {
    const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
    if (t) await tdb().teacher.delete({ where: { id: t.id } }); // cascade: presets/etut/slot
    await logAudit({ ...actorFrom(session), action: 'teacher.delete', target: { type: 'teacher', id, name: t?.name || id }, detail: `Öğretmen silindi: ${t?.name || id}` });
    return NextResponse.json({ ok: true });
  }

  const teacher = await redis.get(`teacher:${id}`);
  await redis.del(`teacher:${id}`);
  await redis.srem('teachers', id);
  if (teacher?.username) await removeFromIndex(teacher.username, 'teacher', id);
  await logAudit({
    ...actorFrom(session),
    action: 'teacher.delete',
    target: { type: 'teacher', id, name: teacher?.name || id },
    detail: `Öğretmen silindi: ${teacher?.name || id}`,
  });
  return NextResponse.json({ ok: true });
}
