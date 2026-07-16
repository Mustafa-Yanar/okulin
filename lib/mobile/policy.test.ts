import { describe, it, expect } from 'vitest';
import { decideRefresh, nextExpiry, REFRESH_TTL_DAYS, ROTATE_GRACE_SEC } from './policy';

const now = new Date('2026-07-16T12:00:00Z');
const base = {
  refreshHash: 'guncel',
  prevRefreshHash: 'eski' as string | null,
  rotatedAt: new Date(now.getTime() - 120_000) as Date | null, // 2 dk önce rotate edildi
  expiresAt: new Date(now.getTime() + 86400_000),
  revokedAt: null as Date | null,
};

describe('decideRefresh', () => {
  it('güncel hash → rotate', () => {
    expect(decideRefresh(base, 'guncel', now)).toEqual({ action: 'rotate' });
  });

  it('revoke edilmiş oturum → reject (güncel hash bile olsa)', () => {
    expect(decideRefresh({ ...base, revokedAt: new Date() }, 'guncel', now))
      .toEqual({ action: 'reject', reason: 'revoked' });
  });

  it('süresi dolmuş oturum → reject', () => {
    expect(decideRefresh({ ...base, expiresAt: new Date(now.getTime() - 1000) }, 'guncel', now))
      .toEqual({ action: 'reject', reason: 'expired' });
  });

  it('grace İÇİNDE eski hash → rotate (kaybolan yanıtın meşru tekrarı)', () => {
    const s = { ...base, rotatedAt: new Date(now.getTime() - (ROTATE_GRACE_SEC - 5) * 1000) };
    expect(decideRefresh(s, 'eski', now)).toEqual({ action: 'rotate' });
  });

  it('grace TAM SINIRDA (now - rotatedAt === 30s) eski hash → rotate (sınır dahil, <=)', () => {
    const s = { ...base, rotatedAt: new Date(now.getTime() - ROTATE_GRACE_SEC * 1000) };
    expect(decideRefresh(s, 'eski', now)).toEqual({ action: 'rotate' });
  });

  it('grace DIŞI eski hash → revoke (REUSE — çalıntı şüphesi)', () => {
    expect(decideRefresh(base, 'eski', now)).toEqual({ action: 'revoke', reason: 'reuse' });
  });

  it('tanınmayan hash → reject', () => {
    expect(decideRefresh(base, 'yabanci', now)).toEqual({ action: 'reject', reason: 'unknown' });
  });

  it('prev yokken eski hash sunulursa → reject (ilk oturumda reuse yolu yok)', () => {
    expect(decideRefresh({ ...base, prevRefreshHash: null }, 'eski', now))
      .toEqual({ action: 'reject', reason: 'unknown' });
  });
});

describe('nextExpiry', () => {
  it('now + 60 gün', () => {
    expect(nextExpiry(now).getTime()).toBe(now.getTime() + REFRESH_TTL_DAYS * 86400_000);
  });
});
