import { describe, it, expect, vi } from 'vitest';
import { SignJWT } from 'jose';

process.env.MOBILE_JWT_SECRET = 'test-mobile-secret';
process.env.JWT_SECRET = 'test-web-secret-different';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => undefined }),
  headers: () => ({ get: () => null }),
}));

const { signToken } = await import('../auth');
const { signMobileAccessToken, verifyMobileAccessToken, newRefreshToken, hashRefreshToken, ACCESS_TTL_SEC } =
  await import('./token');

describe('mobil access token', () => {
  const payload = { role: 'student', id: 'stu1', name: 'Ali', org: 'testkurs', branch: 'main' };

  it('imzala→doğrula gidiş-dönüşü claim’leri korur (sid dahil)', async () => {
    const t = await signMobileAccessToken(payload, 'ms_abc');
    const c = await verifyMobileAccessToken(t);
    expect(c?.role).toBe('student');
    expect(c?.sid).toBe('ms_abc');
    expect(c?.org).toBe('testkurs');
    expect(c?.exp! - c?.iat!).toBe(ACCESS_TTL_SEC);
  });

  it('web cookie token’ını REDDEDER (farklı secret + aud yok)', async () => {
    const webToken = await signToken({ role: 'director', id: 'director' });
    expect(await verifyMobileAccessToken(webToken)).toBeNull();
  });

  it('doğru secret ama aud’suz token’ı REDDEDER', async () => {
    const t = await new SignJWT({ role: 'director', sid: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('test-mobile-secret'));
    expect(await verifyMobileAccessToken(t)).toBeNull();
  });

  it('sid claim’i olmayan token’ı REDDEDER', async () => {
    const t = await new SignJWT({ role: 'director' })
      .setProtectedHeader({ alg: 'HS256' })
      .setAudience('okulin-mobile')
      .setIssuer('okulin')
      .setExpirationTime('15m')
      .sign(new TextEncoder().encode('test-mobile-secret'));
    expect(await verifyMobileAccessToken(t)).toBeNull();
  });

  it('bozuk token’a null döner', async () => {
    expect(await verifyMobileAccessToken('sacma')).toBeNull();
  });
});

describe('refresh token', () => {
  it('mrt_ önekli, yeterli entropili, her seferinde farklı', () => {
    const a = newRefreshToken();
    const b = newRefreshToken();
    expect(a).toMatch(/^mrt_[A-Za-z0-9_-]{40,}$/);
    expect(a).not.toBe(b);
  });

  it('hash deterministik 64 karakter hex', () => {
    const t = newRefreshToken();
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
    expect(hashRefreshToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});
