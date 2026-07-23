import { afterAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

type Mismatch = { relation: string; count: number };

const EXPECTED_FOREIGN_KEYS = [
  'AnnouncementRecipient.AnnouncementRecipient_orgSlug_branch_announcementId_fkey',
  'Attendance.Attendance_orgSlug_branch_teacherId_fkey',
  'Behavior.Behavior_orgSlug_branch_studentId_fkey',
  'BehaviorEntry.BehaviorEntry_behaviorId_fkey',
  'EtutReservation.EtutReservation_orgSlug_branch_sablonId_fkey',
  'EtutSablon.EtutSablon_orgSlug_branch_teacherId_fkey',
  'ExamRow.ExamRow_examId_fkey',
  'Finance.Finance_orgSlug_branch_studentId_fkey',
  'FormResponse.FormResponse_formId_fkey',
  'Guidance.Guidance_orgSlug_branch_studentId_fkey',
  'Hedef.Hedef_orgSlug_branch_studentId_fkey',
  'Installment.Installment_financeId_fkey',
  'PayOrder.PayOrder_orgSlug_branch_studentId_fkey',
  'SlotBooking.SlotBooking_orgSlug_branch_teacherId_fkey',
  'Student.Student_orgSlug_branch_classId_fkey',
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

  it('PostgreSQL yedi kritik ilişkide kurum/şube çapraz bağını doğrudan reddeder', async () => {
    const behaviorId = 'behavior_tenant_fk_probe';
    const announcementId = 'announcement_tenant_fk_probe';
    const recipientId = 'recipient_tenant_fk_probe';
    const secondStudent = await prisma.student.findUniqueOrThrow({ where: { id: 'student_testkurs_2' } });

    await prisma.behavior.create({
      data: {
        id: behaviorId, orgSlug: 'testkurs', branch: 'main',
        studentId: secondStudent.id, total: 0,
      },
    });
    await prisma.announcement.create({
      data: {
        id: announcementId, orgSlug: 'testkurs', branch: 'main',
        legacyId: 'announcement_tenant_fk_probe', data: { title: 'FK testi' },
        recipients: {
          create: {
            id: recipientId, role: 'student', recipientId: secondStudent.legacyId,
          },
        },
      },
    });

    const mustReject = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
        throw new Error('Kurumlar arası bağ veritabanı tarafından kabul edildi');
      } catch (error) {
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((error as Prisma.PrismaClientKnownRequestError).code).toBe('P2003');
      }
    };

    try {
      await mustReject(() => prisma.student.update({
        where: { id: secondStudent.id }, data: { orgSlug: 'digerkurs' },
      }));
      await mustReject(() => prisma.finance.update({
        where: { id: 'finance_testkurs' }, data: { orgSlug: 'digerkurs' },
      }));
      await mustReject(() => prisma.behavior.update({
        where: { id: behaviorId }, data: { orgSlug: 'digerkurs' },
      }));
      await mustReject(() => prisma.slotBooking.update({
        where: { id: 'slot_testkurs_1' }, data: { orgSlug: 'digerkurs' },
      }));
      await mustReject(() => prisma.attendance.update({
        where: { id: 'attendance_testkurs_1' }, data: { orgSlug: 'digerkurs' },
      }));
      await mustReject(() => prisma.announcementRecipient.update({
        where: { id: recipientId }, data: { orgSlug: 'digerkurs' },
      }));
      await mustReject(() => prisma.etutReservation.update({
        where: { id: 'etut_res_testkurs_2' }, data: { orgSlug: 'digerkurs' },
      }));
    } finally {
      await prisma.announcement.deleteMany({ where: { id: announcementId } });
      await prisma.behavior.deleteMany({ where: { id: behaviorId } });
    }
  });
});
