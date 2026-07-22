import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';

type Mismatch = { relation: string; count: number };

const EXPECTED_FOREIGN_KEYS = [
  'AnnouncementRecipient.AnnouncementRecipient_announcementId_fkey',
  'Attendance.Attendance_teacherId_fkey',
  'Behavior.Behavior_studentId_fkey',
  'BehaviorEntry.BehaviorEntry_behaviorId_fkey',
  'EtutReservation.EtutReservation_sablonId_fkey',
  'EtutSablon.EtutSablon_orgSlug_branch_teacherId_fkey',
  'ExamRow.ExamRow_examId_fkey',
  'Finance.Finance_studentId_fkey',
  'FormResponse.FormResponse_formId_fkey',
  'Guidance.Guidance_orgSlug_branch_studentId_fkey',
  'Hedef.Hedef_orgSlug_branch_studentId_fkey',
  'Installment.Installment_financeId_fkey',
  'PayOrder.PayOrder_orgSlug_branch_studentId_fkey',
  'SlotBooking.SlotBooking_teacherId_fkey',
  'Student.Student_classId_fkey',
  'TeacherPreset.TeacherPreset_teacherId_fkey',
  'Topic.Topic_orgSlug_branch_studentId_fkey',
].sort();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('ilişkisel veri bütünlüğü', () => {
  it('bağlı kayıtların kurum ve şubeleri ebeveynleriyle aynıdır', async () => {
    const mismatches = await prisma.$queryRaw<Mismatch[]>`
      SELECT 'Student→Class' AS relation, COUNT(*)::int AS count
      FROM "Student" child JOIN "Class" parent ON parent.id = child."classId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
      UNION ALL
      SELECT 'Finance→Student', COUNT(*)::int
      FROM "Finance" child JOIN "Student" parent ON parent.id = child."studentId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
      UNION ALL
      SELECT 'Behavior→Student', COUNT(*)::int
      FROM "Behavior" child JOIN "Student" parent ON parent.id = child."studentId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
      UNION ALL
      SELECT 'SlotBooking→Teacher', COUNT(*)::int
      FROM "SlotBooking" child JOIN "Teacher" parent ON parent.id = child."teacherId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
      UNION ALL
      SELECT 'Attendance→Teacher', COUNT(*)::int
      FROM "Attendance" child JOIN "Teacher" parent ON parent.id = child."teacherId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
      UNION ALL
      SELECT 'AnnouncementRecipient→Announcement', COUNT(*)::int
      FROM "AnnouncementRecipient" child JOIN "Announcement" parent ON parent.id = child."announcementId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
      UNION ALL
      SELECT 'EtutReservation→EtutSablon', COUNT(*)::int
      FROM "EtutReservation" child JOIN "EtutSablon" parent ON parent.id = child."sablonId"
      WHERE child."orgSlug" <> parent."orgSlug" OR child.branch <> parent.branch
    `;

    expect(mismatches).toHaveLength(7);
    expect(mismatches).toEqual(mismatches.map((row) => ({ ...row, count: 0 })));
  });

  it('sentetik başlangıçta öksüz yabancı anahtar bulunmaz', async () => {
    const rows = await prisma.$queryRaw<Array<{ table_name: string; constraint_name: string }>>`
      SELECT tc.table_name, tc.constraint_name
      FROM information_schema.table_constraints tc
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
      ORDER BY tc.table_name, tc.constraint_name
    `;

    // Yeni ilişki eklenmesi veya mevcut bir FK'nin yanlışlıkla düşmesi bilinçli bir
    // sözleşme güncellemesi gerektirir; şema kayması sessiz kalmaz.
    expect(rows.map((row) => `${row.table_name}.${row.constraint_name}`).sort())
      .toEqual(EXPECTED_FOREIGN_KEYS);
  });
});
