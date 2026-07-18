import { describe, it, expect } from 'vitest';
import { eventIdFrom, targetForUrl } from './notification-routing';

describe('eventIdFrom — FCM data payload\'ından eventId', () => {
  it('geçerli eventId döner', () => {
    expect(eventIdFrom({ eventId: 'ne_abc123', url: '/' })).toBe('ne_abc123');
  });
  it('eksik/boş/yanlış tipte null', () => {
    expect(eventIdFrom({})).toBeNull();
    expect(eventIdFrom({ eventId: '' })).toBeNull();
    expect(eventIdFrom({ eventId: 42 })).toBeNull();
    expect(eventIdFrom(null)).toBeNull();
    expect(eventIdFrom(undefined)).toBeNull();
  });
});

describe('targetForUrl — inbox "İlgili ekranı aç" eşlemesi', () => {
  it('yönetim: path korunarak WebView', () => {
    expect(targetForUrl('/?tab=takvim', 'management')).toEqual({ type: 'web', path: '/?tab=takvim' });
    expect(targetForUrl('/', 'management')).toEqual({ type: 'web', path: '/' });
  });
  it('öğrenci/veli/öğretmen: eşlenmeyen içerik kartları Bugün\'de (ödev/program artık native — bkz. alt describe)', () => {
    expect(targetForUrl('/?sekme=odeme', 'parent')).toEqual({ type: 'today' });
    expect(targetForUrl('/?tab=davranis', 'teacher')).toEqual({ type: 'today' });
  });
  it('kök url native rollerde aksiyon üretmez (zaten inbox\'tayız)', () => {
    expect(targetForUrl('/', 'student')).toBeNull();
  });
  it('güvenlik: mutlak/protokol-göreli/boş url reddedilir', () => {
    expect(targetForUrl('https://evil.com/x', 'management')).toBeNull();
    expect(targetForUrl('//evil.com', 'management')).toBeNull();
    expect(targetForUrl('', 'student')).toBeNull();
    expect(targetForUrl(null, 'management')).toBeNull();
    expect(targetForUrl('/\\evil.com', 'management')).toBeNull();
  });
  it('rol yoksa aksiyon yok', () => {
    expect(targetForUrl('/?tab=odev', null)).toBeNull();
  });
});

describe('targetForUrl — derin native rotalar (Plan 5)', () => {
  it('ödev url → native /odev (öğrenci)', () => {
    expect(targetForUrl('/?tab=odev', 'student')).toEqual({ type: 'native', path: '/odev' });
  });
  it('program url → native /hafta (veli)', () => {
    expect(targetForUrl('/?sekme=program', 'parent')).toEqual({ type: 'native', path: '/hafta' });
  });
  it('yönetim → daima web (native eşleme yok)', () => {
    expect(targetForUrl('/?tab=odev', 'management')).toEqual({ type: 'web', path: '/?tab=odev' });
  });
  it('eşlenmeyen url (davranış) → today (native rol)', () => {
    expect(targetForUrl('/?tab=davranis', 'student')).toEqual({ type: 'today' });
  });
  it('sahte substring (/?notab=odev) → today (tam param eşleşmesi, Codex #10)', () => {
    expect(targetForUrl('/?notab=odev', 'student')).toEqual({ type: 'today' });
  });
  it('kök / → null', () => {
    expect(targetForUrl('/', 'student')).toBeNull();
  });
});
