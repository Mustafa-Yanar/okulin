# Okulin kurum foreign key ve RLS geçiş planı

Tarih: 23 Temmuz 2026

Bu belge, kurumlar arası veri karışmasını uygulama kodundan bağımsız olarak PostgreSQL'in de
engellemesi için güvenli geçiş sırasını tanımlar. `testkurs` ve Akyazı aynı tabloları kullandığı
için burada anlatılan canlı şema adımları yalnız bir kuruma uygulanamaz.

## Şu anda yerelde kanıtlanan katman

Aşağıdaki yedi bağ Prisma şemasında `kurum + şube + kimlik` birleşik foreign key'ine çevrildi:

1. Student → Class
2. Finance → Student
3. Behavior → Student
4. SlotBooking → Teacher
5. Attendance → Teacher
6. AnnouncementRecipient → Announcement
7. EtutReservation → EtutSablon

`okulin_test` üzerinde her çocuk kaydının kurumu kasıtlı olarak başka kuruma çevrilmeye
çalışıldı. PostgreSQL yedi işlemin tamamını `P2003 / foreign key violation` ile reddetti.
Mevcut doğru oluşturma, okuma, ödeme, yedek ve geri-yükleme testleri de geçmeye devam etti.

Bu değişiklik henüz canlı veritabanına uygulanmadı ve bu dal canlıya gönderilmedi.

## Canlı composite foreign key geçiş kapısı

Canlı uygulamadan önce aşağıdaki sıra bölünmeden izlenmelidir:

1. Aynı gün alınmış tam SQL yedeği izole bir şemaya geri yüklenir; tablo sayıları ve içerik
   özetleri kaynakla eşleştirilir.
2. Yedi ilişki için salt-okunur kurum/şube uyuşmazlık sorgusu çalıştırılır. Tek bir satır bile
   bulunursa migration başlamaz; kayıt önce iş kuralı sahibiyle incelenir.
3. Ebeveyn tablolardaki birleşik unique index'ler `CONCURRENTLY` oluşturulur. Böylece uzun
   tablo kilidi riski azaltılır.
4. Composite foreign key'ler önce `NOT VALID` olarak eklenir. Yeni yanlış yazmalar o andan
   itibaren engellenir; mevcut satırların uzun doğrulaması ayrı yürür.
5. Her constraint tek tek `VALIDATE CONSTRAINT` ile doğrulanır. Kilit ve sorgu süreleri
   gözlenir; başarısız olan adımda uygulama kodu deploy edilmez.
6. Prisma şemasıyla uyumlu kod deploy edilir ve yalnız sentetik testkurs hesaplarıyla rol,
   ödeme, etüt, yoklama ve program smoke testleri çalıştırılır.
7. En az bir tam iş günü hata oranı, foreign key ihlali ve yavaş sorgu takibi yapılır.

Prisma `db push`, `CONCURRENTLY` ve aşamalı `NOT VALID → VALIDATE` akışını ifade etmediği
için canlı geçiş tek komutluk `db push` olarak yapılmamalıdır. İncelenebilir SQL migration
dosyası ve açık bakım onayı gerekir.

## RLS neden bugün açılamaz

Mevcut `tdb()` katmanı her sorgunun `where/data` alanına kurum ve şube ekliyor. PostgreSQL
RLS ise bağlantı üzerinde güvenilir bir kurum bağlamı ister. Vercel/Neon bağlantı havuzunda
oturum seviyesinde `SET app.org=...` kullanmak güvenli değildir: aynı fiziksel bağlantı daha
sonra başka kurum isteğine verilebilir.

Güvenli bağlam yalnız transaction içinde `set_config(..., true)` ile kurulabilir. Bu da her
tenant sorgusunun aynı transaction içinde çalışmasını gerektirir. Mevcut kodda tek sorgular,
çok sorgulu transaction'lar, ödeme callback'i, mobil oturumlar, kurumlar arası cron'lar ve tam
yedek farklı erişim yolları kullanıyor. RLS'yi bunları dönüştürmeden açmak veri sızıntısından
çok tüm sorguların boş dönmesi veya hata vermesi riski taşır.

Ayrıca veritabanı sahibi rol, `FORCE ROW LEVEL SECURITY` yoksa politikaları atlayabilir.
Gerçek ikinci savunma hattı için uygulama ve bakım/yedek işlemleri aynı veritabanı rolünü
kullanmamalıdır.

## Gerekli hedef mimari

- `app_tenant` rolü: tablo sahibi olmayan, RLS'yi atlayamayan normal uygulama rolü.
- `app_admin` rolü: yalnız migration, tam yedek/geri-yükleme ve denetlenmiş kurumlar arası
  bakım işleri için; normal HTTP route'larında kullanılamaz.
- `withTenantTransaction(org, branch, fn)`: transaction açar, ilk komut olarak transaction
  kapsamlı `app.current_org` ve `app.current_branch` değerlerini yazar, bütün tenant sorgularını
  aynı transaction client'ı üzerinden çalıştırır.
- Varsayılan-red politikası: bağlam yoksa tenant tablolarında hiçbir satır okunamaz/yazılamaz.
- `WITH CHECK`: ekleme ve güncellemede hem kurum hem şube aktif bağlamla eşleşmek zorundadır.
- Kurum kolonu taşımayan çocuk tablolar için ebeveyn üzerinden `EXISTS` politikası veya daha
  temiz uzun vadeli seçenek olarak çocuk tablolara da `orgSlug/branch` eklenmesi.

## RLS tablo sınıfları

1. **Doğrudan tenant tabloları:** `orgSlug + branch` taşıyan Student, Teacher, Finance,
   Attendance, Etut*, Announcement* ve benzeri iş tabloları.
2. **Ebeveyn üzerinden tenant çocukları:** TeacherPreset, Installment, BehaviorEntry, ExamRow
   ve FormResponse. Politika ebeveyn kaydının tenant'ını doğrulamalıdır.
3. **Kurum düzeyi ama şubesiz tablolar:** Branch ve OrgAdmin. Yalnız `app.current_org` ile
   korunmalıdır.
4. **Gerçek global tablolar:** Org, SuperAdmin, DemoRequest ve MobileAppConfig. Bunlar tenant
   politikasına alınmamalı; ayrıca normal tenant rolünün erişimi en dar yetkide tutulmalıdır.
5. **Kurumlar arası bakım yolları:** backup, restore, tüm-kurum cron ve superadmin işlemleri.
   Yalnız ayrı admin client üzerinden ve denetim kaydıyla çalışmalıdır.

## RLS doğrulama matrisi

RLS ancak aşağıdaki testlerin tamamı ayrı bir preview veritabanında geçerse canlı adayıdır:

- Bağlam yok: tenant tablosu okuma/yazma reddedilir.
- `testkurs/main` bağlamı: yalnız testkurs/main satırları görünür.
- Aynı kurum başka şube: satırlar görünmez ve kimlikle güncelleme reddedilir.
- Başka kurum kimliği bilinse bile find/update/delete sonucu yoktur.
- Nested create, upsert, createMany ve raw SQL ile çapraz kurum yazımı reddedilir.
- Transaction içinde kurum bağlamı değiştirilemez veya ikinci kurum verisi görülemez.
- Paralel 100 istek iki kurum arasında bağlam sızıntısı üretmez.
- Ödeme callback'i siparişteki açık tenant bağlamıyla çalışır; host/header'a güvenmez.
- Tenant cron her kurum için ayrı transaction açar.
- Tenant rolü tam yedek alamaz; admin rolü bütün kurumları eksiksiz yedekleyebilir.
- Connection pool bağlantısı yeniden kullanıldığında önceki kurum bağlamı kalmaz.

## Geri dönüş düzeni

Composite foreign key geçişinde kod deploy edilmeden önce sorun çıkarsa yeni constraint'ler
isimleri açıkça belirtilerek düşürülür; eklenen unique index'ler ancak eski foreign key'ler
geri kurulduktan sonra kaldırılır. RLS geçişinde politika etkinleştirme ayrı son adım olmalıdır;
uygulama rolü/transaction dönüşümü geri alınmadan önce `DISABLE ROW LEVEL SECURITY` ile
erişim geri açılabilir. Her geri dönüş izole geri-yükleme tatbikatıyla önceden denenmelidir.

## Karar

Composite foreign key kodu ve yerel kanıtı hazırdır. Canlı uygulama ortak tabloları etkilediği
için Akyazı'ya dokunmama sınırı altında beklemelidir. RLS ise yalnız bir SQL ayarı değildir;
önce bağlantı rolleri ve transaction tabanlı veri erişim katmanı ayrı bir çalışma olarak
kurulmalıdır. Bugün RLS'yi açmamak eksik test değil, mevcut mimaride güvenli karardır.
