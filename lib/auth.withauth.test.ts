import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthedHandler, Session } from './auth';

// withAuth, getSession (cookie→JWT) + canManage (config DB) zincirine dayanır.
// Testte GERÇEK signToken/getSession akışını kullanırız: cookie jar'ı mock'layıp
// içine gerçek bir imzalı token koyarız. Böylece wrapper'ın karar mantığını
// (401/403/geçiş + session enjeksiyonu) uçtan uca doğrularız. Yalnız config DB
// zinciri (prisma) mock'lanır — canManage'in counselor dalı için.
//
// Test sınırı: handler'lar Response yerine sahte değer döndürür, req/ctx düz obje —
// wrapper bunlara dokunmadan geçirir; cast'ler bu yüzden kaçınılmaz.

process.env.JWT_SECRET = 'test-secret-withauth';

let cookieValue: string | null = null; // testler bunu ayarlar → cookies().get() bunu döner
const mockGetOrgConfig = vi.fn();

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => (cookieValue ? { value: cookieValue } : undefined) }),
  headers: () => ({ get: () => null }), // org/branch kontrolü: token'da yoksa geçer
}));
vi.mock('./config', () => ({ getOrgConfig: (...a: unknown[]) => mockGetOrgConfig(...a) }));

const { withAuth, signToken } = await import('./auth');

// Verilen payload'la geçerli oturum cookie'si kur.
async function loginAs(payload: Session) {
  cookieValue = await signToken(payload);
}

type Wrapped = ReturnType<typeof withAuth>;
const run = (handler: Wrapped, req = {}, ctx = {}) =>
  handler(req as Parameters<Wrapped>[0], ctx as Parameters<Wrapped>[1]);

// Sahte handler'ı AuthedHandler olarak geçir (dönüş değeri wrapper'dan aynen çıkar).
const h = (fn: (...args: never[]) => unknown) => fn as unknown as AuthedHandler;

beforeEach(() => {
  cookieValue = null;
  mockGetOrgConfig.mockReset();
});

describe('withAuth', () => {
  it('oturum yoksa 401 döner, handler çağrılmaz', async () => {
    const inner = vi.fn();
    const res = await run(withAuth(h(inner)));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Giriş gerekli' });
    expect(inner).not.toHaveBeenCalled();
  });

  it("mode 'auth' (varsayılan): oturum varsa handler'a session enjekte edilir", async () => {
    await loginAs({ role: 'student', id: 's1' });
    const inner = vi.fn(async (req: unknown, ctx: unknown, s: Session) => ({ ok: true, s }));
    const res = (await run(withAuth(h(inner)), { url: 'x' }, { params: { a: 1 } })) as unknown as { s: Session };
    expect(inner).toHaveBeenCalledOnce();
    expect(inner.mock.calls[0][0]).toEqual({ url: 'x' });       // req geçer
    expect(inner.mock.calls[0][1]).toEqual({ params: { a: 1 } }); // ctx geçer
    expect(res.s.role).toBe('student');                          // session 3. argüman
    expect(res.s.id).toBe('s1');
  });

  it('mode dizi: rol listede değilse 403', async () => {
    await loginAs({ role: 'teacher' });
    const inner = vi.fn();
    const res = await run(withAuth(['director', 'accountant'], h(inner)));
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it('mode dizi: rol listedeyse geçer', async () => {
    await loginAs({ role: 'accountant' });
    const inner = vi.fn(async () => 'ok');
    const res = await run(withAuth(['director', 'accountant'], h(inner)));
    expect(res).toBe('ok');
  });

  it("mode 'manage': müdür daima geçer (config'e bakmadan)", async () => {
    await loginAs({ role: 'director' });
    const inner = vi.fn(async () => 'ok');
    const res = await run(withAuth('manage', h(inner)));
    expect(res).toBe('ok');
    expect(mockGetOrgConfig).not.toHaveBeenCalled();
  });

  it("mode 'manage': rehber readOnly ise 403", async () => {
    await loginAs({ role: 'counselor' });
    mockGetOrgConfig.mockResolvedValue({ counselor: { readOnly: true } });
    const inner = vi.fn();
    const res = await run(withAuth('manage', h(inner)));
    expect(res.status).toBe(403);
    expect(inner).not.toHaveBeenCalled();
  });

  it("mode 'manage': rehber readOnly değilse geçer", async () => {
    await loginAs({ role: 'counselor' });
    mockGetOrgConfig.mockResolvedValue({ counselor: { readOnly: false } });
    const inner = vi.fn(async () => 'ok');
    const res = await run(withAuth('manage', h(inner)));
    expect(res).toBe('ok');
  });

  it("mode 'manage': öğrenci asla geçemez (403)", async () => {
    await loginAs({ role: 'student' });
    const res = await run(withAuth('manage', h(vi.fn())));
    expect(res.status).toBe(403);
  });

  it('mode fn: özel predicate false → 403, true → geçer', async () => {
    await loginAs({ role: 'x', foo: 1 });
    const denyRes = await run(withAuth((s) => s.foo === 2, h(vi.fn())));
    expect(denyRes.status).toBe(403);

    await loginAs({ role: 'x', foo: 2 });
    const inner = vi.fn(async () => 'ok');
    const okRes = await run(withAuth((s) => s.foo === 2, h(inner)));
    expect(okRes).toBe('ok');
  });
});
