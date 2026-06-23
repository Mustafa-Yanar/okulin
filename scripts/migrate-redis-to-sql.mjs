// Redis (Upstash) → PostgreSQL (Neon/Prisma) veri göçü. TEK YÖNLÜ, idempotent.
// Çalıştır:  node --env-file=.env scripts/migrate-redis-to-sql.mjs [org]
// Varsayılan org = testkurs, branch = main. Route'lara DOKUNMAZ; sadece SQL'i doldurur.
// legacyId→cuid eşlemesiyle ilişkiler (student.classId, finance.studentId, ...) kurulur.
import { Redis } from '@upstash/redis';
import { PrismaClient } from '@prisma/client';

const ORG = process.argv[2] || 'testkurs';
const BRANCH = 'main';
const P = `t:${ORG}:${BRANCH}:`;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});
const prisma = new PrismaClient();

const jget = (k) => redis.get(P + k);
const smem = (k) => redis.smembers(P + k);
async function scanAll(pattern) {
  let cursor = '0', out = [];
  do {
    const [c, ks] = await redis.scan(cursor, { match: P + pattern, count: 500 });
    cursor = String(c); out.push(...(ks || []));
  } while (cursor !== '0');
  return out;
}
const strip = (full) => full.startsWith(P) ? full.slice(P.length) : full;
const summary = {};
const rec = (name, redisN, sqlN) => { summary[name] = `redis ${redisN} → sql ${sqlN}`; };

async function clearOrg() {
  // Çocuk tablolar önce (FK güvenli), sonra ebeveynler. Tekrar çalıştırılabilirlik için.
  const order = [
    'slotBooking', 'attendance', 'teacherPreset', 'installment', 'behaviorEntry',
    'examRow', 'formResponse', 'finance', 'behavior', 'exam', 'form', 'student',
    'teacher', 'class', 'course', 'counselor', 'accountant', 'expense', 'odev', 'hedef', 'etkinlik',
    'lead', 'announcement', 'resource', 'guidance', 'topic', 'auditLog', 'errLog',
    'pushSub', 'tenantConfig', 'director', 'parent', 'payOrder',
  ];
  for (const m of order) {
    try {
      // installment/behaviorEntry/examRow/formResponse/teacherPreset orgSlug taşımaz →
      // ebeveyn silinince cascade ile gider; burada orgSlug filtreli deleteMany atla.
      if (['installment', 'behaviorEntry', 'examRow', 'formResponse', 'teacherPreset'].includes(m)) continue;
      await prisma[m].deleteMany({ where: { orgSlug: ORG } });
    } catch (e) { /* tablo yoksa/boşsa geç */ }
  }
}

async function main() {
  console.log(`Göç başlıyor: org=${ORG} branch=${BRANCH}`);
  await clearOrg();

  // ── Org (global) ──
  const orgRec = (await redis.get(`org:${ORG}`)) || { slug: ORG, name: ORG };
  const kademeler = (Array.isArray(orgRec.kademeler) && orgRec.kademeler.length)
    ? orgRec.kademeler
    : (orgRec.sektor === 'okul' ? ['ilkokul', 'ortaokul', 'lise'] : ['ortaokul', 'lise', 'mezun']);
  await prisma.org.upsert({
    where: { slug: ORG },
    update: { name: orgRec.name || ORG },
    create: {
      slug: ORG, name: orgRec.name || ORG, active: orgRec.active ?? true,
      type: orgRec.type || 'single', code: orgRec.code || null,
      sektor: orgRec.sektor || 'dershane', mulkiyet: orgRec.mulkiyet || 'ozel', kademeler,
      shortName: orgRec.shortName || null, logoUrl: orgRec.logoUrl || null, themeColor: orgRec.themeColor || null,
      createdAt: orgRec.createdAt ? new Date(orgRec.createdAt) : new Date(),
    },
  });
  rec('Org', 1, 1);

  // ── Director ──
  const dir = await jget('director');
  if (dir) await prisma.director.create({ data: { orgSlug: ORG, branch: BRANCH, username: dir.username, passwordHash: dir.passwordHash, name: dir.name || '' } });
  rec('Director', dir ? 1 : 0, dir ? 1 : 0);

  // ── Counselor (rehber) — counselors set + counselor:<id> ──
  const counselorIds = await smem('counselors');
  let counN = 0;
  for (const id of counselorIds) {
    const c = await jget('counselor:' + id);
    if (!c) continue;
    await prisma.counselor.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: c.id, name: c.name, username: c.username || null, passwordHash: c.passwordHash, phone: c.phone || null, mustChangePassword: c.mustChangePassword ?? true } });
    counN++;
  }
  rec('Counselor', counselorIds.length, counN);

  // ── Parent (parents set + parent:<phone>) — children Json snapshot ──
  const parentPhones = await smem('parents');
  let parentN = 0;
  for (const phone of parentPhones) {
    const p = await jget('parent:' + phone);
    if (!p) continue;
    await prisma.parent.create({ data: { orgSlug: ORG, branch: BRANCH, phone: p.id || phone, passwordHash: p.passwordHash, name: p.name || null, mustChangePassword: p.mustChangePassword ?? true, children: p.children || [] } });
    parentN++;
  }
  rec('Parent', parentPhones.length, parentN);

  // ── Accountant (muhasebeci) — accountants set + accountant:<id> ──
  const accIds = await smem('accountants');
  let accN = 0;
  for (const id of accIds) {
    const a = await jget('accountant:' + id);
    if (!a) continue;
    await prisma.accountant.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: a.id, name: a.name, username: a.username || null, passwordHash: a.passwordHash, phone: a.phone || null, mustChangePassword: a.mustChangePassword ?? true } });
    accN++;
  }
  rec('Accountant', accIds.length, accN);

  // ── Course (dersler set + ders:<key>) ──
  const courseKeys = await smem('dersler');
  let cN = 0;
  for (const key of courseKeys) {
    const c = await jget('ders:' + key);
    if (!c) continue;
    await prisma.course.create({ data: { orgSlug: ORG, branch: BRANCH, key: c.key, ad: c.ad, core: c.core ?? true, family: c.family || null, active: c.active !== false } });
    cN++;
  }
  rec('Course', courseKeys.length, cN);

  // ── Class (classes set + sinif:<id>) ──
  const classIds = await smem('classes');
  const classMap = {};
  for (const id of classIds) {
    const c = await jget('sinif:' + id);
    if (!c) continue;
    const row = await prisma.class.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: c.id, ad: c.ad, group: c.group, kademe: c.kademe, duzey: c.duzey || null, dal: c.dal || null, dersler: c.dersler || [], seeded: c.seeded ?? true } });
    classMap[c.id] = row.id;
  }
  rec('Class', classIds.length, Object.keys(classMap).length);

  // ── Teacher (+ presets + programTemplate) ──
  const teacherIds = await smem('teachers');
  const teacherMap = {};
  let presetN = 0;
  for (const id of teacherIds) {
    const t = await jget('teacher:' + id);
    if (!t) continue;
    const prog = await jget('program:' + id); // grid şablonu + etutSablonlari
    const row = await prisma.teacher.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: t.id, name: t.name, username: t.username, passwordHash: t.passwordHash, branches: t.branches || [], allowedGroups: t.allowedGroups || [], offDays: t.offDays || [], photoUrl: t.photoUrl || null, phone: t.phone || null, mustChangePassword: t.mustChangePassword ?? true, programTemplate: prog ?? null } });
    teacherMap[t.id] = row.id;
    for (const ps of (Array.isArray(t.presets) ? t.presets : [])) {
      await prisma.teacherPreset.create({ data: { teacherId: row.id, classId: classMap[ps.cls || ps.classId] || (ps.cls || ps.classId || ''), course: ps.course || ps.branch || '' } });
      presetN++;
    }
  }
  rec('Teacher', teacherIds.length, Object.keys(teacherMap).length);
  if (presetN) rec('TeacherPreset', presetN, presetN);

  // ── Student ──
  const studentIds = await smem('students');
  const studentMap = {};
  for (const id of studentIds) {
    const s = await jget('student:' + id);
    if (!s) continue;
    const row = await prisma.student.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: s.id, name: s.name, username: s.username, passwordHash: s.passwordHash, classId: classMap[s.cls] || null, group: s.group || '', phone: s.phone || null, birthDate: s.birthDate || null, diplomaNotu: (typeof s.diplomaNotu === 'number' ? s.diplomaNotu : null), mustChangePassword: s.mustChangePassword ?? false, parentName: s.parentName || null, parentPhone: s.parentPhone || null, parentRelation: s.parentRelation || null, parentNote: s.parentNote || null, parent2Name: s.parent2Name || null, parent2Phone: s.parent2Phone || null, parent2Relation: s.parent2Relation || null } });
    studentMap[s.id] = row.id;
  }
  rec('Student', studentIds.length, Object.keys(studentMap).length);

  // ── Finance (+ installments) ──
  const finKeys = await scanAll('finance:*');
  let finN = 0, instN = 0;
  for (const fk of finKeys) {
    const f = await redis.get(fk);
    if (!f) continue;
    const sid = studentMap[f.studentId];
    if (!sid) { console.warn('  finance: öğrenci eşleşmedi, atlandı:', f.studentId); continue; }
    const fin = await prisma.finance.create({ data: { orgSlug: ORG, branch: BRANCH, studentId: sid, registrationDate: f.registrationDate || null, totalFee: f.totalFee ?? 0, discount: f.discount ?? 0, netFee: f.netFee ?? 0, paymentPlan: f.paymentPlan || 'pesin', payments: f.payments ?? null } });
    finN++;
    for (const inst of (f.installments || [])) {
      await prisma.installment.create({ data: { financeId: fin.id, idx: inst.idx ?? 0, dueDate: inst.dueDate || '', amount: inst.amount ?? 0, paid: inst.paid ?? false, paidDate: inst.paidDate || null, paidAmount: inst.paidAmount ?? null, method: inst.method || null, receiptNo: inst.receiptNo || null } });
      instN++;
    }
  }
  rec('Finance', finKeys.length, finN);
  if (instN) rec('Installment', instN, instN);

  // ── Behavior (davranis:<sid>) ──
  const behKeys = await scanAll('davranis:*');
  let behN = 0, behEntryN = 0;
  for (const bk of behKeys) {
    const b = await redis.get(bk);
    if (!b) continue;
    const sid = studentMap[b.studentId];
    if (!sid) continue;
    const beh = await prisma.behavior.create({ data: { orgSlug: ORG, branch: BRANCH, studentId: sid, total: b.total ?? 0 } });
    behN++;
    for (const e of (b.entries || [])) {
      await prisma.behaviorEntry.create({ data: { behaviorId: beh.id, points: e.points ?? 0, reason: e.reason || null, note: e.note || null, byName: e.byName || null, byRole: e.byRole || null, by: e.by || null, createdAt: e.at ? new Date(e.at) : (e.createdAt ? new Date(e.createdAt) : new Date()) } });
      behEntryN++;
    }
  }
  rec('Behavior', behKeys.length, behN);

  // ── Hedef (hedef:<sid>) — öğrenci başına tek kayıt, studentId = legacy (plain) ──
  const hedefKeys = await scanAll('hedef:*');
  let hedefN = 0;
  for (const hk of hedefKeys) {
    const h = await redis.get(hk);
    if (!h) continue;
    const sid = strip(hk).split(':')[1];
    await prisma.hedef.create({ data: { orgSlug: ORG, branch: BRANCH, studentId: sid, weekly: h.weekly ?? 0, setBy: h.setBy || null, setByName: h.setByName || null, updatedAt: h.updatedAt ? new Date(h.updatedAt) : new Date() } });
    hedefN++;
  }
  rec('Hedef', hedefKeys.length, hedefN);

  // ── Guidance (guidance:<sid>:<weekKey>) — öğrenci+hafta bazlı, studentId = legacy (plain) ──
  const guideKeys = await scanAll('guidance:*');
  let guideN = 0;
  for (const gk of guideKeys) {
    const g = await redis.get(gk);
    if (!g) continue;
    const parts = strip(gk).split(':'); // ['guidance', sid, ...weekKey]
    const sid = parts[1];
    const week = parts.slice(2).join(':');
    await prisma.guidance.create({ data: { orgSlug: ORG, branch: BRANCH, studentId: sid, week, data: g } });
    guideN++;
  }
  rec('Guidance', guideKeys.length, guideN);

  // ── Topic (topics:<sid>) — öğrenci başına tek blob, studentId = legacy ──
  const topicKeys = await scanAll('topics:*');
  let topicN = 0;
  for (const tk of topicKeys) {
    const t = await redis.get(tk);
    if (!t) continue;
    const sid = strip(tk).split(':')[1];
    await prisma.topic.create({ data: { orgSlug: ORG, branch: BRANCH, studentId: sid, data: t } });
    topicN++;
  }
  rec('Topic', topicKeys.length, topicN);

  // ── Lead (leadler set + lead:<id>) — aday öğrenci hunisi, data = tam kayıt ──
  const leadIds = await smem('leadler');
  let leadN = 0;
  for (const id of leadIds) {
    const l = await jget('lead:' + id);
    if (!l) continue;
    await prisma.lead.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: l.id, name: l.studentName || '', stage: l.status || 'yeni', data: l } });
    leadN++;
  }
  rec('Lead', leadIds.length, leadN);

  // ── Etkinlik (etkinlikler set + etkinlik:<id>) — data = tam kayıt ──
  const etkIds = await smem('etkinlikler');
  let etkN = 0;
  for (const id of etkIds) {
    const e = await jget('etkinlik:' + id);
    if (!e) continue;
    await prisma.etkinlik.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: e.id, title: e.title || '', type: e.type || 'diger', startDate: e.startDate || '', endDate: e.endDate || null, data: e } });
    etkN++;
  }
  rec('Etkinlik', etkIds.length, etkN);

  // ── Resource (resources set + resource:<id>) — LMS kaynak, data = tam kayıt ──
  const resIds = await smem('resources');
  let resN = 0;
  for (const id of resIds) {
    const r = await jget('resource:' + id);
    if (!r) continue;
    await prisma.resource.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: r.id, title: r.title || '', url: r.url || null, data: r } });
    resN++;
  }
  rec('Resource', resIds.length, resN);

  // ── Odev (odevler set + odev:<id> + odev:<id>:sub:<sid>) — teslimler JSON-map'e toplanır ──
  const odevIds = await smem('odevler');
  let odevN = 0;
  for (const id of odevIds) {
    const o = await jget('odev:' + id);
    if (!o) continue;
    const teslimler = await smem(`odev:${id}:teslimler`);
    const submissions = {};
    for (const sid of (teslimler || [])) {
      const sub = await jget(`odev:${id}:sub:${sid}`);
      if (sub) submissions[sid] = sub; // studentId = legacy (route legacy id ile çalışır)
    }
    await prisma.odev.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: o.id, data: { ...o, submissions } } });
    odevN++;
  }
  rec('Odev', odevIds.length, odevN);

  // ── Form (+ yanıtlar) — form:<id> + form:<id>:yanit:<respId>, FormResponse normalize ──
  const formIds = await smem('formlar');
  let formN = 0, formRespN = 0;
  for (const id of formIds) {
    const f = await jget('form:' + id);
    if (!f) continue;
    const formRow = await prisma.form.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: f.id, data: f } });
    formN++;
    const respIds = await smem(`form:${id}:yanitlayanlar`);
    for (const rid of (respIds || [])) {
      const resp = await jget(`form:${id}:yanit:${rid}`);
      if (resp) { await prisma.formResponse.create({ data: { formId: formRow.id, respondent: rid, data: resp } }); formRespN++; }
    }
  }
  rec('Form', formIds.length, formN);
  if (formRespN) rec('FormResponse', formRespN, formRespN);

  // ── Announcement (+ alıcılar) — recipients[] normalize, reads set → read bayrağı ──
  const annIds = await smem('announcements');
  let annN = 0, annRecipN = 0;
  for (const id of annIds) {
    const a = await jget('announcement:' + id);
    if (!a) continue;
    const { recipients = [], ...dataNoRecips } = a;
    const annRow = await prisma.announcement.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: a.id, data: dataNoRecips, createdAt: a.createdAt ? new Date(a.createdAt) : new Date() } });
    annN++;
    const reads = new Set((await smem(`announcement:${id}:reads`)) || []);
    for (const r of recipients) {
      await prisma.announcementRecipient.create({ data: { orgSlug: ORG, branch: BRANCH, announcementId: annRow.id, role: r.role, recipientId: r.id, name: r.name || null, read: reads.has(r.id) } });
      annRecipN++;
    }
  }
  rec('Announcement', annIds.length, annN);
  if (annRecipN) rec('AnnouncementRecipient', annRecipN, annRecipN);

  // ── Exam (deneme:exam:<id>) ──
  const examKeys = (await scanAll('deneme:exam:*')).filter(k => !strip(k).includes(':exams:'));
  let examN = 0, rowN = 0;
  for (const ek of examKeys) {
    const e = await redis.get(ek);
    if (!e || !e.id) continue;
    const ex = await prisma.exam.create({ data: { orgSlug: ORG, branch: BRANCH, legacyId: e.id, name: e.name || '', examType: e.examType || '', category: e.category || null, date: e.date || null, kitapcikSayisi: e.kitapcikSayisi ?? 1, subjectKeys: e.subjectKeys || [], answerKey: e.answerKey ?? null, computedAt: e.computedAt ? new Date(e.computedAt) : null, createdAt: e.createdAt ? new Date(e.createdAt) : new Date() } });
    examN++;
    for (const r of (e.rows || [])) {
      await prisma.examRow.create({ data: { examId: ex.id, studentId: r.studentId ? (studentMap[r.studentId] || r.studentId) : null, data: r } });
      rowN++;
    }
  }
  rec('Exam', examKeys.length, examN);

  // ── TenantConfig (slot_times + current_week + deneme namemap) ──
  const slotTimes = await jget('slot_times');
  const currentWeek = await jget('current_week');
  const rcRaw = await jget('receipt_counter');
  const denemeNameMap = await jget('deneme:namemap');
  const receiptCounter = parseInt(rcRaw) || 0;
  if (slotTimes || currentWeek || rcRaw != null || denemeNameMap) {
    await prisma.tenantConfig.create({ data: { orgSlug: ORG, branch: BRANCH, slotTimes: slotTimes ?? null, currentWeek: (typeof currentWeek === 'string' ? currentWeek : null), programTemplate: null, receiptCounter, denemeNameMap: denemeNameMap ?? null } });
  }
  rec('TenantConfig', (slotTimes || currentWeek || rcRaw != null || denemeNameMap) ? 1 : 0, (slotTimes || currentWeek || rcRaw != null || denemeNameMap) ? 1 : 0);

  // ── SlotBooking (slot:<week>:<teacher>:<day>:<slotId>) ──
  const slotKeys = await scanAll('slot:*');
  const slotRows = [];
  for (const sk of slotKeys) {
    const parts = strip(sk).split(':'); // ['slot', weekKey, teacherId, dayIdx, slotId]
    if (parts.length < 5) continue;
    const teacherId = teacherMap[parts[2]];
    if (!teacherId) continue;
    const v = await redis.get(sk) || {};
    slotRows.push({
      orgSlug: ORG, branch: BRANCH, weekKey: parts[1], teacherId, dayIndex: Number(parts[3]) || 0, slotId: parts[4],
      booked: v.booked ?? false, disabled: v.disabled ?? false, fixed: v.fixed ?? false,
      studentId: v.studentId || null, // legacy id olarak sakla (SQL de böyle kullanılır)
      studentName: v.studentName || null, studentCls: v.studentCls || null, dersBranch: v.branch || null, bookedBy: v.bookedBy || null,
      data: v, // tam hücre içeriği (lessonType, cls, subBranch, branch, bookedAt dahil)
    });
  }
  let slotN = 0;
  for (let i = 0; i < slotRows.length; i += 200) {
    const r = await prisma.slotBooking.createMany({ data: slotRows.slice(i, i + 200) });
    slotN += r.count;
  }
  rec('SlotBooking', slotKeys.length, slotN);

  // ── Attendance (attendance:{date}:{legacyTeacherId}:{cls}:{lessonNo}) ──
  const attKeys = await scanAll('attendance:*');
  let attN = 0;
  for (const ak of attKeys) {
    const parts = strip(ak).split(':'); // ['attendance', date, teacherId, cls, lessonNo]
    if (parts.length < 5) continue;
    const [, date, legacyTeacherId, cls, lessonNo] = parts;
    const teacherId = teacherMap[legacyTeacherId];
    if (!teacherId) continue;
    const records = await redis.get(ak) || {};
    try {
      await prisma.attendance.create({
        data: { orgSlug: ORG, branch: BRANCH, date, teacherId, cls, lessonNo, records },
      });
      attN++;
    } catch { /* yinelenen → atla */ }
  }
  rec('Attendance', attKeys.length, attN);

  // ── AuditLog (audit:<ts>:<rand>) — geçmiş denetim kayıtları (90g TTL'liydi) ──
  const auditKeys = await scanAll('audit:*');
  let auditN = 0;
  for (let i = 0; i < auditKeys.length; i += 100) {
    const chunk = auditKeys.slice(i, i + 100);
    const vals = await Promise.all(chunk.map(k => redis.get(k)));
    const rows = vals.filter(Boolean).map(v => ({
      orgSlug: ORG, branch: BRANCH, at: v.ts ? new Date(v.ts) : new Date(),
      actor: v.actorName || v.actorId || null, action: v.action || '', data: v,
    }));
    if (rows.length) { const r = await prisma.auditLog.createMany({ data: rows }); auditN += r.count; }
  }
  rec('AuditLog', auditKeys.length, auditN);

  // ── ErrLog (errlog:<ts>:<rand>) — geçmiş hata kayıtları (30g TTL'liydi) ──
  const errKeys = await scanAll('errlog:*');
  let errN = 0;
  for (let i = 0; i < errKeys.length; i += 100) {
    const chunk = errKeys.slice(i, i + 100);
    const vals = await Promise.all(chunk.map(k => redis.get(k)));
    const rows = vals.filter(Boolean).map(v => ({
      orgSlug: ORG, branch: BRANCH, at: v.ts ? new Date(v.ts) : new Date(),
      message: v.message || '', data: v,
    }));
    if (rows.length) { const r = await prisma.errLog.createMany({ data: rows }); errN += r.count; }
  }
  rec('ErrLog', errKeys.length, errN);

  // ── PushSub (push_subs:<role>:<userId> = abonelik dizisi) — endpoint başına satır ──
  const pushKeys = await scanAll('push_subs:*');
  let pushN = 0;
  for (const pk of pushKeys) {
    const parts = strip(pk).split(':'); // ['push_subs', role, userId]
    const role = parts[1];
    const userId = parts.slice(2).join(':');
    const list = await redis.get(pk);
    for (const sub of (Array.isArray(list) ? list : [])) {
      if (!sub?.endpoint) continue;
      try { await prisma.pushSub.create({ data: { orgSlug: ORG, branch: BRANCH, role, userId, endpoint: sub.endpoint, keys: sub.keys || {} } }); pushN++; }
      catch { /* yinelenen endpoint → atla */ }
    }
  }
  rec('PushSub', pushKeys.length + ' key', pushN);

  await prisma.$disconnect();
  console.log('\n=== GÖÇ ÖZETİ ===');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(16)} ${v}`);
  console.log('\nNOT: log/transient (audit/errlog/push_subs/receipt_counter) ve boş ikincil modüller şimdilik atlandı.');
}

main().catch(async (e) => { console.error('GÖÇ HATASI:', e); await prisma.$disconnect(); process.exit(1); });
