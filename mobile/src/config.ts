// Uygulama sabitleri.
// APEX_BASE: resolve-org'un TEK adresi — kurum host'ları buradan çözülür, elle
// girilen host'a ASLA bağlanılmaz (spec §6/3).
// SENTRY_DSN Task 10'da doldurulur (DSN sır değildir, istemciye gömülür).
export const APEX_BASE = 'https://okulin.com';
export const SENTRY_DSN = '';

// Host allowlist'i (spec §6/3 + İnceleme Codex #11): resolve-org YANITINDAKİ
// canonicalHost bile doğrulanmadan kullanılmaz — istemci yalnız *.okulin.com
// desenine bağlanır (yanıt kurcalanır/bozulursa şifreler yabancı host'a gitmez).
export function isAllowedHost(host: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.okulin\.com$/.test(host);
}
