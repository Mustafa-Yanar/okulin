import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import redis from '@/lib/db';
import { getSession } from '@/lib/auth';
import { classToGroup } from '@/lib/constants';
import { normalizeTurkishMobile } from '@/lib/phone';
import { logAudit, actorFrom } from '@/lib/audit';
import { addToIndex, removeFromIndex, updateIndexUsername } from '@/lib/userIndex';
import { parseBody, z, zName, zPassword, zId } from '@/lib/validate';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

const zPhone = z.string().max(40).optional();
const zBirthDate = z.string().max(20).optional(); // YYYY-MM-DD
const zParentName = z.string().max(120).optional(); // veli adı soyadı (opsiyonel)
const StudentCreateSchema = z.object({
  // Şifre opsiyonel: boş bırakılırsa öğrenci telefonu ilk şifre olur (aşağıda kontrol).
  name: zName, password: z.string().max(200).optional(), cls: z.string().min(1).max(40),
  phone: zPhone, parentPhone: zPhone, parentName: zParentName, birthDate: zBirthDate,
});
const StudentUpdateSchema = z.object({
  id: zId, name: zName, cls: z.string().min(1).max(40),
  password: z.string().max(200).optional(),
  phone: zPhone, parentPhone: zPhone, parentName: zParentName, birthDate: zBirthDate,
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
  const { name, password, cls, phone, parentPhone, parentName, birthDate } = parsed.data;

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  const group = classToGroup(cls);
  if (!group) return NextResponse.json({ error: 'Geçersiz sınıf' }, { status: 400 });

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

  // Şifre kuralı: girilmişse o; boşsa öğrenci telefonu ilk şifre olur.
  // Telefon da yoksa şifre zorunlu (ya telefon ya şifre).
  let initialPassword = (password || '').trim();
  if (!initialPassword) {
    if (!normPhone) {
      return NextResponse.json({ error: 'Şifre boş bırakıldı — öğrenci telefonu yoksa şifre zorunludur' }, { status: 400 });
    }
    initialPassword = normPhone; // ilk şifre = telefon
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
  const hash = await bcrypt.hash(initialPassword, 10);
  const student = {
    id, name, username, passwordHash: hash, cls, group,
    phone: normPhone, parentPhone: normParentPhone,
    parentName: (parentName || '').trim(),
    birthDate: birthDate || '',
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
  const { id, name, password, cls, phone, parentPhone, parentName, birthDate } = parsed.data;
  const student = await redis.get(`student:${id}`);
  if (!student) return NextResponse.json({ error: 'Öğrenci bulunamadı' }, { status: 404 });

  const group = classToGroup(cls) || student.group;
  const updated = { ...student, name, username: name, cls, group,
    birthDate: birthDate !== undefined ? birthDate : (student.birthDate || ''),
    parentName: parentName !== undefined ? (parentName || '').trim() : (student.parentName || ''),
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
