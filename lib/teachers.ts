import bcrypt from 'bcryptjs';
import { initialPassword } from '@/lib/auth';
import { getWeekKey, initWeekForTeacher } from '@/lib/slots';
import { normalizeTurkishMobile } from '@/lib/phone';
import { defaultCoursesFor } from '@/lib/classes';
import { HttpError } from '@/lib/errors';
import { tdb, withScope } from '@/lib/sqldb';
import { newId as makeId } from '@/lib/id';
import { purgeMobileAccess } from '@/lib/mobile/purge';
import type { Class, Prisma, TeacherPreset } from '@prisma/client';

// Öğretmen servis katmanı — DB + iş kuralı + preset süzme. Route yalnız withAuth+
// parseBody+audit+response. İş-kuralı ihlalinde HttpError fırlatır.

// SQL TeacherPreset satırları → {cls, course} sözleşmesi (classId = legacy cls kodu).
const presetsOut = (rows: TeacherPreset[] | null | undefined) => (rows || []).map((p) => ({ cls: p.classId, course: p.course }));
// presets'i SQL'de değiştir (sil + yeniden oluştur). teacherId = SQL cuid.
async function replacePresetsSql(teacherCuid: string, clean: { cls: string; course: string }[]) {
  await tdb().teacherPreset.deleteMany({ where: { teacherId: teacherCuid } });
  for (const p of clean) await tdb().teacherPreset.create({ data: { teacherId: teacherCuid, classId: p.cls, course: p.course } });
}

// Ön eşleştirme listesini öğretmenin branşlarına + grup izinlerine göre süz.
// Sınıf REGISTRY'den doğrulanır (Class tablosu, legacyId) — sabit-kod listesi değil;
// ders, sınıfın kendi ders kümesinden (dersler, boşsa kademe şablonu) kontrol edilir.
// Geçersiz (branş dışı ders / izin dışı grup / bilinmeyen sınıf) satırlar sessizce atılır.
function sanitizePresets(list: { cls?: string; course?: string }[], teacher: { branches?: string[]; allowedGroups?: string[] }, classRows: Class[]): { cls: string; course: string }[] {
  if (!Array.isArray(list)) return [];
  const branches = new Set(teacher.branches || []);
  const ag = teacher.allowedGroups || [];
  const groups = ag.length > 0 ? new Set(ag) : new Set(['ortaokul', 'lise', 'mezun']);
  const byId = new Map((classRows || []).map((c) => [c.legacyId, c]));
  const seen = new Set<string>();
  const out: { cls: string; course: string }[] = [];
  for (const p of list) {
    const cls = String(p?.cls || '');
    const course = String(p?.course || '');
    const row = byId.get(cls);
    if (!row) continue;
    if (seen.has(cls)) continue;                       // sınıf başına tek ders
    if (!groups.has(row.group)) continue;
    if (!branches.has(course)) continue;
    const allowed = (row.dersler && row.dersler.length)
      ? row.dersler
      : defaultCoursesFor(row.kademe, row.duzey, row.dal);
    if (!allowed.includes(course)) continue;
    seen.add(cls);
    out.push({ cls, course });
  }
  return out;
}

export interface TeacherOut {
  id: string; name: string; username: string; branches: string[]; allowedGroups: string[];
  photoUrl: string; offDays: number[]; phone: string; presets: { cls: string; course: string }[];
}

export async function listTeachers(): Promise<TeacherOut[]> {
  const rows = await tdb().teacher.findMany({ include: { presets: true } });
  return rows.map((t) => ({
    id: t.legacyId, name: t.name, username: t.username, branches: t.branches || [],
    allowedGroups: t.allowedGroups || [], photoUrl: t.photoUrl || '',
    offDays: t.offDays || [], phone: t.phone || '', presets: presetsOut(t.presets),
  }));
}

export interface TeacherCreateInput {
  name: string; password?: string; branches: string[];
  allowedGroups?: string[]; photoUrl?: string; phone?: string;
}
export interface TeacherCreateResult {
  id: string; name: string; username: string; branches: string[]; allowedGroups: string[]; photoUrl: string;
}

// Yeni öğretmen. İsim benzersiz (yoksa HttpError 400). İlk hafta grid'i kurulur.
export async function createTeacher(input: TeacherCreateInput): Promise<TeacherCreateResult> {
  const { name, password, branches, allowedGroups, photoUrl, phone } = input;
  const username = name; // isim soyisim kullanıcı adı olarak kullanılır

  const dup = await tdb().teacher.findFirst({ where: { username } });
  if (dup) throw new HttpError(400, 'Bu isimde bir öğretmen zaten kayıtlı');
  const normPhone = phone ? (normalizeTurkishMobile(phone) || '') : '';
  const hash = await bcrypt.hash(initialPassword(password, normPhone), 10);
  const legacyId = makeId();
  await tdb().teacher.create({ data: withScope({
    legacyId, name, username, passwordHash: hash, branches,
    allowedGroups: allowedGroups || [], photoUrl: photoUrl || '', phone: normPhone, mustChangePassword: true,
  }) });
  await initWeekForTeacher(legacyId, getWeekKey());
  return { id: legacyId, name, username, branches, allowedGroups: allowedGroups || [], photoUrl: photoUrl || '' };
}

// İzin günü aç/kapa. Açılınca o günün şablon entry'leri silinir (yoksa izin kalkınca
// eski dersler geri canlanır), sonra hafta grid'i yeniden kurulur. Yoksa HttpError 404.
export async function toggleTeacherOffDay(id: string, dayIndex: number, off: boolean): Promise<{ offDays: number[] }> {
  const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
  if (!t) throw new HttpError(404, 'Öğretmen bulunamadı');
  const set = new Set(t.offDays || []);
  off ? set.add(dayIndex) : set.delete(dayIndex);
  const offDays = Array.from(set).sort((a, b) => a - b);
  const data: Prisma.TeacherUpdateInput = { offDays };
  if (off) {
    const tmpl: Record<string, unknown> = JSON.parse(JSON.stringify(t.programTemplate || {}));
    if (tmpl[String(dayIndex)]) { delete tmpl[String(dayIndex)]; data.programTemplate = tmpl as object; }
  }
  await tdb().teacher.update({ where: { id: t.id }, data });
  await initWeekForTeacher(id, getWeekKey());
  return { offDays };
}

// Ön eşleştirmeleri kaydet (branş/grup/sınıf süzgecinden geçirilir). Yoksa HttpError 404.
export async function setTeacherPresets(id: string, presets: { cls: string; course: string }[]): Promise<{ presets: { cls: string; course: string }[] }> {
  const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
  if (!t) throw new HttpError(404, 'Öğretmen bulunamadı');
  const classRows = await tdb().class.findMany();
  const clean = sanitizePresets(presets, { branches: t.branches, allowedGroups: t.allowedGroups }, classRows);
  await replacePresetsSql(t.id, clean);
  return { presets: clean };
}

export interface TeacherUpdateInput {
  id: string; name: string; password?: string;
  branches?: string[]; allowedGroups?: string[]; photoUrl?: string; phone?: string;
}

// Normal güncelleme. Yoksa HttpError 404. Branş değişince mevcut preset'ler yeniden süzülür.
export async function updateTeacher(input: TeacherUpdateInput): Promise<void> {
  const { id, name, password, branches, allowedGroups, photoUrl, phone } = input;
  const t = await tdb().teacher.findFirst({ where: { legacyId: id }, include: { presets: true } });
  if (!t) throw new HttpError(404, 'Öğretmen bulunamadı');
  const data: { name: string; username: string; branches: string[]; allowedGroups: string[]; photoUrl: string | null; phone: string; passwordHash?: string } = {
    name, username: name,
    branches: branches !== undefined ? branches : (t.branches || []),
    allowedGroups: allowedGroups || t.allowedGroups,
    photoUrl: photoUrl !== undefined ? photoUrl : t.photoUrl,
    phone: phone !== undefined ? (normalizeTurkishMobile(phone) || phone || '') : (t.phone || ''),
  };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().teacher.update({ where: { id: t.id }, data });
  if ((t.presets || []).length) {
    const classRows = await tdb().class.findMany();
    const clean = sanitizePresets(presetsOut(t.presets), { branches: data.branches, allowedGroups: data.allowedGroups }, classRows);
    await replacePresetsSql(t.id, clean);
  }
}

// Öğretmen sil (cascade: presets/etut/slot). Döner: audit için { name } (yoksa id fallback).
export async function deleteTeacher(id: string): Promise<{ name: string }> {
  const t = await tdb().teacher.findFirst({ where: { legacyId: id } });
  if (t) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — bkz lib/mobile/purge.ts.
    await purgeMobileAccess('teacher', [id], 'hesap silindi');
    await tdb().teacher.delete({ where: { id: t.id } });
  }
  return { name: t?.name || id };
}
