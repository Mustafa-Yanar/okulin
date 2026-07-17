import { describe, it, expect } from 'vitest';
import { parseChromeMajor, isOutdatedWebView, MIN_CHROME_MAJOR } from './webview-compat';

describe('parseChromeMajor', () => {
  it('WebView 81 UA → 81', () => {
    expect(parseChromeMajor('Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/81.0.4044.138 Mobile Safari/537.36')).toBe(81);
  });
  it('modern WebView 120 → 120', () => {
    expect(parseChromeMajor('Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0 Mobile Safari/537.36')).toBe(120);
  });
  it('Chrome token yok (Safari) → null', () => {
    expect(parseChromeMajor('Mozilla/5.0 (iPhone) Version/17.0 Safari/605')).toBeNull();
  });
  it('boş/null → null', () => {
    expect(parseChromeMajor(null)).toBeNull();
    expect(parseChromeMajor('')).toBeNull();
  });
});

describe('isOutdatedWebView (eşik MIN_CHROME_MAJOR)', () => {
  it('81 < eşik → true (eski)', () => {
    expect(isOutdatedWebView('Mozilla/5.0 Chrome/81.0.4044 Mobile')).toBe(true);
  });
  it('eşik ve üstü → false', () => {
    expect(isOutdatedWebView(`Mozilla/5.0 Chrome/${MIN_CHROME_MAJOR}.0 Mobile`)).toBe(false);
    expect(isOutdatedWebView('Mozilla/5.0 Chrome/120.0 Mobile')).toBe(false);
  });
  it('Chrome token yok → false (fail-open, modern WebView UA Chrome taşır)', () => {
    expect(isOutdatedWebView('Safari/605')).toBe(false);
    expect(isOutdatedWebView(null)).toBe(false);
  });
});
