/**
 * ENTEGRASYON — Etüt slot iş kuralları (/api/slots POST)
 * Kurallar: dolu slota ikinci öğrenci reddi · aynı dersten ikinci etüt reddi ·
 * mezun hafta içi 9. slot yasağı · geçmiş slot koruması · sahiplik/yetki · şema.
 *
 * Dinamik kurgu (sabit fikstür yok):
 * - Öğretmen = oturum sahibi (whoami; kural 2-3 müdürde bypass olduğundan
 *   rezervasyonlar ÖĞRETMEN rolüyle yapılır — kendi slotu şartı da böyle sağlanır).
 * - Sınıf = registry'den keşfedilen, öğrencisi olmayan mezun şubesi; iki test
 *   öğrencisi bu şubeye teste özel oluşturulur ve sonda silinir.
 * - Hafta = mevcut + 3: haftalık cron +1'i, müdür paneli en çok +2'yi init
 *   edebilir → +3'te hiçbir satır yoktur; 'kapalı slot' yan yoluna takılmadan
 *   kurallar sınanır (ui-yoklama'nın kullandığı +1 ile de çakışmaz).
 * - Geçmiş testi 2024-W20 gibi hiç materyalize edilmemiş haftayı kullanır →
 *   'disabled satır' yan yoluna takılmadan doğrudan geçmiş korumasına düşer.
 * Teardown: oluşan SlotBooking satırları DB'den silinir (DATABASE_URL varsa;
 * yoksa API ile rezervasyon iptali), öğrenciler silinir.
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, DIR_STATE, TEA_STATE, getWeekKey, shiftWeek, whoami } = require('./helpers');

const ORG = new URL(BASE).hostname.split('.')[0];
const WEEK = shiftWeek(getWeekKey(), 3); // gelecekte; cron(+1) ve panel(+2) init alanının dışında
const PAST_WEEK = '2024-W20';            // hiç satır üretilmemiş, kesin geçmiş hafta

test.describe('Etüt slot kuralları', () => {
  test.describe.configure({ mode: 'serial' });

  let dirReq, teaReq, prisma = null;
  let TEA, BRANCH, CLS;
  let s1 = null, s2 = null; // test öğrencileri (legacyId)

  function book(reqCtx, body) {
    return reqCtx.post(`${BASE}/api/slots`, { headers: JSON_HEADERS, data: body });
  }

  test.beforeAll(async ({ playwright }) => {
    dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
    teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
    TEA = await whoami(teaReq);
    expect(TEA.role).toBe('teacher');
    expect((TEA.allowedGroups || []).includes('mezun'),
      `oturum öğretmeni (${TEA.name}) mezun grubuna kapalı — slot kural testleri mezun kurgusu ister`).toBe(true);

    // Sınıf keşfi: öğrencisi olmayan bir MEZUN şubesi (kurallar mezun kurgusunda test edilir)
    const [clsData, students] = await Promise.all([
      (await dirReq.get(`${BASE}/api/classes`)).json(),
      (await dirReq.get(`${BASE}/api/students`)).json(),
    ]);
    const usedCls = new Set((students || []).map((s) => s.cls));
    const mezunCls = (clsData.classes || []).find((c) => c.group === 'mezun' && !usedCls.has(c.id));
    expect(mezunCls, 'öğrencisiz mezun şubesi bulunamadı').toBeTruthy();
    CLS = mezunCls.id;

    // Branş: öğretmenin verebildiği ∩ şubenin ders listesi (rezervasyonda kullanılacak ders)
    BRANCH = (TEA.branches || []).find((b) => (mezunCls.dersler || []).includes(b));
    expect(BRANCH, `öğretmen branşları (${TEA.branches}) ile ${CLS} dersleri kesişmiyor`).toBeTruthy();

    // İki test öğrencisi
    for (const [key, name] of [['s1', 'E2E Slot Mezun A'], ['s2', 'E2E Slot Mezun B']]) {
      const res = await dirReq.post(`${BASE}/api/students`, {
        headers: JSON_HEADERS,
        data: {
          name: `${name} ${Date.now().toString(36)}`, cls: CLS, password: 'e2e-gecici-sifre',
          parentName: 'E2E Slot Velisi', parentPhone: key === 's1' ? '0532 999 00 03' : '0532 999 00 04',
        },
      });
      expect(res.status(), await res.text()).toBe(200);
      if (key === 's1') s1 = (await res.json()).id; else s2 = (await res.json()).id;
    }

    // Satır temizliği için doğrudan DB erişimi (varsa)
    if (process.env.DATABASE_URL) {
      const { PrismaClient } = require('@prisma/client');
      prisma = new PrismaClient();
    }
  });

  test.afterAll(async () => {
    // TEMİZLİK: rezervasyon satırları → öğrenciler
    if (prisma) {
      await prisma.slotBooking.deleteMany({
        where: { orgSlug: ORG, branch: 'main', weekKey: WEEK, studentId: { in: [s1, s2].filter(Boolean) } },
      }).catch(() => {});
      await prisma.$disconnect().catch(() => {});
    } else if (dirReq && s1) {
      // DB erişimi yoksa: rezervasyonu API ile boşalt (satır pasif kalır)
      await dirReq.delete(`${BASE}/api/slots`, {
        headers: JSON_HEADERS,
        data: { teacherId: TEA.id, day: 0, slotId: 'd0s1', weekKey: WEEK },
      }).catch(() => {});
    }
    if (dirReq && (s1 || s2)) {
      await dirReq.delete(`${BASE}/api/students`, {
        headers: JSON_HEADERS,
        data: { ids: [s1, s2].filter(Boolean) },
      }).catch(() => {});
      await dirReq.dispose();
    }
    if (teaReq) await teaReq.dispose();
  });

  test('mutlu yol: öğretmen kendi slotuna öğrenci yazar → 200', async () => {
    const res = await book(teaReq, { teacherId: TEA.id, day: 0, slotId: 'd0s1', studentId: s1, weekKey: WEEK, branch: BRANCH });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.slot.booked).toBe(true);
    expect(body.slot.studentId).toBe(s1);
    expect(body.slot.branch).toBe(BRANCH);
  });

  test('dolu slota ikinci öğrenci → reddedilir', async () => {
    const res = await book(dirReq, { teacherId: TEA.id, day: 0, slotId: 'd0s1', studentId: s2, weekKey: WEEK, branch: BRANCH });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/zaten dolu/);
  });

  test('aynı dersten ikinci etüt → reddedilir', async () => {
    const res = await book(teaReq, { teacherId: TEA.id, day: 0, slotId: 'd0s2', studentId: s1, weekKey: WEEK, branch: BRANCH });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(new RegExp(`${BRANCH} dersinden zaten etüt almış`));
  });

  test('mezun hafta içi 9. slot → reddedilir', async () => {
    const res = await book(teaReq, { teacherId: TEA.id, day: 0, slotId: 'd0s9', studentId: s2, weekKey: WEEK, branch: BRANCH });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/Mezun öğrenciler hafta içi 9\. slottaki etüde kayıt olamaz/);
  });

  test('geçmiş slota rezervasyon → reddedilir', async () => {
    const res = await book(teaReq, { teacherId: TEA.id, day: 0, slotId: 'd0s1', studentId: s2, weekKey: PAST_WEEK, branch: BRANCH });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/Geçmiş bir saat dilimine rezervasyon yapılamaz/);
  });

  test('öğretmen başka öğretmenin slotuna yazamaz → 403', async () => {
    // Uzak gelecekteki hafta: hedef öğretmenin satırları hiç üretilmemiştir →
    // kapalı-slot yan yoluna takılmadan sahiplik kontrolüne düşer.
    const teachers = await (await dirReq.get(`${BASE}/api/teachers`)).json();
    const other = teachers.find((t) => t.id !== TEA.id && (t.allowedGroups || []).length > 0);
    expect(other, 'ikinci bir öğretmen bulunamadı').toBeTruthy();
    const res = await book(teaReq, { teacherId: other.id, day: 0, slotId: 'd0s1', studentId: s2, weekKey: shiftWeek(getWeekKey(), 40), branch: BRANCH });
    expect(res.status()).toBe(403);
    expect((await res.json()).error).toMatch(/kendi slotlarınıza/);
  });

  test('oturumsuz istek → 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    const res = await book(anon, { teacherId: TEA.id, day: 0, slotId: 'd0s1', studentId: s1, weekKey: WEEK, branch: BRANCH });
    expect(res.status()).toBe(401);
    await anon.dispose();
  });

  test('geçersiz girdi (eksik slotId / gün aralığı dışı) → 400', async () => {
    const eksik = await book(teaReq, { teacherId: TEA.id, day: 0, studentId: s1, weekKey: WEEK });
    expect(eksik.status()).toBe(400);
    const gun = await book(teaReq, { teacherId: TEA.id, day: 9, slotId: 'd0s1', studentId: s1, weekKey: WEEK });
    expect(gun.status()).toBe(400);
  });
});
