import { tdb, withScope } from '@/lib/sqldb';
import { HttpError } from '@/lib/errors';
import type { BehaviorEntry } from '@prisma/client';

// Davranış puanı servis katmanı — DB + iş kuralı. Route yalnız yetki (session-bazlı
// inline rol dallanması) + push + audit + response. İhlalde HttpError.

// SQL BehaviorEntry satırı → mevcut sözleşme şekli (at = createdAt ISO).
export const behEntryOut = (e: BehaviorEntry) => ({
  id: e.id, points: e.points, reason: e.reason || '', note: e.note || '',
  byName: e.byName || '', byRole: e.byRole || '', by: e.by || '',
  at: e.createdAt instanceof Date ? e.createdAt.toISOString() : e.createdAt,
});

export interface BehaviorDetail { total: number; entries: ReturnType<typeof behEntryOut>[]; }

// Bir öğrencinin (legacyId) davranış toplamı + geçmişi (en yeni önce).
export async function getStudentBehavior(studentId: string): Promise<BehaviorDetail> {
  const beh = await tdb().behavior.findFirst({
    where: { student: { legacyId: studentId } },
    include: { entries: { orderBy: { createdAt: 'asc' } } },
  });
  return { total: beh?.total || 0, entries: (beh?.entries || []).map(behEntryOut).reverse() };
}

export interface BehaviorRosterRow { id: string; name: string; cls: string; total: number; count: number; }

// Yönetici/öğretmen roster'ı: her öğrencinin toplamı + kayıt sayısı (isme göre sıralı).
export async function getBehaviorRoster(): Promise<BehaviorRosterRow[]> {
  const rows = await tdb().student.findMany({
    include: {
      class: { select: { legacyId: true } },
      behavior: { select: { total: true, _count: { select: { entries: true } } } },
    },
  });
  const roster = rows.map(s => ({
    id: s.legacyId, name: s.name, cls: s.class?.legacyId || '',
    total: s.behavior?.total || 0, count: s.behavior?._count?.entries || 0,
  }));
  roster.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'tr'));
  return roster;
}

export interface AddBehaviorInput {
  studentId: string; points: number; reason: string; note?: string;
  byName: string; byRole: string; by: string | undefined;
}

// Davranış puanı ekle. Puan 0 olamaz; öğrenci yoksa 404. Kayıt yoksa oluşturur, toplamı
// artırır. Döner: { total, studentName } (route push + audit için).
export async function addBehavior(input: AddBehaviorInput): Promise<{ total: number; studentName: string }> {
  const { studentId, points, reason, note, byName, byRole, by } = input;
  if (points === 0) throw new HttpError(400, 'Puan 0 olamaz');

  const student = await tdb().student.findFirst({ where: { legacyId: studentId } });
  if (!student) throw new HttpError(404, 'Öğrenci bulunamadı');

  let beh = await tdb().behavior.findFirst({ where: { studentId: student.id } });
  if (!beh) beh = await tdb().behavior.create({ data: withScope({ studentId: student.id, total: 0 }) });
  await tdb().behaviorEntry.create({ data: {
    behaviorId: beh.id, points, reason: reason.trim(), note: (note || '').trim(),
    byName: byName || '', byRole, by,
  } });
  const updated = await tdb().behavior.update({ where: { id: beh.id }, data: { total: { increment: points } } });
  return { total: updated.total, studentName: student.name };
}

// Davranış kaydı sil. Yoksa 404. Öğretmen yalnız kendi verdiğini siler (isManager değilse
// ve entry.by !== sessionId → 403). Döner: { total, points, reason } (audit için).
export async function deleteBehaviorEntry(
  studentId: string, entryId: string, opts: { isManager: boolean; sessionId: string | undefined },
): Promise<{ total: number; points: number; reason: string }> {
  const beh = await tdb().behavior.findFirst({
    where: { student: { legacyId: studentId } },
    include: { entries: true },
  });
  if (!beh) throw new HttpError(404, 'Kayıt bulunamadı');
  const entry = beh.entries.find(e => e.id === entryId);
  if (!entry) throw new HttpError(404, 'Kayıt bulunamadı');
  if (!opts.isManager && entry.by !== opts.sessionId) {
    throw new HttpError(403, 'Yalnız kendi verdiğiniz puanı silebilirsiniz');
  }
  await tdb().behaviorEntry.delete({ where: { id: entry.id } });
  const updated = await tdb().behavior.update({ where: { id: beh.id }, data: { total: { decrement: entry.points || 0 } } });
  return { total: updated.total, points: entry.points, reason: entry.reason || '' };
}
