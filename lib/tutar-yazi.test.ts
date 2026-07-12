import { describe, it, expect } from 'vitest';
import { sayiyiYaziyaCevir, tutariYaziyaCevir } from './tutar-yazi';

describe('sayiyiYaziyaCevir', () => {
  it('temel sayılar', () => {
    expect(sayiyiYaziyaCevir(0)).toBe('Sıfır');
    expect(sayiyiYaziyaCevir(1)).toBe('Bir');
    expect(sayiyiYaziyaCevir(9)).toBe('Dokuz');
    expect(sayiyiYaziyaCevir(10)).toBe('On');
    expect(sayiyiYaziyaCevir(15)).toBe('On Beş');
    expect(sayiyiYaziyaCevir(90)).toBe('Doksan');
    expect(sayiyiYaziyaCevir(99)).toBe('Doksan Dokuz');
  });

  it('yüzler — "Bir Yüz" değil "Yüz"', () => {
    expect(sayiyiYaziyaCevir(100)).toBe('Yüz');
    expect(sayiyiYaziyaCevir(200)).toBe('İki Yüz');
    expect(sayiyiYaziyaCevir(105)).toBe('Yüz Beş');
    expect(sayiyiYaziyaCevir(550)).toBe('Beş Yüz Elli');
    expect(sayiyiYaziyaCevir(999)).toBe('Dokuz Yüz Doksan Dokuz');
  });

  it('binler — "Bir Bin" değil "Bin"', () => {
    expect(sayiyiYaziyaCevir(1000)).toBe('Bin');
    expect(sayiyiYaziyaCevir(2000)).toBe('İki Bin');
    expect(sayiyiYaziyaCevir(5500)).toBe('Beş Bin Beş Yüz');
    expect(sayiyiYaziyaCevir(7000)).toBe('Yedi Bin');
    expect(sayiyiYaziyaCevir(15000)).toBe('On Beş Bin');
    expect(sayiyiYaziyaCevir(20000)).toBe('Yirmi Bin');
    expect(sayiyiYaziyaCevir(55000)).toBe('Elli Beş Bin');
    expect(sayiyiYaziyaCevir(130000)).toBe('Yüz Otuz Bin');
    expect(sayiyiYaziyaCevir(860500)).toBe('Sekiz Yüz Altmış Bin Beş Yüz');
  });

  it('milyon ve üzeri', () => {
    expect(sayiyiYaziyaCevir(1000000)).toBe('Bir Milyon');
    expect(sayiyiYaziyaCevir(1500000)).toBe('Bir Milyon Beş Yüz Bin');
    expect(sayiyiYaziyaCevir(1001000)).toBe('Bir Milyon Bin'); // ara sıfır grup atlanır
    expect(sayiyiYaziyaCevir(2000001)).toBe('İki Milyon Bir');
  });
});

describe('tutariYaziyaCevir', () => {
  it('kuruşsuz tutar', () => {
    expect(tutariYaziyaCevir(15000).full).toBe('On Beş Bin Türk Lirası Sıfır Kuruş');
    expect(tutariYaziyaCevir(5500).lira).toBe('Beş Bin Beş Yüz');
    expect(tutariYaziyaCevir(5500).kurus).toBe('Sıfır');
  });

  it('kuruşlu tutar', () => {
    const r = tutariYaziyaCevir(5500.50);
    expect(r.lira).toBe('Beş Bin Beş Yüz');
    expect(r.kurus).toBe('Elli');
    expect(r.full).toBe('Beş Bin Beş Yüz Türk Lirası Elli Kuruş');
  });

  it('float artığı 2 haneye sabitlenir', () => {
    expect(tutariYaziyaCevir(5500.1).kurus).toBe('On');   // 0.1*100=10.0000002 → 10
    expect(tutariYaziyaCevir(100.99).kurus).toBe('Doksan Dokuz');
  });

  it('sıfır tutar', () => {
    expect(tutariYaziyaCevir(0).full).toBe('Sıfır Türk Lirası Sıfır Kuruş');
  });
});
