import { describe, expect, it } from 'vitest';
import { isCronAuthorized } from './cron-auth';

function requestWith(auth: string | null): Pick<Request, 'headers'> {
  const headers = new Headers();
  if (auth !== null) headers.set('authorization', auth);
  return { headers };
}

describe('cron yetkilendirmesi', () => {
  it('secret tanımsızsa Bearer undefined dahil her şeyi reddeder', () => {
    expect(isCronAuthorized(requestWith('Bearer undefined'), undefined)).toBe(false);
    expect(isCronAuthorized(requestWith(null), undefined)).toBe(false);
  });

  it('yalnız doğru Bearer secret değerini kabul eder', () => {
    expect(isCronAuthorized(requestWith('Bearer yerel-test-secret'), 'yerel-test-secret')).toBe(true);
    expect(isCronAuthorized(requestWith('Bearer yanlis'), 'yerel-test-secret')).toBe(false);
    expect(isCronAuthorized(requestWith(null), 'yerel-test-secret')).toBe(false);
  });
});
