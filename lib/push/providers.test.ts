import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { _fcmAssertion } from './providers';

// Test için geçici RS256 anahtarı (gerçek service-account taklidi)
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

describe('_fcmAssertion', () => {
  it('Google token uçuna uygun RS256 JWT üretir', async () => {
    const jwt = await _fcmAssertion('svc@okulin-mobil.iam.gserviceaccount.com', pkcs8, 1_800_000_000);
    expect(decodeProtectedHeader(jwt).alg).toBe('RS256');
    const claims = decodeJwt(jwt);
    expect(claims.iss).toBe('svc@okulin-mobil.iam.gserviceaccount.com');
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.iat).toBe(1_800_000_000);
    expect(claims.exp).toBe(1_800_000_000 + 3600);
  });
});
