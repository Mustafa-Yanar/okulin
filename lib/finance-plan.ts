// Taksit planı matematiği — SAF (DB/istek bağlamı yok). Hem istemci (FinancePanel tutar
// dağıtımı) hem sunucu (POST /api/finance invariant kontrolü) BURADAN geçer; iki taraf
// aynı kuralı paylaşmazsa istemcinin ürettiği plan sunucuda 400 yerdi.
//
// INVARIANT: sum(taksit.amount) === netFee. Bu tutmazsa para plandan buharlaşır —
// taksitlerin tamamı ödense bile bakiye sıfırlanmaz (ya da öğrenci fazla öder).

// Kuruş hassasiyeti — Float alanlarda 0.1+0.2 sapmasını tek noktada toparlar.
export const kurus = (n: number): number => Math.round(n * 100) / 100;

export interface PlanRow {
  amount: number;
  paid?: boolean;
}

export const planToplami = (rows: readonly PlanRow[]): number =>
  kurus(rows.reduce((s, r) => s + (r.amount || 0), 0));

// Tolerans: tutarlar kuruşa yuvarlandığı için tam eşitlik beklenir; 0.01 yalnız
// kayan-nokta artığına pay bırakır (iş kuralı gevşetmesi DEĞİL).
export const PLAN_TOLERANS = 0.01;

// Plan geçerli mi? Geçersizse kullanıcıya gösterilecek Türkçe mesaj, geçerliyse null.
export function planHatasi(rows: readonly PlanRow[], netFee: number): string | null {
  if (!rows.length) return null; // peşin plan — taksit yok, kontrol edilecek bir şey de yok
  const toplam = planToplami(rows);
  if (Math.abs(toplam - kurus(netFee)) <= PLAN_TOLERANS) return null;
  return `Taksit toplamı (${toplam} TL) net ücrete (${kurus(netFee)} TL) eşit değil. Fark: ${kurus(toplam - netFee)} TL.`;
}

// Tutarları dağıt: ÖDENMİŞ taksitlerin tutarına DOKUNULMAZ (para zaten tahsil edildi,
// geçmişe dönük tutar değiştirmek makbuzla çelişir), kalan (netFee − ödenmiş toplamı)
// yalnız ÖDENMEMİŞ taksitlere eşit bölünür; yuvarlama artığı son ödenmemiş taksite yazılır.
//
// Eski davranış (hata): net ücret TÜM taksitlere bölünüyor ama ödenmişler eski tutarını
// koruyordu → 9×10.000 planda 1 taksit ödenmişken ücret 180.000'e çıkarılınca toplam
// 170.000'e düşüyor, 10.000 TL sessizce kayboluyordu.
//
// Hepsi ödenmişse dağıtacak yer yoktur → satırlar aynen döner ve plan toplamı netFee'den
// sapabilir; bu durumda planHatasi() 400 üretir (doğru davranış: müdür taksit EKLEMELİ).
export function dagitTutar<T extends PlanRow>(rows: readonly T[], netFee: number): T[] {
  const odenmemis = rows.map((r, i) => (r.paid ? -1 : i)).filter((i) => i >= 0);
  if (!odenmemis.length) return rows.slice();
  const odenmisToplam = rows.reduce((s, r) => (r.paid ? s + (r.amount || 0) : s), 0);
  const kalan = Math.max(0, kurus(netFee - odenmisToplam));
  const per = kurus(kalan / odenmemis.length);
  const son = odenmemis[odenmemis.length - 1];
  return rows.map((r, i) =>
    r.paid ? r : { ...r, amount: i === son ? kurus(kalan - per * (odenmemis.length - 1)) : per }
  );
}
