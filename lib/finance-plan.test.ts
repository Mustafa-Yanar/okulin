import { describe, it, expect } from 'vitest';
import { dagitTutar, planHatasi, planToplami, kurus } from './finance-plan';

const row = (amount: number, paid = false) => ({ amount, paid });

describe('planToplami', () => {
  it('kuruş artığını toparlar', () => {
    expect(planToplami([row(0.1), row(0.2)])).toBe(0.3);
  });
  it('boş plan 0', () => {
    expect(planToplami([])).toBe(0);
  });
});

describe('planHatasi — invariant sum(taksit) === netFee', () => {
  it('eşitse hata yok', () => {
    expect(planHatasi([row(5000), row(5000)], 10000)).toBeNull();
  });
  it('peşin plan (taksit yok) kontrol edilmez', () => {
    expect(planHatasi([], 10000)).toBeNull();
  });
  it('eksik toplam yakalanır', () => {
    const e = planHatasi([row(5000), row(4000)], 10000);
    expect(e).toContain('9000');
    expect(e).toContain('10000');
  });
  it('fazla toplam yakalanır', () => {
    expect(planHatasi([row(6000), row(5000)], 10000)).not.toBeNull();
  });
  it('kayan-nokta artığı (0.01) tolere edilir, kural gevşemez', () => {
    expect(planHatasi([row(3333.33), row(3333.33), row(3333.34)], 10000)).toBeNull();
    expect(planHatasi([row(3333.33), row(3333.33), row(3333.33)], 10000.5)).not.toBeNull();
  });
});

describe('dagitTutar', () => {
  it('hiç ödenmemişse eşit böler, artık son taksitte', () => {
    const out = dagitTutar([row(0), row(0), row(0)], 10000);
    expect(out.map((r) => r.amount)).toEqual([3333.33, 3333.33, 3333.34]);
    expect(planToplami(out)).toBe(10000);
  });

  // Denetim damar-3 kök bulgusu: eskiden net ücret TÜM taksitlere bölünüyor ama ödenmişler
  // eski tutarını koruyordu → 9×10.000 planda 1 taksit ödenmişken ücret 180.000'e
  // çıkarılınca toplam 170.000'e düşüyor, 10.000 TL sessizce kayboluyordu.
  it('ödenmiş taksitin tutarına dokunmaz, KALANI ödenmemişlere böler', () => {
    const plan = [row(10000, true), ...Array.from({ length: 8 }, () => row(10000))];
    const out = dagitTutar(plan, 180000);
    expect(out[0].amount).toBe(10000);          // ödenmiş — makbuzla çelişmemeli
    expect(out.slice(1).every((r) => r.amount === 21250)).toBe(true); // 170000 / 8
    expect(planToplami(out)).toBe(180000);      // INVARIANT korunur
    expect(planHatasi(out, 180000)).toBeNull();
  });

  it('ödenmiş toplamı net ücreti aşarsa kalan 0 (negatif taksit üretmez)', () => {
    const out = dagitTutar([row(9000, true), row(1000)], 5000);
    expect(out[0].amount).toBe(9000);
    expect(out[1].amount).toBe(0);
  });

  // Hepsi ödenmişken dağıtılacak yer yok → satırlar aynen döner ve plan toplamı sapabilir.
  // Bu BİLİNÇLİ: sunucu 400 verir, müdür taksit EKLEMELİ (ödenmiş tutarı geçmişe dönük
  // değiştirmek makbuzla çelişirdi).
  it('hepsi ödenmişse dokunmaz ve invariant ihlali sunucuya taşınır', () => {
    const plan = [row(5000, true), row(5000, true)];
    const out = dagitTutar(plan, 12000);
    expect(out.map((r) => r.amount)).toEqual([5000, 5000]);
    expect(planHatasi(out, 12000)).not.toBeNull();
  });

  it('ara taksit ödenmişse artık SON ÖDENMEMİŞ taksite yazılır', () => {
    const out = dagitTutar([row(0), row(1000, true), row(0)], 10000);
    expect(out[1].amount).toBe(1000);
    expect(out[0].amount).toBe(4500);
    expect(out[2].amount).toBe(4500);
    expect(planToplami(out)).toBe(10000);
  });

  it('tek ödenmemiş taksit kalanın tamamını alır', () => {
    const out = dagitTutar([row(3000, true), row(0)], 10000);
    expect(out[1].amount).toBe(7000);
  });

  it('girdiyi mutasyona uğratmaz', () => {
    const plan = [row(0), row(0)];
    dagitTutar(plan, 10000);
    expect(plan.map((r) => r.amount)).toEqual([0, 0]);
  });
});

describe('kurus', () => {
  it('ikinci basamağa yuvarlar', () => {
    expect(kurus(3333.3333)).toBe(3333.33);
    expect(kurus(0.1 + 0.2)).toBe(0.3);
  });
});
