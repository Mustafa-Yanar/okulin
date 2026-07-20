import { describe, it, expect } from 'vitest';
import { levelPoolFrom } from './level-pool';

const REG = [
  { group: 'lise', dersler: ['TYT Matematik', 'Geometri', 'Fizik', 'Kimya', 'Biyoloji', 'AYT Matematik', 'paragraf'] }, // 401
  { group: 'lise', dersler: ['Türkçe', 'TYT Matematik', 'Geometri', 'Tarih', 'Coğrafya', 'AYT Matematik', 'paragraf'] }, // 406
  { group: 'ortaokul', dersler: ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'] }, // 801
];

describe('levelPoolFrom — düzey havuzu (§4a)', () => {
  it('lise havuzu = lise sınıflarının BİRLEŞİMİ (sınıf-dışı ders dahil: 401 öğrencisi Tarih alabilir)', () => {
    const pool = levelPoolFrom(REG, 'lise');
    expect(pool).toContain('Fizik');
    expect(pool).toContain('Tarih'); // 401'in listesinde yok ama 406'da var → havuzda
    expect(pool).not.toContain('İnkılap Tarihi'); // yalnız ortaokul → lise ALAMAZ
  });
  it('ortaokul havuzunda Fizik YOK (yalnız lise dersi)', () => {
    expect(levelPoolFrom(REG, 'ortaokul')).not.toContain('Fizik');
    expect(levelPoolFrom(REG, 'ortaokul')).toContain('İnkılap Tarihi');
  });
  it('registry o grupta boşsa → COL_COURSES fallback birleşimi', () => {
    const pool = levelPoolFrom([], 'lise');
    expect(pool).toContain('Fizik'); // Lise Ortak_9
    expect(pool).toContain('TYT Matematik'); // Lise Sayısal_12
    expect(pool).not.toContain('İnkılap Tarihi');
  });
  it('mezun fallback → Mezun sütunları', () => {
    expect(levelPoolFrom([], 'mezun').length).toBeGreaterThan(0);
  });
  it('grup sınıfları var ama hepsinin dersler listesi boş → fallback', () => {
    expect(levelPoolFrom([{ group: 'lise', dersler: [] }], 'lise')).toContain('Fizik');
  });
  it('tekrarlar tekilleştirilir', () => {
    const pool = levelPoolFrom(REG, 'lise');
    expect(pool.filter((d) => d === 'TYT Matematik').length).toBe(1);
  });
});
