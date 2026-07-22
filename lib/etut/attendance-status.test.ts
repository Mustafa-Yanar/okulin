import { describe, it, expect } from 'vitest';
import { buildEtutYoklamaMap } from './attendance-status';

// dateForDay sahtesi: dayIndex → sabit hafta tarihleri
const dates = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-25', '2026-07-26'];
const dfd = (i: number) => dates[i];

describe('buildEtutYoklamaMap', () => {
  it('alınmış yoklama durumları aynen döner (var/gec/yok)', () => {
    const rows = [
      { id: 'e1', dayIndex: 0, studentId: 's1' },
      { id: 'e2', dayIndex: 1, studentId: 's2' },
      { id: 'e3', dayIndex: 2, studentId: 's3' },
    ];
    const recs = [
      { date: '2026-07-20', lessonNo: 'ee1', records: { s1: 'var' } },
      { date: '2026-07-21', lessonNo: 'ee2', records: { s2: 'gec' } },
      { date: '2026-07-22', lessonNo: 'ee3', records: { s3: 'yok' } },
    ];
    expect(buildEtutYoklamaMap(rows, recs, dfd)).toEqual({ e1: 'var', e2: 'gec', e3: 'yok' });
  });

  it('kayıt yoksa alinmadi', () => {
    expect(buildEtutYoklamaMap([{ id: 'x', dayIndex: 0, studentId: 's1' }], [], dfd)).toEqual({ x: 'alinmadi' });
  });

  it('kayıt var ama MEVCUT öğrenci için giriş yoksa alinmadi (yeniden-atama)', () => {
    const recs = [{ date: '2026-07-20', lessonNo: 'ex', records: { eskiOgrenci: 'var' } }];
    expect(buildEtutYoklamaMap([{ id: 'x', dayIndex: 0, studentId: 'yeniOgrenci' }], recs, dfd)).toEqual({ x: 'alinmadi' });
  });

  it('yanlış gün tarihindeki kayıt eşleşmez → alinmadi', () => {
    const recs = [{ date: '2026-07-21', lessonNo: 'ex', records: { s1: 'var' } }];
    expect(buildEtutYoklamaMap([{ id: 'x', dayIndex: 0, studentId: 's1' }], recs, dfd)).toEqual({ x: 'alinmadi' });
  });

  it('atanmamış (boş) slot map\'e girmez; bozuk records objesi güvenli', () => {
    const rows = [
      { id: 'bos', dayIndex: 0, studentId: null },
      { id: 'bozuk', dayIndex: 0, studentId: 's1' },
    ];
    const recs = [{ date: '2026-07-20', lessonNo: 'ebozuk', records: 'çorba' }];
    expect(buildEtutYoklamaMap(rows, recs, dfd)).toEqual({ bozuk: 'alinmadi' });
  });

  it('geçersiz statü değeri alinmadi sayılır (ileri uyumluluk)', () => {
    const recs = [{ date: '2026-07-20', lessonNo: 'ex', records: { s1: 'belirsiz' } }];
    expect(buildEtutYoklamaMap([{ id: 'x', dayIndex: 0, studentId: 's1' }], recs, dfd)).toEqual({ x: 'alinmadi' });
  });
});
