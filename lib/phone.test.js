import { describe, it, expect } from 'vitest';
import {
  normalizeTurkishMobile,
  isValidTurkishMobile,
  formatTurkishMobile,
  toSmsFormat,
} from './phone.js';

const CANON = '5321234567';

describe('normalizeTurkishMobile', () => {
  it('farklı yazımları tek kanonik forma çevirir', () => {
    expect(normalizeTurkishMobile('0532 123 45 67')).toBe(CANON);
    expect(normalizeTurkishMobile('+90 532 123 45 67')).toBe(CANON);
    expect(normalizeTurkishMobile('905321234567')).toBe(CANON);
    expect(normalizeTurkishMobile('00905321234567')).toBe(CANON);
    expect(normalizeTurkishMobile('5321234567')).toBe(CANON);
    expect(normalizeTurkishMobile('0532-123-45-67')).toBe(CANON);
  });

  it('geçersiz numaraları reddeder (null)', () => {
    expect(normalizeTurkishMobile('')).toBeNull();
    expect(normalizeTurkishMobile(null)).toBeNull();
    expect(normalizeTurkishMobile(undefined)).toBeNull();
    expect(normalizeTurkishMobile('0212 123 45 67')).toBeNull(); // sabit hat (5 değil)
    expect(normalizeTurkishMobile('532123456')).toBeNull();      // 9 hane
    expect(normalizeTurkishMobile('53212345678')).toBeNull();    // 11 hane
    expect(normalizeTurkishMobile('abc')).toBeNull();
    expect(normalizeTurkishMobile('4321234567')).toBeNull();     // 5 ile başlamıyor
  });

  it('sayısal girdiyi de kabul eder', () => {
    expect(normalizeTurkishMobile(5321234567)).toBe(CANON);
  });
});

describe('isValidTurkishMobile', () => {
  it('geçerli/geçersiz ayrımı yapar', () => {
    expect(isValidTurkishMobile('0532 123 45 67')).toBe(true);
    expect(isValidTurkishMobile('0212 123 45 67')).toBe(false);
  });
});

describe('formatTurkishMobile', () => {
  it('görüntüleme formatına çevirir', () => {
    expect(formatTurkishMobile('5321234567')).toBe('0532 123 45 67');
  });
  it('geçersizde ham değeri döndürür', () => {
    expect(formatTurkishMobile('abc')).toBe('abc');
    expect(formatTurkishMobile('')).toBe('');
    expect(formatTurkishMobile(null)).toBe('');
  });
});

describe('toSmsFormat', () => {
  it('90 önekli forma çevirir', () => {
    expect(toSmsFormat('0532 123 45 67')).toBe('905321234567');
  });
  it('geçersizde null döner', () => {
    expect(toSmsFormat('0212 123 45 67')).toBeNull();
  });
});
