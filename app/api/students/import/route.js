import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import redis from '@/lib/db';
import { getSession, randomPassword } from '@/lib/auth';
import { classToGroup } from '@/lib/constants';
import { normalizeTurkishMobile } from '@/lib/phone';
import { addToIndex } from '@/lib/userIndex';

function makeId() {
  return Math.random().toString(36).slice(2, 10);
}

// "ahmet mehmet yılmaz" → "Ahmet Mehmet YILMAZ"
function formatName(raw) {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0) return raw;
  const surname = parts[parts.length - 1].toUpperCase('tr-TR');
  const firstNames = parts.slice(0, -1).map(p =>
    p.charAt(0).toLocaleUpperCase('tr-TR') + p.slice(1).toLocaleLowerCase('tr-TR')
  );
  return [...firstNames, surname].join(' ');
}

export async function POST(req) {
  const session = await getSession();
  if (!session || session.role !== 'director') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!file) return NextResponse.json({ error: 'Dosya bulunamadı' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Mevcut öğrenci kullanıcı adlarını al
  const existingIds = await redis.smembers('students');
  const existingUsernames = new Set();
  for (const sid of existingIds) {
    const s = await redis.get(`student:${sid}`);
    if (s?.username) existingUsernames.add(s.username);
  }

  const results = { added: [], skipped: [], errors: [] };

  for (const row of rows) {
    const rawName = String(row[0] || '').trim();
    const rawCls = String(row[1] || '').trim();
    const phone = String(row[2] || '').trim();
    const parentPhone = String(row[3] || '').trim();

    if (!rawName || !rawCls) continue;

    const name = formatName(rawName);
    const cls = rawCls;
    const group = classToGroup(cls);

    if (!group) {
      results.errors.push(`${name}: geçersiz sınıf "${cls}"`);
      continue;
    }

    if (existingUsernames.has(name)) {
      results.skipped.push(name);
      continue;
    }

    // Telefonları normalize et; geçersizse öğrenciyi atlamadan boş bırak ve uyar
    let normPhone = '';
    if (phone) {
      normPhone = normalizeTurkishMobile(phone) || '';
      if (!normPhone) results.errors.push(`${name}: öğrenci telefonu geçersiz ("${phone}"), boş bırakıldı`);
    }
    let normParentPhone = '';
    if (parentPhone) {
      normParentPhone = normalizeTurkishMobile(parentPhone) || '';
      if (!normParentPhone) results.errors.push(`${name}: veli telefonu geçersiz ("${parentPhone}"), boş bırakıldı`);
    }

    const password = randomPassword(8);
    const hash = await bcrypt.hash(password, 10);
    const id = makeId();
    const student = {
      id, name, username: name, passwordHash: hash, cls, group,
      phone: normPhone, parentPhone: normParentPhone,
      mustChangePassword: true,  // ilk girişte öğrenci kendi şifresini belirleyecek
    };
    await redis.set(`student:${id}`, student);
    await redis.sadd('students', id);
    await addToIndex(name, 'student', id);
    existingUsernames.add(name);
    results.added.push({ name, cls, password });
  }

  return NextResponse.json(results);
}
