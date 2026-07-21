import { describe, it, expect, vi } from 'vitest';

// levelPoolForStudent testleri getClasses/getClass'ı mock'lar (gerçek tdb() bağlantısı YOK).
// vi.mock hoisted olduğundan aşağıdaki static import'lardan ÖNCE çalışır (bkz. lib/tenant.test.ts
// ile AYNI desen) — levelPoolFrom (saf fonksiyon) bu mock'tan etkilenmez, getClasses'ı çağırmaz.
vi.mock('@/lib/classes', () => ({ getClasses: vi.fn(), getClass: vi.fn() }));

import { levelPoolFrom, levelPoolForStudent } from './level-pool';
import { getClasses, getClass } from '@/lib/classes';

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

// levelPoolForStudent — boş-havuz fallback (Fix 2, reviewer bulgusu): 'ilkokul' gibi
// FALLBACK_KEYS'te olmayan + registry'de sınıfı olmayan gruplar için levelPoolForGroup []
// döner → branş doğrulaması TÜM rezervasyonları reddederdi.
describe('levelPoolForStudent — boş-havuz fallback (Fix 2)', () => {
  it('grup havuzu doluysa (lise) doğrudan onu döner — getClass ÇAĞRILMAZ', async () => {
    vi.mocked(getClasses).mockResolvedValue([
      { id: '901', ad: '9-A', group: 'lise', kademe: 'lise', duzey: '9', dal: null, dersler: ['Fizik'], seeded: true, slotTemplate: null },
    ]);
    vi.mocked(getClass).mockClear();
    const pool = await levelPoolForStudent('901', 'lise');
    expect(pool).toContain('Fizik');
    expect(getClass).not.toHaveBeenCalled();
  });

  it("grup havuzu boşsa (örn. 'ilkokul' — registry'de sınıf yok + FALLBACK_KEYS'te yok) → öğrencinin kendi şubesinin dersler'ine düşer", async () => {
    vi.mocked(getClasses).mockResolvedValue([]);
    vi.mocked(getClass).mockResolvedValue({
      id: 'ilkokul-1a', ad: '1-A', group: 'ilkokul', kademe: 'ilkokul', duzey: '1', dal: null,
      dersler: ['Türkçe', 'Matematik'], seeded: false, slotTemplate: null,
    });
    const pool = await levelPoolForStudent('ilkokul-1a', 'ilkokul');
    expect(pool).toEqual(['Türkçe', 'Matematik']);
  });

  it('havuz boş + öğrencinin şubesi de bulunamazsa (null) → boş dizi (çağıran "Geçersiz ders" üretir, burada fırlatılmaz)', async () => {
    vi.mocked(getClasses).mockResolvedValue([]);
    vi.mocked(getClass).mockResolvedValue(null);
    const pool = await levelPoolForStudent('yok-boyle-bir-sube', 'ilkokul');
    expect(pool).toEqual([]);
  });
});
