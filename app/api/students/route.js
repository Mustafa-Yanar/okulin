import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/db';
import { getSession, initialPassword } from '@/lib/auth';
import { getClass } from '@/lib/classes';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zId } from '@/lib/validate';
import { isSqlEnabled } from '@/lib/usesql';
import { tdb } from '@/lib/sqldb';

import { newId as makeId } from '@/lib/id';

// SQL satırı (class include) → mevcut sözleşme şekli (id/cls = legacyId).
const studentOut = (s) => ({
  id: s.legacyId, name: s.name, username: s.username, cls: s.class?.legacyId || '', group: s.group,
  phone: s.phone || '', parentPhone: s.parentPhone || '', parentName: s.parentName || '', birthDate: s.birthDate || '',
  diplomaNotu: s.diplomaNotu ?? '', obp: s.diplomaNotu ? Math.round(s.diplomaNotu * 5 * 100) / 100 : null,
  parentRelation: s.parentRelation || '', parentNote: s.parentNote || '',
  parent2Name: s.parent2Name || '', parent2Phone: s.parent2Phone || '', parent2Relation: s.parent2Relation || '',
});

const zPhone = z.string().max(40).optional();
const zBirthDate = z.string().max(20).optional(); // YYYY-MM-DD
const zDiplomaNotu = z.string().max(10).optional(); // mezun diploma notu 50-100 (OBP = ×5)

// Diploma notu string'ini doğrula → number (50-100) veya '' döndür; geçersizse null.
// group !== 'mezun' ise her zaman '' (OBP yalnız mezunda tutulur).
function normDiplomaNotu(raw, group) {
  if (group !== 'mezun') return '';
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  const v = parseFloat(s.replace(',', '.'));
  if (isNaN(v) || v < 50 || v > 100) return null; // geçersiz
  return Math.round(v * 100) / 100;
}
const zParentName = z.string().max(120).optional(); // veli adı soyadı (opsiyonel)
const zRelation = z.string().max(40).optional();    // yakınlık derecesi (Anne, Baba...)
const zNote = z.string().max(2000).optional();      // veliye özel not (yönetim görür)
// Veli ek alanları: yakınlık, not, 2. iletişim (ad/telefon/yakınlık)
const parentExtraFields = {
  parentRelation: zRelation, parentNote: zNote,
  parent2Name: zParentName, parent2Phone: zPhone, parent2Relation: zRelation,
};
const StudentCreateSchema = z.object({
  // Şifre opsiyonel: boş bırakılırsa öğrenci telefonu ilk şifre olur (aşağıda kontrol).
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

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  if (isSqlEnabled()) {
    const rows = await tdb().student.findMany({ include: { class: true } });
    return NextResponse.json(rows.map(studentOut));
  }

  const ids = await redis.smembers('students');
  if (!ids || ids.length === 0) return NextResponse.json([]);

  const pipeline = redis.pipeline();
  ids.forEach(id => pipeline.get(`student:${id}`));
  const results = await pipeline.exec();
  const students = results.filter(Boolean).map(s => ({
    id: s.id, name: s.name, username: s.username, cls: s.cls, group: s.group,
    phone: s.phone || '', parentPhone: s.parentPhone || '', parentName: s.parentName || '', birthDate: s.birthDate || '',
    diplomaNotu: s.diplomaNotu ?? '', obp: s.diplomaNotu ? Math.round(s.diplomaNotu * 5 * 100) / 100 : null,
    parentRelation: s.parentRelation || '', parentNote: s.parentNote || '',
    parent2Name: s.parent2Name || '', parent2Phone: s.parent2Phone || '', parent2Relation: s.parent2Relation || '',
  }));
  return NextResponse.json(students);
}

export async function POST(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, StudentCreateSchema);
  if (!parsed.ok) return parsed.response;
  const { name, password, cls, phone, parentPhone, parentName, birthDate, diplomaNotu,
          parentRelation, parentNote, parent2Name, parent2Phone, parent2Relation } = parsed.data;

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  // Grup, şube kaydının köprü alanından gelir (registry boşsa constants'tan türetilir).
  const group = (await getClass(cls))?.group;
  if (!group) return NextResponse.json({ error: 'Geçersiz sınıf' }, { status: 400 });

  // Diploma notu (yalnız mezun): geçerli değilse hata; OBP = ×5 türetilir.
  const diploma = normDiplomaNotu(diplomaNotu, group);
  if (diploma === null) return NextResponse.json({ error: 'Diploma notu 50 ile 100 arasında olmalı' }, { status: 400 });

  // Telefon doğrulama (opsiyonel ama verilmişse geçerli Türk cep olmalı)
  let normPhone = '';
  if (phone) {
    normPhone = normalizeTurkishMobile(phone);
    if (!normPhone) return NextResponse.json({ error: 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
  }

  // Veli bilgileri ZORUNLU (öğrenci-veli bağı + veli paneli için)
  if (!(parentName || '').trim()) {
    return NextResponse.json({ error: 'Veli adı soyadı zorunludur' }, { status: 400 });
  }
  if (!parentPhone) {
    return NextResponse.json({ error: 'Veli telefonu zorunludur' }, { status: 400 });
  }
  const normParentPhone = normalizeTurkishMobile(parentPhone);
  if (!normParentPhone) return NextResponse.json({ error: 'Veli telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });

  // 2. iletişim telefonu (opsiyonel ama verilmişse geçerli olmalı)
  let normParent2Phone = '';
  if (parent2Phone) {
    normParent2Phone = normalizeTurkishMobile(parent2Phone);
    if (!normParent2Phone) return NextResponse.json({ error: '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
  }

  // Şifre kuralı (lib/auth.initialPassword): girilmişse o; boşsa öğrenci telefonu;
  // telefon da yoksa sabit "12345678". İlk girişte zorunlu değişim (mustChangePassword).
  const initPassword = initialPassword(password, normPhone);

  if (isSqlEnabled()) {
    const dup = await tdb().student.findFirst({ where: { username } });
    if (dup) return NextResponse.json({ error: 'Bu isimde bir öğrenci zaten kayıtlı' }, { status: 400 });
    const clsRow = await tdb().class.findFirst({ where: { legacyId: cls } });
    const hash = await bcrypt.hash(initPassword, 10);
    const legacyId = makeId();
    await tdb().student.create({ data: {
      legacyId, name, username, passwordHash: hash, classId: clsRow?.id || null, group,
      phone: normPhone, parentPhone: normParentPhone, parentName: (parentName || '').trim(),
      parentRelation: (parentRelation || '').trim(), parentNote: (parentNote || '').trim(),
      parent2Name: (parent2Name || '').trim(), parent2Phone: normParent2Phone, parent2Relation: (parent2Relation || '').trim(),
      birthDate: birthDate || '', diplomaNotu: (diploma === '' ? null : diploma), mustChangePassword: true,
    } });
    return NextResponse.json({ id: legacyId, name, username, cls, group });
  }

  // Aynı isimde öğrenci var mı kontrol et
  const studentIds = await redis.smembers('students');
  if (studentIds && studentIds.length > 0) {
    const pipeline = redis.pipeline();
    studentIds.forEach(sid => pipeline.get(`student:${sid}`));
    const students = await pipeline.exec();
    const exists = students.some(s => s && s.username === username);
    if (exists) {
      return NextResponse.json({ error: 'Bu isimde bir öğrenci zaten kayıtlı' }, { status: 400 });
    }
  }

  const id = makeId();
  const hash = await bcrypt.hash(initPassword, 10);
  const student = {
    id, name, username, passwordHash: hash, cls, group,
    phone: normPhone, parentPhone: normParentPhone,
    parentName: (parentName || '').trim(),
    parentRelation: (parentRelation || '').trim(),
    parentNote: (parentNote || '').trim(),
    parent2Name: (parent2Name || '').trim(),
    parent2Phone: normParent2Phone,
    parent2Relation: (parent2Relation || '').trim(),
    birthDate: birthDate || '',
    diplomaNotu: diploma, // '' (mezun değil/boş) veya 50-100 arası sayı; OBP = ×5
    mustChangePassword: true,  // ilk girişte öğrenci kendi şifresini belirleyecek
  };
  await redis.set(`student:${id}`, student);
  await redis.sadd('students', id);
  await addToIndex(username, 'student', id);

  return NextResponse.json({ id, name, username, cls, group });
}

export async function PUT(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, StudentUpdateSchema);
  if (!parsed.ok) return parsed.response;
  const { id, name, password, cls, phone, parentPhone, parentName, birthDate, diplomaNotu,
          parentRelation, parentNote, parent2Name, parent2Phone, parent2Relation } = parsed.data;

  if (isSqlEnabled()) {
    const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
    if (!s) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });
    const group = (await getClass(cls))?.group || s.group;
    let diploma = s.diplomaNotu ?? '';
    if (diplomaNotu !== undefined) {
      diploma = normDiplomaNotu(diplomaNotu, group);
      if (diploma === null) return NextResponse.json({ error: 'Diploma notu 50 ile 100 arasında olmalı' }, { status: 400 });
    } else if (group !== 'mezun') diploma = '';
    const clsRow = await tdb().class.findFirst({ where: { legacyId: cls } });
    const data = {
      name, username: name, classId: clsRow?.id ?? s.classId, group, diplomaNotu: (diploma === '' ? null : diploma),
      birthDate: birthDate !== undefined ? birthDate : (s.birthDate || ''),
      parentName: parentName !== undefined ? (parentName || '').trim() : (s.parentName || ''),
      parentRelation: parentRelation !== undefined ? (parentRelation || '').trim() : (s.parentRelation || ''),
      parentNote: parentNote !== undefined ? (parentNote || '').trim() : (s.parentNote || ''),
      parent2Name: parent2Name !== undefined ? (parent2Name || '').trim() : (s.parent2Name || ''),
      parent2Relation: parent2Relation !== undefined ? (parent2Relation || '').trim() : (s.parent2Relation || ''),
    };
    if (phone !== undefined) {
      if (phone) { const n = normalizeTurkishMobile(phone); if (!n) return NextResponse.json({ error: 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 }); data.phone = n; }
      else data.phone = '';
    }
    if (parentPhone !== undefined) {
      if (parentPhone) { const n = normalizeTurkishMobile(parentPhone); if (!n) return NextResponse.json({ error: 'Veli telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 }); data.parentPhone = n; }
      else data.parentPhone = '';
    }
    if (parent2Phone !== undefined) {
      if (parent2Phone) { const n = normalizeTurkishMobile(parent2Phone); if (!n) return NextResponse.json({ error: '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 }); data.parent2Phone = n; }
      else data.parent2Phone = '';
    }
    if (password) data.passwordHash = await bcrypt.hash(password, 10);
    await tdb().student.update({ where: { id: s.id }, data });
    return NextResponse.json({ ok: true });
  }

  const student = await redis.get(`student:${id}`);
  if (!student) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const group = (await getClass(cls))?.group || student.group;
  // Diploma notu: alan gönderildiyse yeniden değerlendir; mezun değilse '' olur.
  // Gönderilmediyse mevcut değeri koru (yine de mezun değilse temizle).
  let diploma = student.diplomaNotu ?? '';
  if (diplomaNotu !== undefined) {
    diploma = normDiplomaNotu(diplomaNotu, group);
    if (diploma === null) return NextResponse.json({ error: 'Diploma notu 50 ile 100 arasında olmalı' }, { status: 400 });
  } else if (group !== 'mezun') {
    diploma = '';
  }
  const updated = { ...student, name, username: name, cls, group, diplomaNotu: diploma,
    birthDate: birthDate !== undefined ? birthDate : (student.birthDate || ''),
    parentName: parentName !== undefined ? (parentName || '').trim() : (student.parentName || ''),
    parentRelation: parentRelation !== undefined ? (parentRelation || '').trim() : (student.parentRelation || ''),
    parentNote: parentNote !== undefined ? (parentNote || '').trim() : (student.parentNote || ''),
    parent2Name: parent2Name !== undefined ? (parent2Name || '').trim() : (student.parent2Name || ''),
    parent2Relation: parent2Relation !== undefined ? (parent2Relation || '').trim() : (student.parent2Relation || ''),
  };
  if (phone !== undefined) {
    if (phone) {
      const n = normalizeTurkishMobile(phone);
      if (!n) return NextResponse.json({ error: 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
      updated.phone = n;
    } else {
      updated.phone = '';
    }
  }
  if (parentPhone !== undefined) {
    if (parentPhone) {
      const n = normalizeTurkishMobile(parentPhone);
      if (!n) return NextResponse.json({ error: 'Veli telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
      updated.parentPhone = n;
    } else {
      updated.parentPhone = '';
    }
  }
  if (parent2Phone !== undefined) {
    if (parent2Phone) {
      const n = normalizeTurkishMobile(parent2Phone);
      if (!n) return NextResponse.json({ error: '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67' }, { status: 400 });
      updated.parent2Phone = n;
    } else {
      updated.parent2Phone = '';
    }
  }
  if (password) {
    updated.passwordHash = await bcrypt.hash(password, 10);
  }
  await redis.set(`student:${id}`, updated);
  // İsim (=username) değiştiyse indeksi güncelle
  await updateIndexUsername(student.username, name, 'student', id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req) {
  const session = await getSession();
  if (!session || (session.role !== 'director' && session.role !== 'counselor')) {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const parsed = await parseBody(req, StudentDeleteSchema);
  if (!parsed.ok) return parsed.response;
  const { id, ids } = parsed.data;

  if (isSqlEnabled()) {
    if (ids && Array.isArray(ids)) {
      await tdb().student.deleteMany({ where: { legacyId: { in: ids } } }); // cascade: finance/behavior
      await logAudit({ ...actorFrom(session), action: 'student.bulkDelete', detail: `${ids.length} öğrenci toplu silindi` });
      return NextResponse.json({ ok: true, deleted: ids.length });
    }
    const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
    if (s) await tdb().student.delete({ where: { id: s.id } });
    await logAudit({ ...actorFrom(session), action: 'student.delete', target: { type: 'student', id, name: s?.name || id }, detail: `Öğrenci silindi: ${s?.name || id}${s?.class?.legacyId ? ` (${s.class.legacyId})` : ''}` });
    return NextResponse.json({ ok: true });
  }

  // Toplu silme — indeks temizliği için önce username'leri oku
  if (ids && Array.isArray(ids)) {
    const readPipe = redis.pipeline();
    ids.forEach(sid => readPipe.get(`student:${sid}`));
    const recs = await readPipe.exec();
    const pipeline = redis.pipeline();
    ids.forEach(sid => {
      pipeline.del(`student:${sid}`);
      pipeline.srem('students', sid);
    });
    await pipeline.exec();
    // İndeksten düşür
    for (let i = 0; i < ids.length; i++) {
      const rec = recs[i];
      if (rec?.username) await removeFromIndex(rec.username, 'student', ids[i]);
    }
    await logAudit({
      ...actorFrom(session),
      action: 'student.bulkDelete',
      detail: `${ids.length} öğrenci toplu silindi`,
    });
    return NextResponse.json({ ok: true, deleted: ids.length });
  }

  // Tekil silme — adı loglamak için önce oku
  const student = await redis.get(`student:${id}`);
  await redis.del(`student:${id}`);
  await redis.srem('students', id);
  if (student?.username) await removeFromIndex(student.username, 'student', id);
  await logAudit({
    ...actorFrom(session),
    action: 'student.delete',
    target: { type: 'student', id, name: student?.name || id },
    detail: `Öğrenci silindi: ${student?.name || id}${student?.cls ? ` (${student.cls})` : ''}`,
  });
  return NextResponse.json({ ok: true });
}
