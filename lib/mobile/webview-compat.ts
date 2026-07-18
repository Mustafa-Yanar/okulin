// Eski-WebView tespiti (Plan 4 tur bulgusu). Android System WebView sürümü UA'daki
// Chrome/XX token'ında görünür; eşik altı WebView modern JS bundle'ı parse edemez
// (boş sayfa). session-open UA'yı sunucuda okur (native köprü yok — Plan 4 ADR).
// MIN_CHROME_MAJOR: WebView 81 fail etti; 90 başlangıç, cihazda ince ayar (Task 15).
export const MIN_CHROME_MAJOR = 90;

export function parseChromeMajor(ua: string | null | undefined): number | null {
  if (!ua) return null;
  const m = /Chrome\/(\d+)/.exec(ua);
  return m ? parseInt(m[1], 10) : null;
}

// Chrome token yoksa (nadir; modern WebView UA daima taşır) fail-open (bloklamaz).
export function isOutdatedWebView(ua: string | null | undefined): boolean {
  const major = parseChromeMajor(ua);
  if (major === null) return false;
  return major < MIN_CHROME_MAJOR;
}

// Minimal statik uyarı sayfası — hiç JS yok, inline stil → WebView 81'de bile render olur.
// Play WebView linki https (web.tsx onShouldStartLoadWithRequest sistem tarayıcısında açar).
export function outdatedWebViewHtml(): string {
  return [
    '<!doctype html><html lang="tr"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="referrer" content="no-referrer">',
    '<title>Güncelleme gerekli</title></head>',
    '<body style="font-family:sans-serif;margin:0;padding:24px;background:#f8fafc;color:#0f172a">',
    '<div style="max-width:420px;margin:40px auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">',
    '<h1 style="font-size:18px;margin:0 0 12px">Tarayıcı bileşeni güncel değil</h1>',
    '<p style="font-size:14px;line-height:1.5;color:#475569">Yönetim panelini açmak için cihazınızdaki “Android System WebView” bileşeninin güncellenmesi gerekiyor. Google Play’den güncelledikten sonra tekrar deneyin.</p>',
    '<p style="margin-top:20px"><a href="https://play.google.com/store/apps/details?id=com.google.android.webview" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-size:14px">Google Play’de güncelle</a></p>',
    '</div></body></html>',
  ].join('');
}
