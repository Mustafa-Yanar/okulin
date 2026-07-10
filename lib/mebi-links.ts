// Ücretsiz, herkese açık MEB / MEBİ eğitim kaynakları — küratörlü LİNK listesi.
//
// İLKE (önemli): MEB içeriği "ticari amaçla kullanılamaz" → KOPYALAMA / GÖMME YOK,
// yalnızca yönlendirme (yeni sekmede aç). İçerik bizde tutulmaz; LMS Kütüphane'de
// "Ücretsiz Eğitim Kaynakları" rafında salt-link olarak gösterilir.
//
// Statik + kurum-bağımsız (Redis yok, istemci-güvenli). URL'ler doğrulanmış gerçek giriş
// noktalarıdır; MEBİ modülleri (YKS/LGS/Okul Dersleri) e-Devlet/EBA girişi arkasında tek
// platformdan akar → kararsız deep-link yerine ana giriş + tamamlayıcı MEB platformları.

export interface MebiLink {
  id: string;
  title: string;
  desc: string;
  url: string;
  tag: string;
}

export const MEBI_LINKS: MebiLink[] = [
  {
    id: 'mebi',
    title: 'MEBİ — Bireysel Öğrenme Platformu',
    desc: 'Konu anlatım videoları, çıkmış sorular, adaptif test, YKS/LGS hazırlık, çalışma planı ve KANKA yapay zeka asistanı. e-Devlet / EBA ile giriş.',
    url: 'https://mebi.eba.gov.tr',
    tag: 'Tüm seviyeler',
  },
  {
    id: 'eba',
    title: 'EBA — Eğitim Bilişim Ağı',
    desc: 'MEB ders içerikleri, dijital kitaplar, video dersler ve kütüphane.',
    url: 'https://www.eba.gov.tr',
    tag: 'Tüm seviyeler',
  },
  {
    id: 'ogm',
    title: 'OGM Materyal',
    desc: 'Kazanım testleri, beceri temelli sorular, ders föyleri ve YKS puan hesaplama.',
    url: 'https://ogmmateryal.eba.gov.tr',
    tag: 'Lise · Mezun',
  },
  {
    id: 'odsgm',
    title: 'ÖDSGM — Örnek Sorular',
    desc: 'MEB Ölçme ve Değerlendirme: örnek sorular, LGS örnek soru kitapçıkları, e-sınav.',
    url: 'https://odsgm.meb.gov.tr',
    tag: 'Ortaokul · Lise',
  },
  {
    id: 'osym',
    title: 'ÖSYM',
    desc: 'TYT / AYT çıkmış sorular, sınav kılavuzları ve sınav takvimi.',
    url: 'https://www.osym.gov.tr',
    tag: 'Lise · Mezun',
  },
];
