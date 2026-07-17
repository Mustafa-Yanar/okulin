import { describe, it, expect } from 'vitest';
import { trToday, pickPendingOdev, isPastDue } from './today';

describe('trToday — TR (UTC+3) gün/hafta hesabı', () => {
  it('normal gün: 17 Tem 2026 Cuma', () => {
    const t = trToday(new Date('2026-07-17T10:00:00Z'));
    expect(t).toEqual({ date: '2026-07-17', dayIndex: 4, dayLabel: 'Cuma', weekKey: '2026-W29' });
  });
  it('UTC gece yarısı öncesi ama TR ertesi gün (kritik kayma penceresi)', () => {
    const t = trToday(new Date('2026-07-16T22:30:00Z')); // TR 17 Tem 01:30
    expect(t.date).toBe('2026-07-17');
    expect(t.dayIndex).toBe(4);
  });
  it('TR pazar 23:59 → hâlâ pazar/W29', () => {
    const t = trToday(new Date('2026-07-19T20:59:00Z'));
    expect(t).toMatchObject({ date: '2026-07-19', dayIndex: 6, weekKey: '2026-W29' });
  });
  it('TR pazartesi 00:00 → yeni gün + yeni hafta', () => {
    const t = trToday(new Date('2026-07-19T21:00:00Z'));
    expect(t).toMatchObject({ date: '2026-07-20', dayIndex: 0, weekKey: '2026-W30' });
  });
  it('ISO yıl başı: 1 Oca 2026 Perşembe → W01', () => {
    const t = trToday(new Date('2026-01-01T00:00:00Z')); // TR 03:00
    expect(t).toMatchObject({ date: '2026-01-01', dayIndex: 3, weekKey: '2026-W01' });
  });
});

describe('pickPendingOdev', () => {
  const mk = (id: string, dueDate: string, sub: unknown = null) => ({ id, title: `Ödev ${id}`, branch: 'Matematik', dueDate, sub });
  it('teslim edilmemiş HER ödev bekler — vadesi geçmiş dahil (overdue işaretli); yalnız teslimli elenir', () => {
    const r = pickPendingOdev(
      [mk('a', '2026-07-20'), mk('b', '2026-07-10'), mk('c', '2026-07-18', { status: 'teslim' }), mk('d', '')],
      '2026-07-17',
    );
    expect(r.pending).toBe(3); // a (ileride) + b (GEÇMİŞ ama teslim edilmemiş) + d (vadesiz)
    expect(r.items.map((i) => i.id)).toEqual(['b', 'a', 'd']); // vade artan: geçmiş önce, vadesiz sonda
    expect(r.items.map((i) => i.overdue)).toEqual([true, false, false]);
  });
  it('vade artan sıralar ve max ile kırpar (pending sayısı kırpılmaz)', () => {
    const r = pickPendingOdev([mk('a', '2026-07-30'), mk('b', '2026-07-18'), mk('c', '2026-07-20'), mk('d', '2026-07-19')], '2026-07-17', 2);
    expect(r.items.map((i) => i.id)).toEqual(['b', 'd']);
    expect(r.pending).toBe(4);
  });
  it('bugün vadeli ödev beklemede ve overdue DEĞİL', () => {
    const r = pickPendingOdev([mk('a', '2026-07-17')], '2026-07-17');
    expect(r.pending).toBe(1);
    expect(r.items[0].overdue).toBe(false);
  });
});

describe('isPastDue', () => {
  it('YYYY-MM-DD: dün geçmiş, bugün/yarın değil', () => {
    expect(isPastDue('2026-07-16', '2026-07-17')).toBe(true);
    expect(isPastDue('2026-07-17', '2026-07-17')).toBe(false);
    expect(isPastDue('2026-07-18', '2026-07-17')).toBe(false);
  });
  it('boş/biçimsiz vade asla geçmiş sayılmaz', () => {
    expect(isPastDue('', '2026-07-17')).toBe(false);
    expect(isPastDue(null, '2026-07-17')).toBe(false);
    expect(isPastDue('17.07.2026', '2026-07-17')).toBe(false);
  });
});
