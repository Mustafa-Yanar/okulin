// Bildirim teslimat POLİTİKASI — saf fonksiyonlar, DB/IO yok (vitest dostu).
// Outbox durum makinesi: pending --deliver--> sent | pending(backoff) | dead.

export const MAX_ATTEMPTS = 5;

// attempt = kaçıncı denemenin SONUCU işleniyor (1-bazlı). Sınırda null → dead.
const BACKOFF_MIN = [5, 30, 120, 720] as const; // 5dk, 30dk, 2sa, 12sa

export function backoffMinutes(attempt: number): number | null {
  if (attempt >= MAX_ATTEMPTS) return null;
  return BACKOFF_MIN[attempt - 1] ?? null;
}

// Kilit ekranı mahremiyeti (Apple 4.5.4 + KVKK): hassas bildirimlerde push'a
// jenerik metin gider; tam içerik yalnız NotificationEvent (uygulama içi inbox).
export const GENERIC_PUSH = {
  title: 'Yeni bildiriminiz var',
  body: 'Detayları görmek için okulin uygulamasını açın.',
} as const;

export function renderPush(p: { title: string; body: string; sensitive?: boolean }): { title: string; body: string } {
  if (p.sensitive) return { ...GENERIC_PUSH };
  return { title: p.title, body: p.body };
}

export interface DeliveryOutcome {
  status: 'sent' | 'pending' | 'dead';
  nextAttemptAt?: Date;
}

export function applyResult(attempts: number, r: { ok: boolean; permanent: boolean }, now: Date): DeliveryOutcome {
  if (r.ok) return { status: 'sent' };
  if (r.permanent) return { status: 'dead' };
  const mins = backoffMinutes(attempts);
  if (mins === null) return { status: 'dead' };
  return { status: 'pending', nextAttemptAt: new Date(now.getTime() + mins * 60_000) };
}
