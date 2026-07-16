// Refresh token rotation POLİTİKASI — saf fonksiyonlar, DB/IO yok (vitest dostu).
//
// Durum makinesi (spec §7: rotation + reuse detection):
//   güncel hash            → rotate  (yeni çift üret, eskiyi prev'e kaydır)
//   prev hash, grace içi   → rotate  (rotation yanıtı istemciye ulaşamamış olabilir —
//                                     ağ hatasında meşru istemci eski token'la döner)
//   prev hash, grace dışı  → revoke  (REUSE: token çalınmış olabilir → oturum kapanır,
//                                     kullanıcı yeniden login olur)
//   tanınmayan / revoked / expired → reject

export const REFRESH_TTL_DAYS = 60; // kayan pencere: her rotation uzatır (aktif cihaz düşmez)
export const ROTATE_GRACE_SEC = 30;

export interface RefreshSessionState {
  refreshHash: string;
  prevRefreshHash: string | null;
  rotatedAt: Date | null;
  expiresAt: Date;
  revokedAt: Date | null;
}

export type RefreshDecision =
  | { action: 'rotate' }
  | { action: 'reject'; reason: 'revoked' | 'expired' | 'unknown' }
  | { action: 'revoke'; reason: 'reuse' };

export function decideRefresh(s: RefreshSessionState, presentedHash: string, now: Date): RefreshDecision {
  if (s.revokedAt) return { action: 'reject', reason: 'revoked' };
  if (s.expiresAt.getTime() <= now.getTime()) return { action: 'reject', reason: 'expired' };
  if (presentedHash === s.refreshHash) return { action: 'rotate' };
  if (s.prevRefreshHash && presentedHash === s.prevRefreshHash) {
    const rotatedMs = s.rotatedAt?.getTime() ?? 0;
    if (now.getTime() - rotatedMs <= ROTATE_GRACE_SEC * 1000) return { action: 'rotate' };
    return { action: 'revoke', reason: 'reuse' };
  }
  return { action: 'reject', reason: 'unknown' };
}

export function nextExpiry(now: Date): Date {
  return new Date(now.getTime() + REFRESH_TTL_DAYS * 86400_000);
}
