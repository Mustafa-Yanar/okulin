/**
 * ENTEGRASYON — login rate-limit mühürleri (canlı testkurs)
 * lib/ratelimit.ts "başarıda sıfırla" davranışının iki yönlü kanıtı:
 *   1) BİRİKİM: başarısızlıklar birikir → 6. deneme 429 (limit 5/15dk yerinde duruyor).
 *   2) SIFIRLAMA: başarılı oturum kurulumu kovayı sıfırlar → yanlış,yanlış,doğru,
 *      yanlış,yanlış,doğru dizisinde 6. istek reset ÇALIŞMIYORSA 429 (sayaç 6>5),
 *      ÇALIŞIYORSA 200 — ayırt edici kanıt.
 *
 * Bütçe düzeni (auth.setup.js invariant'ı): iki test de KENDİ kullanıcı-adı kovasını
 * kullanır — paylaşılan testkurs_mudur kovasına dokunulmaz, paralel worker'lar sonucu
 * etkileyemez. Kovalar TTL'li (2×pencere) → kendilerini temizler.
 * Mobil login ucu kullanılır: web ile AYNI loginRatelimit kovası, Origin gerektirmez.
 */
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { BASE, DIR_STATE } = require('./helpers');

test.describe('Login rate-limit (başarıda sıfırla)', () => {
  test.describe.configure({ mode: 'serial' });

  test('birikim: 5 başarısız → 6. deneme 429 (uydurma kullanıcı, kendi kovası)', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    try {
      const user = 'rl-probe-' + crypto.randomUUID().slice(0, 12);
      const attempt = () => api.post(`${BASE}/api/mobile/v1/auth/login`, {
        data: { username: user, password: 'yanlis-sifre', role: 'student' },
      });
      for (let i = 1; i <= 5; i++) {
        expect((await attempt()).status(), `deneme ${i} → 401`).toBe(401);
      }
      const sixth = await attempt();
      expect(sixth.status(), await sixth.text()).toBe(429);
    } finally {
      await api.dispose();
    }
  });

  test('sıfırlama: y,y,D,y,y,D → 6. istek 200 (geçici rehber, reset kanıtı)', async ({ playwright }) => {
    const api = await playwright.request.newContext();
    const web = await playwright.request.newContext({
      storageState: DIR_STATE,
      extraHTTPHeaders: { Origin: BASE },
    });
    let couId = null;
    try {
      // Geçici rehber (director web API; username = name — counselors route kuralı)
      const name = 'E2E RL Muhur ' + Date.now();
      const pass = 'e2e-rl-' + crypto.randomUUID().slice(0, 8);
      const c = await web.post(`${BASE}/api/counselors`, { data: { name, password: pass } });
      expect(c.status(), await c.text()).toBe(200);
      couId = (await c.json()).id;

      const attempt = (password) => api.post(`${BASE}/api/mobile/v1/auth/login`, {
        data: { username: name, password, role: 'management' },
      });

      expect((await attempt('kesin-yanlis')).status(), '1. yanlış → 401').toBe(401);
      expect((await attempt('kesin-yanlis')).status(), '2. yanlış → 401').toBe(401);
      const ok1 = await attempt(pass);
      expect(ok1.status(), await ok1.text()).toBe(200); // 3. istek: başarı → kova sıfırlanır
      expect((await attempt('kesin-yanlis')).status(), '4. yanlış → 401').toBe(401);
      expect((await attempt('kesin-yanlis')).status(), '5. yanlış → 401').toBe(401);
      const ok2 = await attempt(pass);
      expect(ok2.status(), await ok2.text()).toBe(200); // 6. istek: reset kırıksa burada 429 olurdu
    } finally {
      if (couId) await web.delete(`${BASE}/api/counselors`, { data: { id: couId } }).catch(() => {});
      await api.dispose();
      await web.dispose();
    }
  });
});
