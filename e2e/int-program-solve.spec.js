/**
 * ENTEGRASYON — Program çözücü proxy'si (/api/program-solve)
 * Müdür isteği canlı Cloud Run CP-SAT servisine iletilir (shared-secret ile);
 * öğretmen/öğrenci 403, bozuk gövde 400, oturumsuz 401 alır.
 *
 * Payload sentetiktir (kiracı verisine dokunmaz): 1 sınıf, 1 öğretmen,
 * 2 saatlik tek ders → çözücü kesin yerleştirir (assigned dolu döner).
 */
const { test, expect } = require('@playwright/test');
const { BASE, JSON_HEADERS, DIR_STATE, TEA_STATE, STU_STATE } = require('./helpers');

// Minimal, kesin çözülebilir model: Pazartesi 4 slotluk pencere, 2 saat Matematik.
const SOLVE_PAYLOAD = {
  classes: ['901'],
  teachers: [{ id: 't1', name: 'E2E Çözücü Öğretmeni', branches: ['Matematik'], allowedGroups: ['lise'], offDays: [] }],
  load: { 'Lise Ortak_9': { Matematik: 2 } },
  pieces: {},
  maxWeekly: 20,
  windows: { 901: { 0: [0, 1, 2, 3] } },
  colKey: { 901: 'Lise Ortak_9' },
  group: { 901: 'lise' },
  teacherSlots: { t1: [[0, 0], [0, 1], [0, 2], [0, 3]] },
  presets: [],
};

test.describe('Program çözücü (CP-SAT proxy)', () => {
  test('müdür: 200 + assigned dolu (canlı Cloud Run)', async ({ playwright }) => {
    test.setTimeout(120_000); // çözücü soğuk başlangıcı payı
    const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
    try {
      const res = await dirReq.post(`${BASE}/api/program-solve`, {
        headers: JSON_HEADERS,
        data: SOLVE_PAYLOAD,
      });
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.assigned)).toBe(true);
      expect(body.assigned.length).toBe(2); // 2 saatlik ders → 2 satır
      expect(body.unplaced || []).toHaveLength(0);
      for (const a of body.assigned) {
        expect(a.cls).toBe('901');
        expect(a.course).toBe('Matematik');
        expect(a.teacherId).toBe('t1');
      }
      expect(body.tLoad?.t1).toBe(2);
    } finally {
      await dirReq.dispose();
    }
  });

  test('öğretmen: 403 (yalnız yönetim çözer)', async ({ playwright }) => {
    const teaReq = await playwright.request.newContext({ storageState: TEA_STATE });
    try {
      const res = await teaReq.post(`${BASE}/api/program-solve`, {
        headers: JSON_HEADERS,
        data: SOLVE_PAYLOAD,
      });
      expect(res.status()).toBe(403);
    } finally {
      await teaReq.dispose();
    }
  });

  test('öğrenci: 403', async ({ playwright }) => {
    const stuReq = await playwright.request.newContext({ storageState: STU_STATE });
    try {
      const res = await stuReq.post(`${BASE}/api/program-solve`, {
        headers: JSON_HEADERS,
        data: SOLVE_PAYLOAD,
      });
      expect(res.status()).toBe(403);
    } finally {
      await stuReq.dispose();
    }
  });

  test('bozuk gövde: geçersiz JSON ve obje olmayan JSON → 400', async ({ playwright }) => {
    const dirReq = await playwright.request.newContext({ storageState: DIR_STATE });
    try {
      // 1) Sözdizimi bozuk gövde — HAM baytlar Buffer ile gönderilir (string data
      //    verilirse Playwright onu JSON'a sarar ve geçerli bir JSON string'i oluşur).
      const bozuk = await dirReq.post(`${BASE}/api/program-solve`, {
        headers: JSON_HEADERS,
        data: Buffer.from('{"bozuk json'),
      });
      expect(bozuk.status(), await bozuk.text()).toBe(400);
      expect((await bozuk.json()).error).toBeTruthy();

      // 2) Geçerli JSON ama obje değil (string) — çözücüye sızmadan 400 kesilmeli
      const sekil = await dirReq.post(`${BASE}/api/program-solve`, {
        headers: JSON_HEADERS,
        data: 'bu bir obje degil', // Playwright JSON'a sarar → "bu bir obje degil"
      });
      expect(sekil.status(), await sekil.text()).toBe(400);
    } finally {
      await dirReq.dispose();
    }
  });

  test('oturumsuz: 401', async ({ playwright }) => {
    const anon = await playwright.request.newContext();
    try {
      const res = await anon.post(`${BASE}/api/program-solve`, {
        headers: JSON_HEADERS,
        data: SOLVE_PAYLOAD,
      });
      expect(res.status()).toBe(401);
    } finally {
      await anon.dispose();
    }
  });
});
