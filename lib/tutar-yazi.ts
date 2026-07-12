// Sayı → Türkçe yazı dönüştürücü. Muhasebe belgelerinde (taksit senedi + tahsilat
// makbuzu) tutarın yazıyla yazılması yasal/geleneksel gereklilik.
// Örn: 15000 → "On Beş Bin", 5500,50 → "Beş Bin Beş Yüz Türk Lirası Elli Kuruş".
// Okunaklılık için boşluklu + Title Case (matbu "OnBeşBin" bitişik yerine).

const BIRLER = ['', 'Bir', 'İki', 'Üç', 'Dört', 'Beş', 'Altı', 'Yedi', 'Sekiz', 'Dokuz'];
const ONLAR = ['', 'On', 'Yirmi', 'Otuz', 'Kırk', 'Elli', 'Altmış', 'Yetmiş', 'Seksen', 'Doksan'];
// Grup ölçekleri: index = kaçıncı 3'lü grup (0=birler, 1=bin, 2=milyon...)
const OLCEK = ['', 'Bin', 'Milyon', 'Milyar', 'Trilyon', 'Katrilyon'];

// 0-999 arası üç haneli grubu yazıya çevirir. "Bir Yüz" değil sadece "Yüz".
function ucHane(n: number): string {
  const parts: string[] = [];
  const yuz = Math.floor(n / 100);
  const kalan = n % 100;
  const on = Math.floor(kalan / 10);
  const bir = kalan % 10;
  if (yuz > 0) {
    if (yuz > 1) parts.push(BIRLER[yuz]); // 100 → "Yüz", 200 → "İki Yüz"
    parts.push('Yüz');
  }
  if (on > 0) parts.push(ONLAR[on]);
  if (bir > 0) parts.push(BIRLER[bir]);
  return parts.join(' ');
}

// Tam sayıyı Türkçe okunuşa çevirir (negatifi yok sayar, tabanı Math.floor).
export function sayiyiYaziyaCevir(n: number): string {
  n = Math.floor(Math.abs(n));
  if (n === 0) return 'Sıfır';

  // En düşük 3'lü grup önce (0=birler, 1=bin, 2=milyon...).
  const gruplar: number[] = [];
  let x = n;
  while (x > 0) { gruplar.push(x % 1000); x = Math.floor(x / 1000); }

  const parts: string[] = [];
  for (let i = gruplar.length - 1; i >= 0; i--) {
    const g = gruplar[i];
    if (g === 0) continue;
    // "Bir Bin" değil sadece "Bin" (yalnız bin grubunda ve grup=1 ise).
    if (i === 1 && g === 1) {
      parts.push('Bin');
    } else {
      parts.push(ucHane(g));
      if (i > 0) parts.push(OLCEK[i]);
    }
  }
  return parts.join(' ');
}

export interface TutarYazi {
  lira: string;   // "Beş Bin Beş Yüz"
  kurus: string;  // "Elli" | "Sıfır"
  full: string;   // "Beş Bin Beş Yüz Türk Lirası Elli Kuruş"
}

// Para tutarını yazıyla TL + kuruş olarak döndürür. Makbuz/senet metni için.
// Kuruş float artığını Math.round ile 2 haneye sabitler (5500.1 → 10 kuruş).
export function tutariYaziyaCevir(tutar: number): TutarYazi {
  const neg = tutar < 0;
  const abs = Math.abs(tutar);
  const liraKisim = Math.floor(abs);
  const kurusKisim = Math.round((abs - liraKisim) * 100);
  // Yuvarlama 100'e taşarsa (ör. 4999.999 → 5000 lira, 0 kuruş) düzelt.
  const lira = kurusKisim === 100 ? sayiyiYaziyaCevir(liraKisim + 1) : sayiyiYaziyaCevir(liraKisim);
  const kurus = sayiyiYaziyaCevir(kurusKisim === 100 ? 0 : kurusKisim);
  const full = `${neg ? 'Eksi ' : ''}${lira} Türk Lirası ${kurus} Kuruş`;
  return { lira, kurus, full };
}
