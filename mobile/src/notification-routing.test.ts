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
  it('öğrenci/veli/öğretmen: içerik kartları Bugün\'de', () => {
    expect(targetForUrl('/?tab=odev', 'student')).toEqual({ type: 'today' });
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
  });
  it('rol yoksa aksiyon yok', () => {
    expect(targetForUrl('/?tab=odev', null)).toBeNull();
  });
});
