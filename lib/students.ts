import bcrypt from 'bcryptjs';
import { getClass } from '@/lib/classes';
import { normalizeTurkishMobile } from '@/lib/phone';
import { initialPassword } from '@/lib/auth';
import { HttpError } from '@/lib/errors';
import { tdb, withScope, tenant } from '@/lib/sqldb';
import { newId as makeId } from '@/lib/id';
import { purgeMobileAccess } from '@/lib/mobile/purge';
import type { Prisma } from '@prisma/client';

// Öğrenci servis katmanı — DB + iş kuralı + validasyon. Route yalnız withAuth+parseBody+
// audit+response. İş-kuralı ihlalinde HttpError fırlatır (withAuth çevirir).

// SQL satırı (class include) → mevcut sözleşme şekli (id/cls = legacyId).
type StudentWithClass = Prisma.StudentGetPayload<{ include: { class: true } }>;

export interface StudentOut {
  id: string; name: string; username: string; cls: string; group: string;
  phone: string; parentPhone: string; parentName: string; birthDate: string;
  diplomaNotu: number | ''; obp: number | null;
  parentRelation: string; parentNote: string;
  parent2Name: string; parent2Phone: string; parent2Relation: string;
  tcNo: string; parentTcNo: string; parentAddress: string; // muhasebe belgeleri (senet/makbuz)
  exemptFrom: string; exemptUntil: string; exemptNote: string; // yoklama muafiyeti aralığı
}

export const studentOut = (s: StudentWithClass): StudentOut => ({
  id: s.legacyId, name: s.name, username: s.username, cls: s.class?.legacyId || '', group: s.group,
  phone: s.phone || '', parentPhone: s.parentPhone || '', parentName: s.parentName || '', birthDate: s.birthDate || '',
  diplomaNotu: s.diplomaNotu ?? '', obp: s.diplomaNotu ? Math.round(s.diplomaNotu * 5 * 100) / 100 : null,
  parentRelation: s.parentRelation || '', parentNote: s.parentNote || '',
  parent2Name: s.parent2Name || '', parent2Phone: s.parent2Phone || '', parent2Relation: s.parent2Relation || '',
  tcNo: s.tcNo || '', parentTcNo: s.parentTcNo || '', parentAddress: s.parentAddress || '',
  exemptFrom: s.exemptFrom || '', exemptUntil: s.exemptUntil || '', exemptNote: s.exemptNote || '',
});

// Diploma notu string'ini doğrula → number (50-100) veya '' döndür; geçersizse null.
// group !== 'mezun' ise her zaman '' (OBP yalnız mezunda tutulur).
function normDiplomaNotu(raw: unknown, group: string): number | '' | null {
  if (group !== 'mezun') return '';
  const s = String(raw ?? '').trim();
  if (s === '') return '';
  const v = parseFloat(s.replace(',', '.'));
  if (isNaN(v) || v < 50 || v > 100) return null; // geçersiz
  return Math.round(v * 100) / 100;
}

// Servis giriş tipleri (route'taki Zod şemasından türetilen düz veri).
export interface StudentCreateInput {
  name: string; password?: string; cls: string;
  phone?: string; parentPhone?: string; parentName?: string; birthDate?: string; diplomaNotu?: string;
  parentRelation?: string; parentNote?: string;
  parent2Name?: string; parent2Phone?: string; parent2Relation?: string;
  tcNo?: string; parentTcNo?: string; parentAddress?: string; // muhasebe belgeleri (opsiyonel)
}
export interface StudentUpdateInput extends StudentCreateInput { id: string; }

export interface StudentCreateResult { id: string; name: string; username: string; cls: string; group: string; }

export async function listStudents(): Promise<StudentOut[]> {
  const rows = await tdb().student.findMany({ include: { class: true } });
  return rows.map(studentOut);
}

// Yeni öğrenci kaydı. İş kuralları: sınıf→grup, mezunda diploma notu 50-100, telefon
// (öğrenci opsiyonel/veli zorunlu) Türk cep, isim benzersiz. İhlalde HttpError.
export async function createStudent(input: StudentCreateInput): Promise<StudentCreateResult> {
  const { name, password, cls, phone, parentPhone, parentName, birthDate, diplomaNotu,
          parentRelation, parentNote, parent2Name, parent2Phone, parent2Relation,
          tcNo, parentTcNo, parentAddress } = input;

  // İsim soyisim kullanıcı adı olarak kullanılır
  const username = name;

  // Grup, şube kaydının köprü alanından gelir (registry boşsa constants'tan türetilir).
  const group = (await getClass(cls))?.group;
  if (!group) throw new HttpError(400, 'Geçersiz sınıf');

  // Diploma notu (yalnız mezun): geçerli değilse hata; OBP = ×5 türetilir.
  const diploma = normDiplomaNotu(diplomaNotu, group);
  if (diploma === null) throw new HttpError(400, 'Diploma notu 50 ile 100 arasında olmalı');

  // Telefon doğrulama (opsiyonel ama verilmişse geçerli Türk cep olmalı)
  let normPhone: string | null = '';
  if (phone) {
    normPhone = normalizeTurkishMobile(phone);
    if (!normPhone) throw new HttpError(400, 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67');
  }

  // Veli bilgileri ZORUNLU (öğrenci-veli bağı + veli paneli için)
  if (!(parentName || '').trim()) throw new HttpError(400, 'Veli adı soyadı zorunludur');
  if (!parentPhone) throw new HttpError(400, 'Veli telefonu zorunludur');
  const normParentPhone = normalizeTurkishMobile(parentPhone);
  if (!normParentPhone) throw new HttpError(400, 'Veli telefonu geçersiz. Örnek: 0532 123 45 67');

  // 2. iletişim telefonu (opsiyonel ama verilmişse geçerli olmalı)
  let normParent2Phone: string | null = '';
  if (parent2Phone) {
    normParent2Phone = normalizeTurkishMobile(parent2Phone);
    if (!normParent2Phone) throw new HttpError(400, '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67');
  }

  // Şifre kuralı (lib/auth.initialPassword): girilmişse o; boşsa öğrenci telefonu;
  // telefon da yoksa sabit "12345678". İlk girişte zorunlu değişim (mustChangePassword).
  const initPassword = initialPassword(password, normPhone);

  const dup = await tdb().student.findFirst({ where: { username } });
  if (dup) throw new HttpError(400, 'Bu isimde bir öğrenci zaten kayıtlı');
  const clsRow = await tdb().class.findFirst({ where: { legacyId: cls } });
  const hash = await bcrypt.hash(initPassword, 10);
  const legacyId = makeId();
  await tdb().student.create({ data: withScope({
    legacyId, name, username, passwordHash: hash, classId: clsRow?.id || null, group,
    phone: normPhone, parentPhone: normParentPhone, parentName: (parentName || '').trim(),
    parentRelation: (parentRelation || '').trim(), parentNote: (parentNote || '').trim(),
    parent2Name: (parent2Name || '').trim(), parent2Phone: normParent2Phone, parent2Relation: (parent2Relation || '').trim(),
    tcNo: (tcNo || '').trim() || null, parentTcNo: (parentTcNo || '').trim() || null, parentAddress: (parentAddress || '').trim() || null,
    birthDate: birthDate || '', diplomaNotu: (diploma === '' ? null : diploma), mustChangePassword: true,
  }) });
  return { id: legacyId, name, username, cls, group };
}

// Öğrenci güncelle. Yoksa HttpError(404). Verilmeyen alanlar mevcut değeri korur.
export async function updateStudent(input: StudentUpdateInput): Promise<void> {
  const { id, name, password, cls, phone, parentPhone, parentName, birthDate, diplomaNotu,
          parentRelation, parentNote, parent2Name, parent2Phone, parent2Relation,
          tcNo, parentTcNo, parentAddress } = input;

  const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
  if (!s) throw new HttpError(404, 'Öğrenci bulunamadı');
  const group = (await getClass(cls))?.group || s.group;
  let diploma: number | '' | null = s.diplomaNotu ?? '';
  if (diplomaNotu !== undefined) {
    diploma = normDiplomaNotu(diplomaNotu, group);
    if (diploma === null) throw new HttpError(400, 'Diploma notu 50 ile 100 arasında olmalı');
  } else if (group !== 'mezun') diploma = '';
  const clsRow = await tdb().class.findFirst({ where: { legacyId: cls } });
  const data: { name: string; username: string; classId: string | null; group: string; diplomaNotu: number | null; birthDate: string; parentName: string; parentRelation: string; parentNote: string; parent2Name: string; parent2Relation: string; phone?: string; parentPhone?: string; parent2Phone?: string; passwordHash?: string; tcNo?: string | null; parentTcNo?: string | null; parentAddress?: string | null } = {
    name, username: name, classId: clsRow?.id ?? s.classId, group, diplomaNotu: (diploma === '' ? null : diploma),
    birthDate: birthDate !== undefined ? birthDate : (s.birthDate || ''),
    parentName: parentName !== undefined ? (parentName || '').trim() : (s.parentName || ''),
    parentRelation: parentRelation !== undefined ? (parentRelation || '').trim() : (s.parentRelation || ''),
    parentNote: parentNote !== undefined ? (parentNote || '').trim() : (s.parentNote || ''),
    parent2Name: parent2Name !== undefined ? (parent2Name || '').trim() : (s.parent2Name || ''),
    parent2Relation: parent2Relation !== undefined ? (parent2Relation || '').trim() : (s.parent2Relation || ''),
  };
  if (tcNo !== undefined) data.tcNo = (tcNo || '').trim() || null;
  if (parentTcNo !== undefined) data.parentTcNo = (parentTcNo || '').trim() || null;
  if (parentAddress !== undefined) data.parentAddress = (parentAddress || '').trim() || null;
  if (phone !== undefined) {
    if (phone) { const n = normalizeTurkishMobile(phone); if (!n) throw new HttpError(400, 'Öğrenci telefonu geçersiz. Örnek: 0532 123 45 67'); data.phone = n; }
    else data.phone = '';
  }
  if (parentPhone !== undefined) {
    if (parentPhone) { const n = normalizeTurkishMobile(parentPhone); if (!n) throw new HttpError(400, 'Veli telefonu geçersiz. Örnek: 0532 123 45 67'); data.parentPhone = n; }
    else data.parentPhone = '';
  }
  if (parent2Phone !== undefined) {
    if (parent2Phone) { const n = normalizeTurkishMobile(parent2Phone); if (!n) throw new HttpError(400, '2. iletişim telefonu geçersiz. Örnek: 0532 123 45 67'); data.parent2Phone = n; }
    else data.parent2Phone = '';
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  await tdb().student.update({ where: { id: s.id }, data });
}

// Yoklama muafiyeti aralığını kur ya da temizle. İki uç birlikte dolu (from <= until)
// ya da birlikte boş (muafiyet kaldırılır) olmalı — tek uçlu aralık anlamsız → 400.
export async function setStudentExemption(
  id: string, exemptFrom?: string, exemptUntil?: string, exemptNote?: string,
): Promise<{ name: string; cleared: boolean; cleanedEntries: number }> {
  const s = await tdb().student.findFirst({ where: { legacyId: id } });
  if (!s) throw new HttpError(404, 'Öğrenci bulunamadı');
  const from = (exemptFrom || '').trim();
  const until = (exemptUntil || '').trim();
  if (!from && !until) {
    await tdb().student.update({ where: { id: s.id }, data: { exemptFrom: null, exemptUntil: null, exemptNote: null } });
    return { name: s.name, cleared: true, cleanedEntries: 0 };
  }
  if (!from || !until) throw new HttpError(400, 'Muafiyet için başlangıç ve bitiş tarihlerinin ikisi de gerekli');
  const RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!RE.test(from) || !RE.test(until)) throw new HttpError(400, 'Tarih biçimi YYYY-AA-GG olmalı');
  if (from > until) throw new HttpError(400, 'Başlangıç tarihi bitiş tarihinden sonra olamaz');
  // Geriye dönük uzlaştırma: aralıktaki MEVCUT yoklama kayıtlarından öğrencinin
  // girişleri düşülür (rapor sonradan gelir — daha önce yazılmış 'yok/gec' özette ve
  // öğrenci geçmişinde kalırdı). Bilinçli tek yön: muafiyet sonradan KALDIRILSA da
  // silinen girişler geri yazılMAZ; o günlerin yoklaması gerekirse yeniden alınır.
  // Gönderilmiş devamsızlık push'u geri çağrılamaz (best-effort bildirim).
  //
  // Silme ATOMİK jsonb `-` operatörüyle: read-modify-write olsaydı eşzamanlı öğretmen
  // kaydı diğer öğrencilerin yeni durumlarını ezebilirdi. Raw SQL tenant-scope
  // enjeksiyonundan geçmez → orgSlug/branch WHERE'de AÇIKÇA verilir.
  const db = tdb();
  const { orgSlug, branch } = tenant();
  const [, cleanedEntries] = await db.$transaction([
    db.student.update({
      where: { id: s.id },
      data: { exemptFrom: from, exemptUntil: until, exemptNote: (exemptNote || '').trim() || null },
    }),
    db.$executeRaw`UPDATE "Attendance" SET "records" = "records" - ${id}
      WHERE "orgSlug" = ${orgSlug} AND "branch" = ${branch}
        AND "date" >= ${from} AND "date" <= ${until} AND "records" ? ${id}`,
  ]);
  return { name: s.name, cleared: false, cleanedEntries };
}

// Tekil sil. Döner: audit için { name, cls } (yoksa id fallback + boş cls).
export async function deleteStudent(id: string): Promise<{ name: string; cls: string }> {
  const s = await tdb().student.findFirst({ where: { legacyId: id }, include: { class: true } });
  if (s) {
    // Mobil erişim iptali SİLMEDEN ÖNCE ve fail-loud (F1) — bkz lib/mobile/purge.ts.
    await purgeMobileAccess('student', [id], 'hesap silindi');
    await tdb().student.delete({ where: { id: s.id } }); // cascade: finance/behavior
  }
  return { name: s?.name || id, cls: s?.class?.legacyId || '' };
}

// Toplu sil. Döner: silinen sayısı (girdi id sayısı — mevcut davranış).
export async function bulkDeleteStudents(ids: string[]): Promise<number> {
  await purgeMobileAccess('student', ids, 'hesap silindi'); // F1 — silmeden önce
  await tdb().student.deleteMany({ where: { legacyId: { in: ids } } }); // cascade: finance/behavior
  return ids.length;
}
