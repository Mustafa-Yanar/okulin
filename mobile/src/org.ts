import { APEX_BASE, isAllowedHost } from './config';
import { fetchWithTimeout, BOOT_TIMEOUT_MS } from './api/http';
import type { OrgInfo } from './store/session';
import type { ResolveOrgResponse } from './api/types';

// Kurum keşfi ortak yolu (spec §6): elle kod girişi (kurum.tsx) + QR (kurum-qr.tsx)
// aynı çözümlemeden geçer — allowlist kontrolü tek yerde.

// QR/elle giriş içeriğinden kurum kodu: düz kod ("7JT-PSH") VEYA okulin.com URL'i
// (?code=/?kod= paramı ya da son path segmenti). Yabancı host URL'leri REDDEDİLİR
// (oltalama QR'ı gate'e kod deneme yaptıramaz). Kod doğrulaması sunucuda (resolve-org).
export function extractOrgCode(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (!/(^|\.)okulin\.com$/i.test(u.hostname)) return null;
      const q = u.searchParams.get('code') || u.searchParams.get('kod');
      if (q && q.trim()) return q.trim().toUpperCase();
      const seg = u.pathname.split('/').filter(Boolean).pop();
      return seg && seg.trim() ? seg.trim().toUpperCase() : null;
    } catch {
      return null;
    }
  }
  if (s.length > 32) return null; // kurum kodu değil (rastgele QR içeriği)
  return s.toUpperCase();
}

export type ResolveOutcome = { ok: true; org: OrgInfo } | { ok: false; error: string };

// Kod → kurum (apex resolve-org). İstemci YALNIZ dönen canonicalHost'a bağlanır;
// allowlist dışı host reddedilir (spec §6/3 — kurum.tsx'ten taşındı, davranış aynı).
export async function resolveOrgByCode(code: string): Promise<ResolveOutcome> {
  try {
    const res = await fetchWithTimeout(
      fetch,
      `${APEX_BASE}/api/mobile/v1/resolve-org`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
      },
      BOOT_TIMEOUT_MS,
    );
    const j = (await res.json().catch(() => null)) as (Partial<ResolveOrgResponse> & { error?: string }) | null;
    if (!res.ok || !j?.ok || !j.canonicalHost) {
      return { ok: false, error: j?.error ?? 'Kurum bulunamadı. Kodu kontrol edin.' };
    }
    if (!isAllowedHost(j.canonicalHost)) {
      return { ok: false, error: 'Kurum adresi doğrulanamadı.' };
    }
    return {
      ok: true,
      org: {
        orgSlug: j.orgSlug!,
        canonicalHost: j.canonicalHost,
        name: j.name!,
        shortName: j.shortName!,
        logoUrl: j.logoUrl ?? '',
        themeColor: j.themeColor!,
      },
    };
  } catch {
    return { ok: false, error: 'Bağlantı kurulamadı. İnternetinizi kontrol edin.' };
  }
}
