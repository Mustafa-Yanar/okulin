import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { withAuth, initialPassword } from '@/lib/auth';
import { getClasses } from '@/lib/classes';
import { normalizeTurkishMobile } from '@/lib/phone';
import { tdb } from '@/lib/sqldb';

import { newId as makeId } from '@/lib/id';

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

export const POST = withAuth('manage', async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!file) return NextResponse.json({ error: 'Dosya bulunamadı' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  // Şube → köprü grubu haritası (registry; boşsa constants'tan türetilmiş sanal liste).
  const allClasses = await getClasses();
  const groupById = new Map(allClasses.map((c) => [c.id, c.group]));

  // Mevcut öğrenci kullanıcı adları + sınıf legacyId→id haritası
  const studs = await tdb().student.findMany({ select: { username: true } });
  const existingUsernames = new Set(studs.filter((s) => s.username).map((s) => s.username));
  const classes = await tdb().class.findMany({ select: { id: true, legacyId: true } });
  const clsIdMap = new Map(classes.map((c) => [c.legacyId, c.id]));

  const results = { added: [], skipped: [], errors: [] };

  for (const row of rows) {
    const rawName = String(row[0] || '').trim();
    const rawCls = String(row[1] || '').trim();
    const phone = String(row[2] || '').trim();
    const parentPhone = String(row[3] || '').trim();
    const parentName = String(row[4] || '').trim(); // 5. sütun — opsiyonel, sona eklendi (eski dosyalar bozulmaz)
    const rawDiploma = String(row[5] || '').trim(); // 6. sütun — diploma notu (yalnız mezun, opsiyonel)

    if (!rawName || !rawCls) continue;

    const name = formatName(rawName);
    const cls = rawCls;
    const group = groupById.get(cls);

    if (!group) {
      results.errors.push(`${name}: geçersiz sınıf "${cls}"`);
      continue;
    }

    // Diploma notu (yalnız mezun): geçersizse öğrenciyi atlamadan boş bırak ve uyar.
    let diplomaNotu = '';
    if (group === 'mezun' && rawDiploma) {
      const v = parseFloat(rawDiploma.replace(',', '.'));
      if (!isNaN(v) && v >= 50 && v <= 100) diplomaNotu = Math.round(v * 100) / 100;
      else results.errors.push(`${name}: diploma notu geçersiz ("${rawDiploma}"), boş bırakıldı`);
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

    // İlk şifre: öğrenci telefonu (varsa), yoksa sabit "12345678". İlk girişte zorunlu değişim.
    const password = initialPassword('', normPhone);
    const hash = await bcrypt.hash(password, 10);
    const id = makeId();
    await tdb().student.create({ data: {
      legacyId: id, name, username: name, passwordHash: hash,
      classId: clsIdMap.get(cls) || null, group,
      phone: normPhone || null, parentPhone: normParentPhone || null,
      parentName: parentName || null,
      diplomaNotu: diplomaNotu === '' ? null : diplomaNotu, // Float? ; '' → null
      mustChangePassword: true,
    } });
    existingUsernames.add(name);
    results.added.push({ name, cls, password });
  }

  return NextResponse.json(results);
});
