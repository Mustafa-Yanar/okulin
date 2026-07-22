import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@prisma/client';
import { configureTestDatabase } from './db-guard.mjs';

configureTestDatabase();
const prisma = new PrismaClient();

function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function resetDatabase() {
  const quoted = Prisma.dmmf.datamodel.models.map((m) => `"${m.name.replaceAll('"', '""')}"`);
  if (quoted.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted.join(', ')} RESTART IDENTITY CASCADE`);
  }
}

async function seedTenant({ slug, label, suffix }) {
  const passwordHash = await bcrypt.hash('Test1234!', 8);
  const weekKey = isoWeekKey();

  await prisma.org.create({
    data: { slug, name: `${label} Yapay Kurum`, active: true, code: `9000${suffix}`, kademeler: ['ortaokul', 'lise', 'mezun'] },
  });
  await prisma.branch.create({
    data: { id: `branch_${slug}`, orgSlug: slug, slug: 'main', name: 'Ana Şube', active: true },
  });
  await prisma.director.create({
    data: { id: `director_${slug}`, orgSlug: slug, branch: 'main', username: `${slug}_mudur`, passwordHash, name: `${label} Müdür` },
  });
  await prisma.counselor.create({
    data: { id: `counselor_${slug}`, orgSlug: slug, branch: 'main', legacyId: `rehber_${suffix}`, username: `${slug}_rehber`, passwordHash, name: `${label} Rehber`, mustChangePassword: false },
  });
  await prisma.assistantDirector.create({
    data: { id: `assistant_${slug}`, orgSlug: slug, branch: 'main', legacyId: `mudury_${suffix}`, username: `${slug}_mudury`, passwordHash, name: `${label} Müdür Yardımcısı`, mustChangePassword: false },
  });
  await prisma.accountant.create({
    data: { id: `accountant_${slug}`, orgSlug: slug, branch: 'main', legacyId: `muh_${suffix}`, username: `${slug}_muhasebe`, passwordHash, name: `${label} Muhasebe`, mustChangePassword: false },
  });
  await prisma.orgAdmin.create({
    data: { id: `orgadmin_${slug}`, orgSlug: slug, username: `${slug}_hq`, passwordHash, name: `${label} Genel Merkez` },
  });
  await prisma.tenantConfig.create({
    data: { orgSlug: slug, branch: 'main', currentWeek: weekKey, receiptCounter: 0, slotTimes: { days: {} } },
  });

  const class701 = await prisma.class.create({
    data: {
      id: `class_${slug}_701`, orgSlug: slug, branch: 'main', legacyId: '701', ad: `${label} 7-A`,
      group: 'ortaokul', kademe: 'ortaokul', duzey: '7', dersler: ['Türkçe', 'Matematik', 'Fen Bilgisi'],
      slotTemplate: { 5: [1, 2, 3, 4] },
    },
  });
  const classM1 = await prisma.class.create({
    data: {
      id: `class_${slug}_m1`, orgSlug: slug, branch: 'main', legacyId: 'm1', ad: `${label} Mezun Sayısal`,
      group: 'mezun', kademe: 'mezun', duzey: 'mezun', dal: 'sayisal',
      dersler: ['Türkçe', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji'],
      slotTemplate: { 0: [1, 2, 3, 4, 5, 6] },
    },
  });
  await prisma.course.createMany({
    data: ['Türkçe', 'Matematik', 'Fen Bilgisi', 'TYT Matematik', 'AYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji']
      .map((key) => ({ id: `course_${slug}_${Buffer.from(key).toString('hex').slice(0, 16)}`, orgSlug: slug, branch: 'main', key, ad: key })),
  });

  const teacher = await prisma.teacher.create({
    data: {
      id: `teacher_${slug}_math`, orgSlug: slug, branch: 'main', legacyId: `t_math_${suffix}`,
      name: `${label} Matematik Öğretmeni`, username: `${slug}_ogretmen`, passwordHash,
      branches: ['Matematik', 'TYT Matematik', 'AYT Matematik', 'Geometri'],
      allowedGroups: ['ortaokul', 'mezun'], mustChangePassword: false,
      programTemplate: {
        0: { w1: { type: 'available' }, w2: { type: 'available' } },
        5: { e1: { type: 'available' }, e2: { type: 'available' } },
      },
    },
  });
  await prisma.teacherPreset.create({
    data: { id: `preset_${slug}`, teacherId: teacher.id, classId: 'm1', course: 'TYT Matematik' },
  });

  const student = await prisma.student.create({
    data: {
      id: `student_${slug}_1`, orgSlug: slug, branch: 'main', legacyId: `s_${suffix}_1`,
      name: `${label} Test Öğrencisi`, username: `${slug}_ogrenci`, passwordHash,
      classId: class701.id, group: 'ortaokul', phone: `905300000${suffix.padStart(3, '0')}`,
      parentName: `${label} Test Velisi`, parentPhone: `905310000${suffix.padStart(3, '0')}`,
      mustChangePassword: false,
    },
  });
  await prisma.parent.create({
    data: {
      id: `parent_${slug}`, orgSlug: slug, branch: 'main', phone: student.parentPhone,
      passwordHash, name: student.parentName,
      children: [{ id: student.legacyId, name: student.name, cls: class701.legacyId }], mustChangePassword: false,
    },
  });
  await prisma.finance.create({
    data: {
      id: `finance_${slug}`, orgSlug: slug, branch: 'main', studentId: student.id,
      totalFee: 12000, discount: 2000, netFee: 10000, paymentPlan: 'taksitli', payments: [],
      installments: {
        create: [
          { id: `inst_${slug}_0`, idx: 0, dueDate: '2026-09-01', amount: 5000 },
          { id: `inst_${slug}_1`, idx: 1, dueDate: '2026-10-01', amount: 5000 },
        ],
      },
    },
  });
  await prisma.slotBooking.createMany({
    data: [
      { id: `slot_${slug}_1`, orgSlug: slug, branch: 'main', weekKey, teacherId: teacher.id, dayIndex: 0, slotId: 'w1', data: { type: 'available' }, startsAt: '09:00', endsAt: '09:40' },
      { id: `slot_${slug}_2`, orgSlug: slug, branch: 'main', weekKey, teacherId: teacher.id, dayIndex: 0, slotId: 'w2', data: { type: 'available' }, startsAt: '09:50', endsAt: '10:30' },
    ],
  });
  await prisma.etutSablon.create({
    data: {
      id: `etut_${slug}_1`, orgSlug: slug, branch: 'main', legacyId: `etut_${suffix}_1`,
      teacherId: teacher.legacyId, dayIndex: 2, start: '16:00', end: '16:40', aktif: true,
    },
  });
  await prisma.attendance.create({
    data: {
      id: `attendance_${slug}_1`, orgSlug: slug, branch: 'main', date: '2026-07-20',
      teacherId: teacher.id, cls: class701.legacyId, lessonNo: '1', records: { [student.legacyId]: 'var' },
    },
  });

  return { class701, classM1, teacher, student };
}

try {
  await resetDatabase();
  await prisma.superAdmin.create({
    data: { id: 'superadmin_test', username: 'test_superadmin', passwordHash: await bcrypt.hash('Test1234!', 8) },
  });
  await seedTenant({ slug: 'testkurs', label: 'Birinci', suffix: '101' });
  await seedTenant({ slug: 'digerkurs', label: 'İkinci', suffix: '202' });
  console.log('Sentetik test verisi hazır: testkurs + digerkurs (gerçek kurum verisi yok).');
  console.log('Test kullanıcılarının ortak şifresi: Test1234!');
} finally {
  await prisma.$disconnect();
}
