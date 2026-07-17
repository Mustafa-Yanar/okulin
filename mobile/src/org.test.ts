import { describe, it, expect } from 'vitest';
import { extractOrgCode } from './org';

describe('extractOrgCode — QR içeriğinden kurum kodu', () => {
  it('düz kod: trim + büyük harf', () => {
    expect(extractOrgCode(' 7jt-psh ')).toBe('7JT-PSH');
    expect(extractOrgCode('7JT-PSH')).toBe('7JT-PSH');
  });
  it('okulin.com URL query paramı (code/kod)', () => {
    expect(extractOrgCode('https://okulin.com/?code=7jt-psh')).toBe('7JT-PSH');
    expect(extractOrgCode('https://okulin.com/kayit?kod=7JT-PSH&x=1')).toBe('7JT-PSH');
  });
  it('okulin.com URL son path segmenti', () => {
    expect(extractOrgCode('https://okulin.com/m/kurum/7JT-PSH')).toBe('7JT-PSH');
  });
  it('yabancı host URL reddedilir (kod sızdırma/oltalama QR\'ı)', () => {
    expect(extractOrgCode('https://evil.com/?code=7JT-PSH')).toBeNull();
    expect(extractOrgCode('https://okulin.com.evil.com/?code=X')).toBeNull();
  });
  it('boş / aşırı uzun / rastgele içerik null', () => {
    expect(extractOrgCode('')).toBeNull();
    expect(extractOrgCode('   ')).toBeNull();
    expect(extractOrgCode('x'.repeat(64))).toBeNull();
    expect(extractOrgCode('https://okulin.com/')).toBeNull(); // ne query ne segment
  });
});
