import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';

process.env.JWT_SECRET = 'test-web-secret';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => ({ get: () => null }),
}));

const { signToken, verifyToken } = await import('./auth');

describe('verifyToken aud reddi (defense-in-depth)', () => {
  it('kendi imzaladığı (aud’suz) web token’ını doğrular', async () => {
    const t = await signToken({ role: 'director', id: 'director' });
    expect((await verifyToken(t))?.role).toBe('director');
  });

  it('aud taşıyan token’ı REDDEDER (mobil token web cookie’sine geçemez)', async () => {
    const t = await new SignJWT({ role: 'director', sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('okulin-mobile')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('test-web-secret'));
    expect(await verifyToken(t)).toBeNull();
  });
});

describe('signToken expSec', () => {
  it('expSec verilince exp o kadar (kısa cookie için)', async () => {
    const t = await signToken({ role: 'director', id: 'director' }, 3600);
    const s = await verifyToken(t);
    expect(s!.exp! - s!.iat!).toBe(3600);
  });
});
