import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/db';
import { getSession, initialPassword } from '@/lib/auth';
import { classToGroup } from '@/lib/constants';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zId } from '@/lib/validate';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

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

  const group = classToGroup(cls);
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
  const student = await redis.get(`student:${id}`);
  if (!student) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const group = classToGroup(cls) || student.group;
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
