import { describe, it, expect } from 'vitest';
import { roleCategoryOf, rolEtiketi } from './rol';

describe('roleCategoryOf — WebView/yönlendirme rol kapısı', () => {
  it('native roller kendini döner', () => {
    expect(roleCategoryOf('student')).toBe('student');
    expect(roleCategoryOf('parent')).toBe('parent');
    expect(roleCategoryOf('teacher')).toBe('teacher');
  });
  it('yönetim rolleri management', () => {
    expect(roleCategoryOf('director')).toBe('management');
    expect(roleCategoryOf('accountant')).toBe('management');
    expect(roleCategoryOf('counselor')).toBe('management');
    expect(roleCategoryOf('org_admin')).toBe('management');
  });
  it('bilinmeyen rol de management sayılır (yeni yönetsel roller güvenli varsayılan)', () => {
    expect(roleCategoryOf('assistant_director')).toBe('management');
  });
  it('boş/null/undefined → null (guard yönlendirmesi)', () => {
    expect(roleCategoryOf(undefined)).toBeNull();
    expect(roleCategoryOf(null)).toBeNull();
    expect(roleCategoryOf('')).toBeNull();
  });
});

describe('rolEtiketi', () => {
  it('bilinen rol Türkçe etiket, bilinmeyen ham string, boş → boş', () => {
    expect(rolEtiketi('student')).toBe('Öğrenci');
    expect(rolEtiketi('bilinmeyen_rol')).toBe('bilinmeyen_rol');
    expect(rolEtiketi(undefined)).toBe('');
  });
});
