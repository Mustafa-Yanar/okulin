import { describe, it, expect } from 'vitest';
import { categoryOf, categoriesForRole } from './notify-prefs';

describe('categoryOf — tag önekinden kategori', () => {
  it('odev-<id> → odev', () => expect(categoryOf('odev-abc')).toBe('odev'));
  it('devamsizlik-<date> → devamsizlik', () => expect(categoryOf('devamsizlik-2026-07-18')).toBe('devamsizlik'));
  it('ann-<id> → duyuru', () => expect(categoryOf('ann-x')).toBe('duyuru'));
  it('davranis-<sid> → davranis', () => expect(categoryOf('davranis-s1')).toBe('davranis'));
  it('deneme-<eid> → deneme', () => expect(categoryOf('deneme-e1')).toBe('deneme'));
  it('form-<id> → form', () => expect(categoryOf('form-f1')).toBe('form'));
  it('etkinlik-<id> → takvim', () => expect(categoryOf('etkinlik-ev1')).toBe('takvim'));
  it('odeme-hatirlatma → odeme', () => expect(categoryOf('odeme-hatirlatma')).toBe('odeme'));
  it('yeni-cihaz → guvenlik', () => expect(categoryOf('yeni-cihaz')).toBe('guvenlik'));
  it('bilinmeyen/null → null (gerçek fail-open, isPushMuted daima false)', () => {
    expect(categoryOf(null)).toBeNull();
    expect(categoryOf('bilinmeyen-xyz')).toBeNull();
    expect(categoryOf(undefined)).toBeNull();
  });
});

describe('categoriesForRole — role-relevant toggle kategorileri', () => {
  it('öğrenci: ödev var; güvenlik/devamsızlık/ödeme YOK', () => {
    const c = categoriesForRole('student');
    expect(c).toContain('odev');
    expect(c).not.toContain('guvenlik');
    expect(c).not.toContain('devamsizlik');
    expect(c).not.toContain('odeme');
  });
  it('veli: devamsızlık + ödeme var; ödev YOK', () => {
    const c = categoriesForRole('parent');
    expect(c).toContain('devamsizlik');
    expect(c).toContain('odeme');
    expect(c).not.toContain('odev');
  });
  it('hiçbir rol güvenlik kategorisini toggle listesine koymaz', () => {
    for (const role of ['student', 'parent', 'teacher', 'director', 'accountant']) {
      expect(categoriesForRole(role)).not.toContain('guvenlik');
    }
  });
});
