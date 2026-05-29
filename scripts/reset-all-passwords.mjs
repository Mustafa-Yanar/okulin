// Tek seferlik: mevcut tüm kullanıcıların (öğrenci, öğretmen, muhasebeci)
// şifrelerini rastgele yeniler ve mustChangePassword:true ile işaretler.
// Müdür hesabı dahil DEĞİL.
//
// Kullanım:
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/reset-all-passwords.mjs
//
// Çıktı: sifreler-YYYY-MM-DD-HHmm.csv (.gitignore'da)

import { Redis } from '@upstash/redis';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

function randomPassword(length = 8) {
  const bytes = randomBytes(length);
  let r = '';
  for (let i = 0; i < length; i++) r += ALPHABET[bytes[i] % ALPHABET.length];
  return r;
}

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const ROLE_CONFIGS = [
  { setKey: 'students',    keyPrefix: 'student',    label: 'Öğrenci' },
  { setKey: 'teachers',    keyPrefix: 'teacher',    label: 'Öğretmen' },
  { setKey: 'accountants', keyPrefix: 'accountant', label: 'Muhasebeci' },
];

async function resetRole({ setKey, keyPrefix, label }) {
  const ids = await redis.smembers(setKey);
  console.log(`\n[${label}] ${ids.length} kullanıcı işleniyor...`);
  const rows = [];
  let n = 0;
  for (const id of ids) {
    const user = await redis.get(`${keyPrefix}:${id}`);
    if (!user) {
      console.log(`  ! ${id}: kayıt bulunamadı, atlandı`);
      continue;
    }
    const password = randomPassword(8);
    const passwordHash = await bcrypt.hash(password, 10);
    const updated = { ...user, passwordHash, mustChangePassword: true };
    await redis.set(`${keyPrefix}:${id}`, updated);
    rows.push({
      role: label,
      name: user.name || '(isimsiz)',
      cls: user.cls || '—',
      username: user.username || user.name || '',
      password,
    });
    n++;
    if (n % 20 === 0) console.log(`  ... ${n}/${ids.length}`);
  }
  console.log(`  ✓ ${label}: ${n} kullanıcı sıfırlandı`);
  return rows;
}

function csvEscape(value) {
  const s = String(value || '');
  // Çift tırnak içeren değerleri escape et
  return `"${s.replace(/"/g, '""')}"`;
}

function buildCsv(rows) {
  const header = ['Rol', 'İsim', 'Sınıf', 'Kullanıcı Adı', 'Yeni Şifre'];
  const lines = [
    header.map(csvEscape).join(','),
    ...rows.map(r => [r.role, r.name, r.cls, r.username, r.password].map(csvEscape).join(',')),
  ];
  // UTF-8 BOM — Excel Türkçe karakterleri doğru okusun
  return '﻿' + lines.join('\n');
}

function timestamp() {
  const d = new Date();
  // YYYY-MM-DD-HHmm (UTC, Türkiye için +3 ekleyelim ki dosya adı yerel saatle uyumlu)
  const tr = new Date(d.getTime() + 3 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${tr.getUTCFullYear()}-${pad(tr.getUTCMonth() + 1)}-${pad(tr.getUTCDate())}-${pad(tr.getUTCHours())}${pad(tr.getUTCMinutes())}`;
}

async function main() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('HATA: UPSTASH_REDIS_REST_URL ve UPSTASH_REDIS_REST_TOKEN env değişkenleri gerekli.');
    process.exit(1);
  }

  console.log('=== Tüm kullanıcıların şifresi sıfırlanıyor ===');
  console.log('Müdür hesabı DAHİL DEĞİL.\n');

  const allRows = [];
  for (const cfg of ROLE_CONFIGS) {
    const rows = await resetRole(cfg);
    allRows.push(...rows);
  }

  // CSV: önce role'e göre (öğretmen → muhasebeci → öğrenci sırasında öğretmen kart sayısı az)
  // sonra sınıfa, sonra isime göre sırala — müdürün dağıtması kolay olsun
  const roleOrder = { 'Öğretmen': 0, 'Muhasebeci': 1, 'Öğrenci': 2 };
  allRows.sort((a, b) => {
    const ro = roleOrder[a.role] - roleOrder[b.role];
    if (ro !== 0) return ro;
    if (a.cls !== b.cls) return a.cls.localeCompare(b.cls, 'tr');
    return a.name.localeCompare(b.name, 'tr');
  });

  const csv = buildCsv(allRows);
  const filename = `sifreler-${timestamp()}.csv`;
  writeFileSync(filename, csv, 'utf-8');

  console.log(`\n=== TAMAMLANDI ===`);
  console.log(`Toplam: ${allRows.length} kullanıcı sıfırlandı`);
  console.log(`CSV dosyası: ${filename}`);
  console.log(`(Dosya .gitignore'da — git'e girmez)\n`);
}

main().catch((err) => {
  console.error('HATA:', err);
  process.exit(1);
});
