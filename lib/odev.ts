import { tdb, withScope } from '@/lib/sqldb';
import { getClass } from '@/lib/classes';
import { newId as genId } from '@/lib/id';
import { HttpError } from '@/lib/errors';

// Ödev servis katmanı — DB + iş kuralı (roster çözümü, teslim map'i, sınıf doğrulama).
// Route yalnız yetki (session-bazlı rol dallanması) + push + audit + response. İhlalde HttpError.

// Odev.data Json içindeki tek teslim kaydı.
interface Submission {
  studentId: string;
  status: string;
  note: string;
  score: string;
  feedback: string;
  submittedAt: string;
  checkedAt: string;
}

// Odev.data Json şekli (submissions dahil kayıt).
export interface OdevData {
  id: string;
  title: string;
  desc?: string;
  branch?: string;
  dueDate?: string;
  classes: string[];
  createdBy?: string;
  createdByName?: string;
  createdByRole?: string;
  createdAt?: string;
  submissions?: Record<string, Submission>;
}

export interface RosterStudent { id: string; name: string; cls: string; }

// Tüm öğrencileri tek seferde yükle (roster çözümü için).
async function loadStudents(): Promise<RosterStudent[]> {
  const rows = await tdb().student.findMany({ include: { class: { select: { legacyId: true } } } });
  return rows.map(s => ({ id: s.legacyId, name: s.name, cls: s.class?.legacyId || '' }));
}

// Teslimler odev kaydının data.submissions map'inde durur (ayrı anahtar yok).
// odevView = data'dan submissions'ı çıkarır (dış sözleşme şekliyle birebir).
const odevView = (rec: OdevData) => { const { submissions, ...rest } = rec; return rest; };

// Ödevin hedef sınıflarındaki öğrenciler.
function rosterFor(students: RosterStudent[], classes: string[] | undefined) {
  const set = new Set(classes || []);
  return students.filter(s => set.has(s.cls));
}

// Detay (yönetici/öğretmen): ödev + roster'daki her öğrencinin teslim durumu. Yoksa 404.
export async function getOdevDetail(id: string) {
  const row = await tdb().odev.findFirst({ where: { legacyId: id } });
  if (!row) throw new HttpError(404, 'Ödev bulunamadı');
  const rec = row.data as unknown as OdevData;
  const students = await loadStudents();
  const roster = rosterFor(students, rec.classes);
  const subsMap = rec.submissions || {};
  const submissions = roster.map(s => ({ studentId: s.id, name: s.name, cls: s.cls, sub: subsMap[s.id] || null }));
  return { odev: odevView(rec), submissions };
}

// Liste (yönetici/öğretmen): tüm ödevler + ilerleme sayıları (en yeni önce).
export async function listOdevForManager() {
  const rows = await tdb().odev.findMany();
  if (rows.length === 0) return [];
  const students = await loadStudents();
  const list = rows.map(r => {
    const rec = r.data as unknown as OdevData;
    return { ...odevView(rec), submittedCount: Object.keys(rec.submissions || {}).length, rosterCount: rosterFor(students, rec.classes).length };
  });
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return list;
}

// Öğrenci: kendi sınıfına atanan ödevler + kendi teslim durumu (en yeni önce).
export async function listOdevForStudent(cls: string, studentId: string) {
  const rows = await tdb().odev.findMany();
  const recs = rows.map(r => r.data as unknown as OdevData).filter(r => Array.isArray(r.classes) && r.classes.includes(cls));
  const list = recs.map(r => ({
    id: r.id, title: r.title, desc: r.desc || '', branch: r.branch || '',
    dueDate: r.dueDate || '', createdByName: r.createdByName || '', createdAt: r.createdAt,
    sub: (r.submissions || {})[studentId] || null,
  }));
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return list;
}

export interface ParentChild { id?: string; name?: string; cls?: string; }

// Veli: çocuklarının sınıflarına atanan ödevler + her çocuğun durumu (salt-okunur, en yeni önce).
export async function listOdevForParent(children: ParentChild[]) {
  if (children.length === 0) return [];
  const childClasses = new Set(children.map(c => c.cls).filter(Boolean));
  const rows = await tdb().odev.findMany();
  const recs = rows.map(r => r.data as unknown as OdevData).filter(r => Array.isArray(r.classes) && r.classes.some(c => childClasses.has(c)));
  const list = recs.map(r => ({
    id: r.id, title: r.title, desc: r.desc || '', branch: r.branch || '',
    dueDate: r.dueDate || '', createdByName: r.createdByName || '', createdAt: r.createdAt,
    children: children.filter(ch => r.classes.includes(ch.cls || '')).map(ch => ({
      childId: ch.id, childName: ch.name, cls: ch.cls, sub: (r.submissions || {})[ch.id || ''] || null,
    })),
  }));
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return list;
}

export interface CreateOdevInput {
  title: string; desc?: string; branch?: string; dueDate?: string; classes: string[];
  createdBy: string | undefined; createdByName: string; createdByRole: string;
}

// Ödev oluştur. Sınıflar registry'den doğrulanır; geçerli yoksa 400. Döner: push+audit için
// { id, validCount, roster } (roster = hedef öğrenciler).
export async function createOdev(input: CreateOdevInput): Promise<{ id: string; validCount: number; roster: RosterStudent[] }> {
  const { title, desc, branch, dueDate, classes, createdBy, createdByName, createdByRole } = input;
  const valid: string[] = [];
  for (const c of classes) { if (await getClass(c)) valid.push(c); }
  if (valid.length === 0) throw new HttpError(400, 'Geçerli sınıf seçilmedi');

  const id = genId();
  const rec = {
    id, title, desc: desc || '', branch: branch || '',
    dueDate: dueDate || '', classes: valid,
    createdBy, createdByName: createdByName || '', createdByRole,
    createdAt: new Date().toISOString(),
  };
  await tdb().odev.create({ data: withScope({ legacyId: id, data: { ...rec, submissions: {} } }) });
  const students = await loadStudents();
  const roster = rosterFor(students, valid);
  return { id, validCount: valid.length, roster };
}

// Öğrenci teslim eder / geri alır. Ödev yoksa 404, sınıfına atanmamışsa 403,
// kontrol edilmiş teslim geri alınamaz → 400. Döner: yeni durum (null = geri alındı).
export async function submitOdev(input: { id: string; studentId: string; cls: string; note?: string; done?: boolean }): Promise<{ status: string | null }> {
  const { id, studentId, cls, note, done } = input;
  const row = await tdb().odev.findFirst({ where: { legacyId: id } });
  if (!row) throw new HttpError(404, 'Ödev bulunamadı');
  const rec = row.data as unknown as OdevData;
  if (!Array.isArray(rec.classes) || !rec.classes.includes(cls)) throw new HttpError(403, 'Bu ödev size atanmamış');

  const subs = { ...(rec.submissions || {}) };
  const cur = subs[studentId] || null;
  if (done === false) {
    if (cur?.status === 'kontrol') throw new HttpError(400, 'Öğretmen kontrol etti, geri alınamaz');
    delete subs[studentId];
    await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
    return { status: null };
  }
  const sub: Submission = {
    studentId,
    status: cur?.status === 'kontrol' ? 'kontrol' : 'teslim',
    note: note || '', score: cur?.score || '', feedback: cur?.feedback || '',
    submittedAt: cur?.submittedAt || new Date().toISOString(), checkedAt: cur?.checkedAt || '',
  };
  subs[studentId] = sub;
  await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
  return { status: sub.status };
}

// Öğretmen/müdür kontrol eder (puan + geri bildirim) veya kontrol işaretini kaldırır. Yoksa 404.
export async function checkOdev(input: { id: string; studentId: string; score?: string; feedback?: string; done?: boolean }): Promise<void> {
  const { id, studentId, score, feedback, done } = input;
  const row = await tdb().odev.findFirst({ where: { legacyId: id } });
  if (!row) throw new HttpError(404, 'Ödev bulunamadı');
  const rec = row.data as unknown as OdevData;
  const subs = { ...(rec.submissions || {}) };
  const cur = subs[studentId] || null;
  if (done === false) {
    if (!cur) return;
    if (cur.submittedAt) subs[studentId] = { ...cur, status: 'teslim', checkedAt: '' };
    else delete subs[studentId];
    await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
    return;
  }
  subs[studentId] = {
    studentId, status: 'kontrol',
    note: cur?.note || '',
    score: score !== undefined ? score : (cur?.score || ''),
    feedback: feedback !== undefined ? feedback : (cur?.feedback || ''),
    submittedAt: cur?.submittedAt || '', checkedAt: new Date().toISOString(),
  };
  await tdb().odev.update({ where: { id: row.id }, data: { data: { ...rec, submissions: subs } } });
}

// Ödev sil. Yoksa 404. Öğretmen yalnız kendi verdiğini siler (403). Döner: audit için { title }.
export async function deleteOdev(id: string, actor: { role: string; sessionId: string | undefined }): Promise<{ title: string }> {
  const row = await tdb().odev.findFirst({ where: { legacyId: id } });
  if (!row) throw new HttpError(404, 'Ödev bulunamadı');
  const rec = row.data as unknown as OdevData | null;
  if (actor.role === 'teacher' && rec?.createdBy !== actor.sessionId) {
    throw new HttpError(403, 'Yalnız kendi verdiğiniz ödevi silebilirsiniz');
  }
  await tdb().odev.delete({ where: { id: row.id } }); // teslimler data içinde, birlikte gider
  return { title: rec?.title || '' };
}
