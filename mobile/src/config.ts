// Uygulama sabitleri.
// APEX_BASE: resolve-org'un TEK adresi — kurum host'ları buradan çözülür, elle
// girilen host'a ASLA bağlanılmaz (spec §6/3).
// SENTRY_DSN: EU (Frankfurt) projesi — .de. ingest (DSN sır değildir, istemciye gömülür).
export const APEX_BASE = 'https://okulin.com';
export const SENTRY_DSN = 'https://23efed3076927c070bda9319c307f4c8@o4511747155034112.ingest.de.sentry.io/4511747175809104';

// Host allowlist'i (spec §6/3 + İnceleme Codex #11): resolve-org YANITINDAKİ
// canonicalHost bile doğrulanmadan kullanılmaz — istemci yalnız *.okulin.com
// desenine bağlanır (yanıt kurcalanır/bozulursa şifreler yabancı host'a gitmez).
export function isAllowedHost(host: string): boolean {
  return /^[a-z0-9][a-z0-9.-]*\.okulin\.com$/.test(host);
}
