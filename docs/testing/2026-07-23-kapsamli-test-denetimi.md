# Okulin kapsamlı test denetimi — ilk güvenli temel

Tarih: 23 Temmuz 2026

Bu belge, sistemi “çalışıyor mu?” düzeyinden çıkarıp ilişkilerin doğru, tutarlı ve güvenli
olduğunu sürekli sınayan bir düzene taşıma çalışmasının ilk kontrol noktasıdır.

## Değişmez güvenlik sınırı

- `akyazicozum.okulin.com` gerçek kurumdur. Bu denetimde bu alan adına hiçbir HTTP isteği
  gönderilmedi; veritabanı ve Redis verisi okunmadı veya değiştirilmedi.
- Dinamik testler yalnız bilgisayardaki `okulin_test` PostgreSQL veritabanında çalıştı.
- Yerel test sarmalayıcısı veritabanı adını `okulin_test*` ile sınırlar ve Redis isteklerini
  yalnız bellekte çalışan yerel taklide sabitler. Böylece `.env` içindeki canlı bağlantılara
  sessizce düşemez.
- Playwright hedefi açıkça verilmezse test başlamaz. Akyazı hedefi verilse bile kesin olarak
  reddedilir. Canlı `testkurs` hedefi ayrıca açık onay değişkeni ister.

## Sistemin ölçülen büyüklüğü

- 50 Prisma veri modeli
- 92 API route dosyası, 169 HTTP handler
- Merkezi `withAuth` ve mobil yetki katmanlarının dışında kalan 20 bilinçli/açık API kapısı
- Doğrudan Prisma kullanan 9 özel route
- Standart `parseBody` doğrulamasından farklı çalışan 15 mutasyon kapısı
- 101 mevcut Playwright E2E senaryosu

Bu sayılar mimari sözleşme testine bağlandı. Yeni route, özel yetki kapısı, doğrudan Prisma
erişimi veya standart dışı gövde işleme eklendiğinde test bilinçli allowlist güncellemesi ister.

## Tamamlanan kontroller

| Katman | Sonuç |
|---|---:|
| Prisma şema doğrulaması | Geçti |
| TypeScript strict kontrolü | Geçti |
| Ana uygulama birim/sözleşme testleri | 457 / 457 geçti |
| Mobil tip kontrolü | Geçti |
| Mobil testler | 45 / 45 geçti |
| Yerel PostgreSQL entegrasyon testleri | 10 / 10 geçti |
| Üretim derlemesi | Geçti |
| ESLint | 0 hata, 37 uyarı |
| Yerel tarayıcı rol testi | 8 / 8 rol geçti |
| Rol erişim matrisi | 34 / 34 karar geçti |
| Güvenli yerel Playwright E2E paketi | 95 / 95 geçti |
| CP-SAT yerel çözücü senaryoları | 13 senaryoda kural ihlali yok |

Yerel tarayıcı testinde müdür, müdür yardımcısı, rehber, muhasebe, kurum yöneticisi,
öğretmen, öğrenci ve veli ayrı oturumlarda sınandı. Dış ağ isteği, HTTP 5xx veya tarayıcı
çalışma zamanı hatası görülmedi. Veli kendi çocuğunun finansını okuyabildi, başka kuruma ait
öğrenci kimliğiyle okuyamadı.

## Bulunan ve bu dalda düzeltilen önemli sorunlar

### 1. Tekil kimlikle kurum sınırının aşılabilmesi

`tdb()` listeleme ve toplu işlemlerde kurum/şube filtresi ekliyordu; fakat `findUnique`,
`update`, `delete` ve `upsert` işlemleri yalnız global kimliğe güveniyordu. Başka kurumun
kimliği bir route'a sızarsa merkezi katman bunu kendi başına durdurmuyordu.

Merkezi veri erişim katmanı tüm bu işlemlerde kurum ve şubeyi zorunlu kılacak şekilde
sertleştirildi. Entegrasyon testi başka kurumun kimliğiyle okuma, güncelleme ve silmenin
reddedildiğini; aynı kurumda normal işlemlerin bozulmadığını kanıtlıyor.

### 2. PayTR callback tutar eşleşmesi yoktu

Callback HMAC imzası doğrulanıyordu; fakat PayTR'nin bildirdiği kuruş tutarı, `PayOrder`
kaydındaki beklenen tutarla karşılaştırılmıyordu. Artık imza doğru olsa bile tutar uyuşmazsa
kredilendirme yapılmıyor.

Ayrıca aynı geçerli callback'in eşzamanlı iki kez gelmesi test edildi: yalnız bir ödeme
ledger kaydı oluştu, yalnız bir taksit kapandı ve sipariş bir kez `paid` oldu.

### 3. CRON_SECRET tanımsızken yanlış yetkilendirme ihtimali

Eski karşılaştırmada ortam değişkeni tanımsızsa `Authorization: Bearer undefined` değeri
teorik olarak kabul edilebilirdi. Beş cron/yedek route'u ortak, fail-closed yardımcıya alındı.
Secret yoksa hiçbir değer yetkili sayılmıyor.

### 4. Testlerin sessizce canlı hedefe gitmesi

Eski Playwright yapılandırması hedef verilmezse canlı `testkurs.okulin.com` adresini seçiyordu.
Bu varsayılan ve E2E dosyalarındaki gömülü hedef/kullanıcı şifresi fallback'leri kaldırıldı.

### 5. Kalite kapısındaki iki gerçek hata

Kullanılmayan yedekleme fonksiyonu ve Next.js'in özel `module` adıyla çakışan değişken
temizlendi. ESLint artık hata koduyla düşmüyor.

## Açık kalan yapısal riskler

### A. Kurum tutarlılığı her ilişkide veritabanı tarafından zorlanmıyor

Şemada 17 fiziksel foreign key var. `Guidance`, `Hedef`, `Topic`, `PayOrder` ve
`EtutSablon→Teacher` gibi bazı kritik ilişkiler kurum+şubeyi composite foreign key ile
doğrudan doğruluyor. Fakat aşağıdaki ilişkiler ebeveyni yalnız global kimlikle bağlıyor:

- Student → Class
- Finance → Student
- Behavior → Student
- SlotBooking → Teacher
- Attendance → Teacher
- AnnouncementRecipient → Announcement
- EtutReservation → EtutSablon

Yerel sentetik veride bu yedi ilişkide kurum/şube uyuşmazlığı sıfırdır ve her entegrasyon
koşusunda denetlenir. Ancak temiz tasarımda bunların da composite foreign key olması gerekir.
Bu değişiklik ortak canlı şemayı etkiler. Akyazı verisine dokunma yasağı varken canlı ön
kontrol/migration yapmak bu çalışmanın yetki alanı dışındadır; bu nedenle “çözüldü” sayılmadı.

### B. PostgreSQL Row Level Security yok

Kurum izolasyonu uygulama katmanındaki `tdb()` ile sağlanıyor. Merkezi katman sertleştirildi,
fakat veritabanı seviyesinde ikinci savunma hattı (RLS) bulunmuyor.

### C. Ödeme siparişi `processing` durumunda kalabilir

Normal altyapı hatasında kod siparişi `pending` durumuna geri alıyor. Fakat sunucu işlem
claim'inden hemen sonra tamamen kapanırsa catch çalışmaz ve sipariş kalıcı `processing`
kalabilir. Zaman damgalı stale-claim kurtarma tasarımı eklenmeli.

### D. Yedek geri-yükleme ve snapshot tutarlılığı kanıtlanmadı

Yedek tüm modelleri sırayla okuyor; tek transaction snapshot'ı değil. Yük altında tabloların
farklı anlarını yakalayabilir. “Yedek alındı” testi tek başına yeterli değildir; boş yerel DB'ye
geri yükleyip satır/ilişki checksum karşılaştırması yapılmalıdır.

### E. Arayüz uyarıları

Kalan 37 lint uyarısının 19'u React hook/memo bağımlılığıdır; bayat veri veya gereksiz yeniden
çalışma riski taşıyabilir. 18'i görsel optimizasyon/erişilebilirlik uyarısıdır. Körlemesine
değiştirilmemeli; ilgili ekranın davranış testiyle birlikte ele alınmalıdır.

### F. Ön yüz yükü

Ana sayfanın ilk yük JavaScript'i üretim derlemesinde yaklaşık 516 kB'dir. İşlevsel hata
değildir; düşük donanımlı telefonlarda açılış süresi için ölçüm ve parça yükleme çalışması ister.

### G. E2E paketinin iki dış altyapı senaryosu yerel pakete dahil değil

20 E2E spec dosyasının tamamı makine-denetimli güvenlik sınıfına ayrıldı. Bunların 18'i,
yerel PostgreSQL ve bellekte çalışan yerel Redis taklidi üzerinde setup dahil 95/95 geçti.
Paket; gerçek tarayıcı panel turu, duyuru/etüt/ödev/yoklama çapraz-rol akışları, SQL
okuma-yazma, kurum kodu, mobil oturum yenileme/iptal, cihaz devri, rate-limit, IDOR, CSRF,
para türleri ve ödeme callback zincirini kapsıyor.

Kalan 2 dosyanın biri Cloud Run çözücüsünü, diğeri Vercel geçici alan adı işlemini istiyor.
Bunlar dış sisteme temas ettikleri için varsayılan yerel pakete giremez. Vercel altyapı
mutasyonu ayrıca `OKULIN_ALLOW_INFRA_E2E=YES` açık onayı olmadan canlı E2E'de de çalışmaz.

### H. Güncel bağımlılık açıkları taraması bekliyor

`npm audit`, bağımlılık envanterini npm hizmetine göndereceği için dışa aktarım onayı olmadan
çalıştırılmadı. Bu kontrol için açık kullanıcı onayı gerekir.

## Sonraki güvenli sıra

1. Öğrenci/veli/öğretmen IDOR ve rol bazlı tüm mutasyonlar için negatif test matrisi kur.
2. Etüt, yoklama, program, ödev, duyuru, rehberlik ve finans için oluştur→oku→güncelle→sil
   iş akışlarını zengin sentetik seed üzerinde tamamla.
3. Backup→boş DB restore→checksum ve fault-injection testini kur.
4. `processing` ödeme kurtarma ve callback gözlemlenebilirliğini ekle.
5. Composite tenant foreign key/RLS tasarımını ayrı migration planı yap; Akyazı'yı etkileyen
   hiçbir adımı açık kapsam değişikliği olmadan uygulama.
6. React hook uyarılarını ekran ekran davranış testiyle azalt.
7. Yerel test paketleri yeşil olduktan sonra yalnız testkurs için preview/canlı smoke katmanı kur.

## Tekrarlanabilir komutlar

- `npm run verify:static` — şema, TypeScript, ana ve mobil testler
- `npm run test:db:push` — yalnız güvenlik kilitli `okulin_test` şemasını eşitler
- `npm run test:db:seed` — yalnız yerel DB'yi iki sentetik kurumla sıfırlar
- `npm run test:integration` — kurum izolasyonu, ilişkiler, finans ve callback yarış testleri
- `npm run test:e2e:local` — seed + yerel PostgreSQL/Redis taklidi + sınıflandırılmış 95 E2E testi
- `npm run lint` — kalite kapısı
- `npm run build` — üretim derlemesi

Bu belge bir “sistem tamamen temiz” sertifikası değildir. İlk amaç, hangi sonucun gerçekten
kanıtlandığını ve hangi riskin hâlâ açık olduğunu birbirinden ayıran güvenilir zemini kurmaktır.
