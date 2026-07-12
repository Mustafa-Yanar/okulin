import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import * as XLSX from 'xlsx';
import { withAuth, initialPassword } from '@/lib/auth';
import { getClasses } from '@/lib/classes';
import { normalizeTurkishMobile } from '@/lib/phone';
import { tdb, withScope } from '@/lib/sqldb';

import { newId as makeId } from '@/lib/id';

// "ahmet mehmet yılmaz" → "Ahmet Mehmet YILMAZ"
function formatName(raw: string): string {
  const parts = raw.trim().split(/\s+/);
  if (parts.length === 0) return raw;
  // NOT: eski kod toUpperCase('tr-TR') idi — argüman yok sayılır, düz toUpperCase çalışır.
  // Davranışı birebir korumak için toLocaleUpperCase'e GEÇİLMEDİ (İ/I farkı yaratırdı).
  const surname = parts[parts.length - 1].toUpperCase();
  const firstNames = parts.slice(0, -1).map(p =>
    p.charAt(0).toLocaleUpperCase('tr-TR') + p.slice(1).toLocaleLowerCase('tr-TR')
  );
  return [...firstNames, surname].join(' ');
}

export const POST = withAuth('manage', async (req) => {
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: 'Dosya bulunamadı' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  // Başlık satırı (indirilebilir şablonun 1. satırı) varsa atla — B sütununda "sınıf/kod"
  // geçen satır başlıktır (gerçek sınıf kodu "701" bu kelimeleri içermez). Başlıksız eski
  // dosyalar da çalışmaya devam eder.
  const rows = allRows.length && /s[ıi]n[ıi]f|kod/i.test(String(allRows[0]?.[1] || ''))
    ? allRows.slice(1) : allRows;

  // Şube → köprü grubu haritası (registry; boşsa constants'tan türetilmiş sanal liste).
  const allClasses = await getClasses();
  const groupById = new Map(allClasses.map((c) => [c.id, c.group]));

  // Mevcut öğrenci kullanıcı adları + sınıf legacyId→id haritası
  const studs = await tdb().student.findMany({ select: { username: true } });
  const existingUsernames = new Set(studs.filter((s) => s.username).map((s) => s.username));
  const classes = await tdb().class.findMany({ select: { id: true, legacyId: true } });
  const clsIdMap = new Map(classes.map((c) => [c.legacyId, c.id]));

  const results: { added: { name: string; cls: string; password: string }[]; skipped: string[]; errors: string[] } = { added: [], skipped: [], errors: [] };

  for (const row of rows) {
    const rawName = String(row[0] || '').trim();
    const rawCls = String(row[1] || '').trim();
    const phone = String(row[2] || '').trim();
    const parentPhone = String(row[3] || '').trim();
    const parentName = String(row[4] || '').trim(); // E — veli adı (opsiyonel)
    const rawDiploma = String(row[5] || '').trim(); // F — diploma notu (yalnız mezun, opsiyonel)
    const tcNo = String(row[6] || '').trim().replace(/\D/g, ''); // G — öğrenci TC (opsiyonel)
    const parentTcNo = String(row[7] || '').trim().replace(/\D/g, ''); // H — veli TC (opsiyonel)
    const parentAddress = String(row[8] || '').trim(); // I — veli adresi (opsiyonel)

    if (!rawName || !rawCls) continue;

    const name = formatName(rawName);
    const cls = rawCls;
    const group = groupById.get(cls);

    if (!group) {
      results.errors.push(`${name}: geçersiz sınıf "${cls}"`);
      continue;
    }

    // Diploma notu (yalnız mezun): geçersizse öğrenciyi atlamadan boş bırak ve uyar.
    let diplomaNotu: number | '' = '';
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
    await tdb().student.create({ data: withScope({
      legacyId: id, name, username: name, passwordHash: hash,
      classId: clsIdMap.get(cls) || null, group,
      phone: normPhone || null, parentPhone: normParentPhone || null,
      parentName: parentName || null,
      tcNo: tcNo || null, parentTcNo: parentTcNo || null, parentAddress: parentAddress || null,
      diplomaNotu: diplomaNotu === '' ? null : diplomaNotu, // Float? ; '' → null
      mustChangePassword: true,
    }) });
    existingUsernames.add(name);
    results.added.push({ name, cls, password });
  }

  return NextResponse.json(results);
});
