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

// Para eşitliği — FARKIN KENDİSİ de yuvarlanır. Çıplak `Math.abs(a-b) <= 0.01` yetmez:
// |3333.34 − 3333.33| = 0.010000000000218 > 0.01 çıkar ve tolerans işlevini yitirir.
export const esitTutar = (a: number, b: number): boolean => Math.abs(kurus(a - b)) <= PLAN_TOLERANS;

// Plan geçerli mi? Geçersizse kullanıcıya gösterilecek Türkçe mesaj, geçerliyse null.
export function planHatasi(rows: readonly PlanRow[], netFee: number): string | null {
  if (!rows.length) return null; // peşin plan — taksit yok, kontrol edilecek bir şey de yok
  const toplam = planToplami(rows);
  if (esitTutar(toplam, netFee)) return null;
  return `Taksit toplamı (${toplam} TL) net ücrete (${kurus(netFee)} TL) eşit değil. Fark: ${kurus(toplam - netFee)} TL.`;
}

// ── ÖDENMİŞ TAKSİT KİLİDİ ────────────────────────────────────────────────────
// Kural (Mustafa kararı 2026-07-22): makbuzu kesilmiş bir taksitin tutarı/tarihi
// geçmişe dönük DEĞİŞTİRİLEMEZ ve taksit sayısı azaltılarak SİLİNEMEZ — aksi halde
// plan makbuzla çelişir. İstemci girdileri zaten disabled; bu sunucu tarafı kapıdır
// (eskiden hiç kontrol yoktu: ödenmiş 10.000'lik taksit 20.000 yapılabiliyor,
// paid=true/paidAmount=10000 kalıyordu — ödenmişlik İNDEKSLE taşındığı için).

export interface OdenmisRow extends PlanRow {
  idx: number;
  dueDate?: string | null;
  paidAmount?: number | null;
}

// Ödenmiş taksitlerin korunup korunmadığını denetler. Geçersizse Türkçe mesaj, geçerliyse null.
export function odenmisTaksitHatasi(onceki: readonly OdenmisRow[], yeni: readonly OdenmisRow[]): string | null {
  const yeniByIdx = new Map(yeni.map((r) => [r.idx, r]));
  for (const prev of onceki) {
    if (!prev.paid) continue;
    const now = yeniByIdx.get(prev.idx);
    if (!now) return `${prev.idx + 1}. taksit ödenmiş — taksit sayısı azaltılarak silinemez.`;
    if (!esitTutar(now.amount || 0, prev.amount || 0)) {
      return `${prev.idx + 1}. taksit ödenmiş — tutarı değiştirilemez (${kurus(prev.amount)} TL).`;
    }
    if ((now.dueDate || '') !== (prev.dueDate || '')) {
      return `${prev.idx + 1}. taksit ödenmiş — vade tarihi değiştirilemez (${prev.dueDate}).`;
    }
  }
  return null;
}

// En son ödenmiş taksitin indeksi (-1 = hiç yok). İstemci taksit sayısını bunun altına
// düşürmeyi engeller → sunucu kapısı normal akışta tetiklenmez.
export const sonOdenmisIdx = (rows: readonly OdenmisRow[]): number =>
  rows.reduce((m, r) => (r.paid && r.idx > m ? r.idx : m), -1);

// ── GENEL ÖDEME TUTARI ───────────────────────────────────────────────────────
// Kural (Mustafa kararı 2026-07-22): dershanede kısmi taksit ödemesi alınmıyor.
// "Genel ödeme" (taksit seçmeden serbest tutar) açık taksitleri BAŞTAN İTİBAREN
// tam sayıda kapatmalı. Eskiden serbest tutar kabul ediliyordu ve taksitten azsa
// hiçbir taksit kapanmıyordu → taksit sonsuza dek "gecikmiş" görünüyor, yanlış senet
// basılıyordu; tutar birkaç taksiti karşılasa bile YALNIZ İLKİ kapanıyordu.
// Döner: kapatılacak taksit sayısı (>=1) veya eşleşme yoksa null.
export function kapanacakTaksitSayisi(acikTaksitler: readonly PlanRow[], tutar: number): number | null {
  let kum = 0;
  for (let n = 0; n < acikTaksitler.length; n++) {
    kum = kurus(kum + (acikTaksitler[n].amount || 0));
    if (esitTutar(tutar, kum)) return n + 1;
    if (kum > tutar) return null; // tutar bir taksitin ortasında kaldı → kısmi ödeme
  }
  return null; // tutar tüm açık taksitleri aşıyor
}

// Kabul edilen genel-ödeme tutarları (kullanıcıya gösterilecek kümülatif liste).
export function kabulEdilenTutarlar(acikTaksitler: readonly PlanRow[]): number[] {
  const out: number[] = [];
  let kum = 0;
  for (const t of acikTaksitler) { kum = kurus(kum + (t.amount || 0)); out.push(kum); }
  return out;
}

// ── TAKSİT TARİHİ YENİDEN AKIŞI ──────────────────────────────────────────────
// Bir taksit tarihi ELLE değişince o taksitten SONRAKİLER yeni tarihten aylık yeniden
// dağıtılır (Mustafa isteği 2026-07-24: muhasebeci ilk N tarihi elle girer, kalanı
// otomatik akar; sırayla girildiğinde son elle girilenden sonrası hep otomatik kalır).
// Kurallar:
// - Düzenlenen satırdan ÖNCEKİ satırlar değişmez (elle girilmişleri korur).
// - ÖDENMİŞ satırın tarihi değişmez (makbuz kilidi — sunucu da reddeder), atlanan
//   ödenmiş satır aylık sayacı kaydırmaz: j. satır = yeniTarih + (j - idx) ay.
// - Ay ekleme JS setMonth taşmasıyla buildInstallments ile AYNI davranır (31 Oca + 1 ay → 3 Mar).
export interface TarihRow { dueDate: string; paid?: boolean; }

const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function dagitTarihler<T extends TarihRow>(rows: readonly T[], idx: number, yeniTarih: string): T[] {
  // Ödenmiş satır HİÇBİR dalda değişmez — düzenlenen satırın kendisi dahil (UI zaten
  // disabled eder; bu saf fonksiyonun kendi kilididir, sunucu da böyle kaydı reddeder).
  if (rows[idx]?.paid) return rows.slice();
  // Boş giriş (kullanıcı tarihi silerken): yalnız o satır güncellenir, akış tetiklenmez.
  if (!yeniTarih) return rows.map((x, j) => (j === idx ? { ...x, dueDate: yeniTarih } : x));
  const base = new Date(yeniTarih + 'T00:00:00');
  return rows.map((x, j) => {
    if (j < idx) return x;
    if (j === idx) return { ...x, dueDate: yeniTarih };
    if (x.paid) return x;
    const d = new Date(base);
    d.setMonth(d.getMonth() + (j - idx));
    return { ...x, dueDate: ymd(d) };
  });
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
