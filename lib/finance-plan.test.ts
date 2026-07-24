import { describe, it, expect } from 'vitest';
import {
  dagitTutar, dagitTarihler, planHatasi, planToplami, kurus,
  kapanacakTaksitSayisi, kabulEdilenTutarlar, odenmisTaksitHatasi, sonOdenmisIdx,
} from './finance-plan';

const row = (amount: number, paid = false) => ({ amount, paid });
const irow = (idx: number, amount: number, paid = false, dueDate = '2026-0' + (idx + 1) + '-01') => ({ idx, amount, paid, dueDate });

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

// Kural: dershanede kısmi taksit ödemesi alınmıyor (Mustafa kararı 2026-07-22).
describe('kapanacakTaksitSayisi — genel ödeme tam taksit kapatmalı', () => {
  const acik = [row(5000), row(5000), row(3000)];

  it('tek taksit tutarı → 1 taksit kapanır', () => {
    expect(kapanacakTaksitSayisi(acik, 5000)).toBe(1);
  });
  it('iki taksiti karşılayan tutar → İKİSİ birden kapanır', () => {
    // Eski hata: tutar 10.000 olsa bile YALNIZ ilk taksit kapanıyordu.
    expect(kapanacakTaksitSayisi(acik, 10000)).toBe(2);
  });
  it('tamamı → hepsi kapanır', () => {
    expect(kapanacakTaksitSayisi(acik, 13000)).toBe(3);
  });
  it('kısmi tutar reddedilir', () => {
    expect(kapanacakTaksitSayisi(acik, 600)).toBeNull();
    expect(kapanacakTaksitSayisi(acik, 4999)).toBeNull();
  });
  it('taksit ortasında kalan tutar reddedilir', () => {
    expect(kapanacakTaksitSayisi(acik, 7000)).toBeNull();
  });
  it('tüm taksitleri aşan tutar reddedilir', () => {
    expect(kapanacakTaksitSayisi(acik, 20000)).toBeNull();
  });
  it('açık taksit yoksa eşleşme yok (çağıran serbest tutara izin verir — peşin plan)', () => {
    expect(kapanacakTaksitSayisi([], 5000)).toBeNull();
  });
  it('kuruş artığı tolere edilir', () => {
    expect(kapanacakTaksitSayisi([row(3333.33), row(3333.33)], 6666.66)).toBe(2);
  });
  it('kabul edilen tutarlar kümülatif listelenir', () => {
    expect(kabulEdilenTutarlar(acik)).toEqual([5000, 10000, 13000]);
  });
});

// Kural: makbuzu kesilmiş taksit geçmişe dönük değiştirilemez (Mustafa kararı 2026-07-22).
describe('odenmisTaksitHatasi — ödenmiş taksit kilidi', () => {
  const onceki = [irow(0, 10000, true), irow(1, 10000), irow(2, 10000)];

  it('ödenmemişler serbestçe değişir', () => {
    expect(odenmisTaksitHatasi(onceki, [irow(0, 10000, true), irow(1, 20000), irow(2, 5000)])).toBeNull();
  });
  it('ödenmiş taksitin tutarı değiştirilemez', () => {
    // Kök bulgu: ödenmişlik İNDEKSLE taşındığı için 10.000'lik ödenmiş taksit
    // 20.000 yapılınca paid=true/paidAmount=10000 kalıyordu.
    const e = odenmisTaksitHatasi(onceki, [irow(0, 20000, true), irow(1, 10000), irow(2, 10000)]);
    expect(e).toContain('1. taksit');
    expect(e).toContain('10000');
  });
  it('ödenmiş taksitin vadesi değiştirilemez', () => {
    const yeni = [{ ...irow(0, 10000, true), dueDate: '2027-01-01' }, irow(1, 10000), irow(2, 10000)];
    expect(odenmisTaksitHatasi(onceki, yeni)).toContain('vade');
  });
  it('ödenmiş taksit taksit sayısı azaltılarak silinemez', () => {
    const onceki2 = [irow(0, 10000), irow(1, 10000), irow(2, 10000, true)];
    expect(odenmisTaksitHatasi(onceki2, [irow(0, 15000), irow(1, 15000)])).toContain('silinemez');
  });
  it('hiç ödenmiş yoksa her şey serbest', () => {
    expect(odenmisTaksitHatasi([irow(0, 10000), irow(1, 10000)], [irow(0, 30000)])).toBeNull();
  });
  it('kuruş artığı tutar değişikliği sayılmaz', () => {
    expect(odenmisTaksitHatasi([irow(0, 3333.33, true)], [irow(0, 3333.34, true)])).toBeNull();
  });
});

describe('sonOdenmisIdx', () => {
  it('hiç ödenmiş yoksa -1', () => {
    expect(sonOdenmisIdx([irow(0, 100), irow(1, 100)])).toBe(-1);
  });
  it('en büyük ödenmiş indeksi döner (arada boşluk olsa da)', () => {
    expect(sonOdenmisIdx([irow(0, 100, true), irow(1, 100), irow(2, 100, true), irow(3, 100)])).toBe(2);
  });
});

describe('kurus', () => {
  it('ikinci basamağa yuvarlar', () => {
    expect(kurus(3333.3333)).toBe(3333.33);
    expect(kurus(0.1 + 0.2)).toBe(0.3);
  });
});

describe('dagitTarihler', () => {
  const drow = (dueDate: string, paid = false) => ({ dueDate, paid });

  it('düzenlenen taksitten sonrakiler yeni tarihten aylık akar, öncekiler değişmez', () => {
    const rows = [drow('2026-08-01'), drow('2026-09-05'), drow('2026-10-01'), drow('2026-11-01'), drow('2026-12-01')];
    const out = dagitTarihler(rows, 2, '2026-10-15');
    expect(out.map(r => r.dueDate)).toEqual(['2026-08-01', '2026-09-05', '2026-10-15', '2026-11-15', '2026-12-15']);
  });

  it('sırayla elle giriş: son elle girilenden sonrası otomatik kalır (10 taksit, ilk 3 elle)', () => {
    let rows = Array.from({ length: 10 }, (_, i) => drow(`2026-0${Math.min(9, i + 1)}-01`));
    rows = dagitTarihler(rows, 0, '2026-08-10');
    rows = dagitTarihler(rows, 1, '2026-09-20');
    rows = dagitTarihler(rows, 2, '2026-10-05');
    expect(rows.slice(0, 4).map(r => r.dueDate)).toEqual(['2026-08-10', '2026-09-20', '2026-10-05', '2026-11-05']);
    expect(rows[9].dueDate).toBe('2027-05-05'); // 3. taksit + 7 ay
  });

  it('sonraki ÖDENMİŞ taksitin tarihi değişmez, aylık sayaç kaymaz', () => {
    const rows = [drow('2026-08-01'), drow('2026-09-01', true), drow('2026-10-01'), drow('2026-11-01')];
    const out = dagitTarihler(rows, 0, '2026-08-15');
    expect(out.map(r => r.dueDate)).toEqual(['2026-08-15', '2026-09-01', '2026-10-15', '2026-11-15']);
  });

  it('ay sonu taşması JS setMonth ile aynı (31 Oca + 1 ay → 3 Mar; artık yıl değil)', () => {
    const out = dagitTarihler([drow('2026-01-31'), drow('2026-02-28'), drow('2026-03-31')], 0, '2026-01-31');
    expect(out.map(r => r.dueDate)).toEqual(['2026-01-31', '2026-03-03', '2026-03-31']);
  });

  it('yıl devri doğru akar', () => {
    const out = dagitTarihler([drow('2026-11-15'), drow('2026-12-15'), drow('2027-01-15')], 0, '2026-11-20');
    expect(out.map(r => r.dueDate)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
  });

  it('boş giriş yalnız o satırı günceller, akış tetiklenmez', () => {
    const out = dagitTarihler([drow('2026-08-01'), drow('2026-09-01')], 0, '');
    expect(out.map(r => r.dueDate)).toEqual(['', '2026-09-01']);
  });

  it('düzenlenen satırın KENDİSİ ödenmişse hiçbir şey değişmez (makbuz kilidi)', () => {
    const rows = [drow('2026-08-01', true), drow('2026-09-01')];
    expect(dagitTarihler(rows, 0, '2026-08-20').map(r => r.dueDate)).toEqual(['2026-08-01', '2026-09-01']);
    expect(dagitTarihler(rows, 0, '').map(r => r.dueDate)).toEqual(['2026-08-01', '2026-09-01']);
  });
});
