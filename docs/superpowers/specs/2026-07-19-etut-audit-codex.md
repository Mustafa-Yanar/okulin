# Etüt hafta-bazlı rezervasyon — CODEX BAĞIMSIZ DENETİMİ (2026-07-19)

> 3'lü denetimin (Codex+Gemini+Explore) TAMAMLANAN parçası. Gemini + Explore bilgisayar kapanınca yarım kaldı — akşam tekrar çalıştır.

## 1. Rezervasyon okuyan/yazan tüm üretim noktaları

### A. `etut-sablon` sistemi

Kalıcı kaynak: `Teacher.programTemplate.etutSablonlari` JSON. Rezervasyon bilgisi şu anda şablon elemanının doğrudan `studentId/studentName/...` alanlarında tutuluyor: [schema.prisma](/Users/mustafa/Workspace/active/okulin/prisma/schema.prisma:171), [slots.ts](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:50).

#### Backend ve servis

- [lib/etut/rezervasyon.ts:55](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:55) — `etut-sablon`, okuma. Öğrencinin “bu haftaki” rezervasyonlarını tüm öğretmen şablonlarından topluyor; fakat hafta ayrımı yalnız `pasifHaftalar` üzerinden, `studentId` doğrudan şablondan okunuyor.
- [lib/etut/rezervasyon.ts:68](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:68) — `etut-sablon`, rezervasyon yazma.
- [lib/etut/rezervasyon.ts:101](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:101) — hedef şablonu okuyor.
- [lib/etut/rezervasyon.ts:107](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:107) — aktiflik ve doluluk kontrolünü şablon seviyesindeki `studentId` ile yapıyor.
- [lib/etut/rezervasyon.ts:124](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:124) — saat/ders/matematik ailesi kontrolleri için yine şablon rezervasyonlarını okuyor.
- [lib/etut/rezervasyon.ts:137](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:137) — `studentId`, ders, atanma zamanı ve aktörü şablonun kendisine yazıyor.
- [lib/etut/rezervasyon.ts:150](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:150) — `etut-sablon`, rezervasyon iptal yazması.
- [lib/etut/rezervasyon.ts:157](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:157) — iptal sahipliğini şablondaki `studentId` üzerinden kontrol ediyor.
- [lib/etut/rezervasyon.ts:162](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:162) — rezervasyon alanlarını doğrudan şablondan siliyor.
- [lib/etut/rezervasyon.ts:184](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:184) — mobil rezervasyon listesini okuyor.
- [lib/etut/rezervasyon.ts:197](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:197) — tüm öğretmen şablonlarını tarıyor.
- [lib/etut/rezervasyon.ts:200](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:200) — `mine/booked` sonucunu şablon `studentId` alanından türetiyor.

- [app/api/etut-sablon/rezervasyon/route.ts:21](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/rezervasyon/route.ts:21) — web POST; `reserveEtut` üzerinden yazma.
- [app/api/etut-sablon/rezervasyon/route.ts:29](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/rezervasyon/route.ts:29) — web DELETE; `cancelEtut` üzerinden silme. DELETE şemasında `weekKey` yok: [route.ts:19](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/rezervasyon/route.ts:19).

- [app/api/etut-sablon/all/route.ts:13](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:13) — tüm paneller için haftalık liste okuması.
- [app/api/etut-sablon/all/route.ts:23](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:23) — öğretmen şablonlarını tek tek okuyor.
- [app/api/etut-sablon/all/route.ts:26](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:26) — haftayı yalnız efektif aktiflikte kullanıyor.
- [app/api/etut-sablon/all/route.ts:37](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:37) — rezervasyon sahibini şablon `studentId` alanından döndürüyor.
- [app/api/etut-sablon/all/route.ts:42](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:42) — `booked = !!sb.studentId`.
- [app/api/etut-sablon/all/route.ts:47](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:47) — veliye yalnız kendi çocuğunun şablon rezervasyonlarını döndürüyor.

- [app/api/etut-sablon/route.ts:63](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:63) — şablon ve üzerindeki mevcut rezervasyon alanlarını ham olarak okuyor.
- [app/api/etut-sablon/route.ts:72](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:72) — şablon ekleme/güncelleme yazması.
- [app/api/etut-sablon/route.ts:102](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:102) — tüm haftalar/belirli hafta aktiflik yazması.
- [app/api/etut-sablon/route.ts:130](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:130) — rezervasyon için ikinci, bağımsız yazma yolu.
- [app/api/etut-sablon/route.ts:141](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:141) — `studentId` doğrudan şablona yazılıyor.
- [app/api/etut-sablon/route.ts:146](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:146) — rezervasyon doğrudan şablondan siliniyor.
- [app/api/etut-sablon/route.ts:155](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:155) — şablon silme; beraberindeki rezervasyonu da fiilen siliyor.
- [lib/slots.ts:424](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:424) ve [lib/slots.ts:430](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:430) — JSON’un temel okuma/yazma fonksiyonları.
- [lib/slots.ts:405](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:405) — tüm öğretmen şablonlarını toplu okuyan temel fonksiyon.

#### Müdür/rehber paneli

- [ProgramEditor.tsx:82](/Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx:82) — ham şablonları okuyor.
- [ProgramEditor.tsx:92](/Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx:92) — şablon ekleme/güncelleme.
- [ProgramEditor.tsx:108](/Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx:108) — şablon silme.
- [ProgramEditor.tsx:117](/Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx:117) — hafta/tüm haftalar aktiflik yazma.
- [ProgramEditor.tsx:129](/Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx:129) — `/api/etut-sablon` PATCH üzerinden doğrudan öğrenci atama/kaldırma.
- [TeachersTab.tsx:35](/Users/mustafa/Workspace/active/okulin/app/_components/director/TeachersTab.tsx:35) — öğretmenin etüt rezervasyonlarını `etut-sablon/all` üzerinden okuyor.
- [TeachersTab.tsx:52](/Users/mustafa/Workspace/active/okulin/app/_components/director/TeachersTab.tsx:52) — rezervasyonu servis route’u üzerinden iptal ediyor.

#### Öğretmen paneli

- [TeacherPanel.tsx:199](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:199) — yoklama ekranı `etut-sablon/all` okuyor.
- [TeacherPanel.tsx:210](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:210) — kendi dolu serbest etütlerini `studentId` ile seçiyor.
- [TeacherPanel.tsx:234](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:234) — bu kayıtları yoklama günlerine ekliyor.
- [TeacherPanel.tsx:641](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:641) — “Etütler” sekmesi haftalık şablon listesini okuyor.
- [TeacherPanel.tsx:658](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:658) — öğrenci atama yazması.
- [TeacherPanel.tsx:680](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:680) — rezervasyon kaldırma yazması.

#### Öğrenci paneli

- [StudentPanel.tsx:62](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:62) — yalnız `etut-sablon/all` okuyor.
- [StudentPanel.tsx:103](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:103) — “Etütlerim”i şablon `studentId` üzerinden çıkarıyor.
- [StudentPanel.tsx:109](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:109) — haftalık ders/matematik kısıtlarını istemci tarafında mevcut listeden hesaplıyor.
- [StudentPanel.tsx:137](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:137) — hafta anahtarıyla rezervasyon yazıyor.
- [StudentPanel.tsx:145](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:145) — iptal ediyor; `weekKey` göndermiyor.
- [StudentPanel.tsx:160](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:160) — serbest ileri/geri hafta gezintisi var; rezervasyon yapılabilir hafta sınırı yok.

#### Veli paneli

- [ParentPanel.tsx:61](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:61) — hem SlotBooking hem `etut-sablon` okuyor.
- [ParentPanel.tsx:67](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:67) — SlotBooking okuması.
- [ParentPanel.tsx:68](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:68) — `etut-sablon` okuması.
- [ParentPanel.tsx:86](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:86) — iki kaynağı tek görünümde birleştiriyor.
- [StudentBookingsView.tsx:27](/Users/mustafa/Workspace/active/okulin/app/_components/StudentBookingsView.tsx:27) — ortak görünüm rezervasyon sahibini `studentId` ile süzüyor.

#### Mobil API ve servisler

- [app/api/mobile/v1/etut/route.ts:14](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/route.ts:14) — öğrencinin rezervasyon listesini okuyor.
- [app/api/mobile/v1/etut/route.ts:25](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/route.ts:25) — `listBookableEtuts` çağrısı.
- [app/api/mobile/v1/etut/reserve/route.ts:14](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/reserve/route.ts:14) — rezervasyon yazma.
- [app/api/mobile/v1/etut/reserve/route.ts:27](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/reserve/route.ts:27) — iptal; burada da hafta bilgisi yok.
- [lib/mobile/today.ts:131](/Users/mustafa/Workspace/active/okulin/lib/mobile/today.ts:131) — öğrenci/veli “bugün” serbest etüt okuması.
- [lib/mobile/today.ts:137](/Users/mustafa/Workspace/active/okulin/lib/mobile/today.ts:137) — rezervasyonu doğrudan şablon `studentId` ile eşliyor.
- [lib/mobile/today.ts:258](/Users/mustafa/Workspace/active/okulin/lib/mobile/today.ts:258) — öğretmen “bugün” serbest etüt okuması.
- [lib/mobile/today.ts:267](/Users/mustafa/Workspace/active/okulin/lib/mobile/today.ts:267) — doluluğu `!!sb.studentId` ile hesaplıyor.
- [lib/mobile/week.ts:18](/Users/mustafa/Workspace/active/okulin/lib/mobile/week.ts:18) — öğrenci/veli haftalık program servisi.
- [lib/mobile/week.ts:50](/Users/mustafa/Workspace/active/okulin/lib/mobile/week.ts:50) — serbest etüt şablonlarını okuyor.
- [lib/mobile/week.ts:53](/Users/mustafa/Workspace/active/okulin/lib/mobile/week.ts:53) — rezervasyonu şablon `studentId` ile eşliyor.
- [app/api/mobile/v1/screens/today/route.ts:20](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/screens/today/route.ts:20) — bugün servislerinin giriş noktası.
- [app/api/mobile/v1/screens/week/route.ts:20](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/screens/week/route.ts:20) — haftalık servislerin giriş noktası.

#### Yoklama ve geçmiş

- [app/api/attendance/student/route.ts:65](/Users/mustafa/Workspace/active/okulin/app/api/attendance/student/route.ts:65) — geçmiş etüt yoklamasını şablondan zenginleştiriyor.
- [app/api/attendance/student/route.ts:69](/Users/mustafa/Workspace/active/okulin/app/api/attendance/student/route.ts:69) — güncel `etutSablonlari` listesini okuyor.
- [app/api/attendance/student/route.ts:71](/Users/mustafa/Workspace/active/okulin/app/api/attendance/student/route.ts:71) — yalnız `etutId` ile güncel şablonu bulup ders/saat çıkarıyor.

### B. `SlotBooking` sistemi

Kalıcı ve hafta-bazlı kaynak: [schema.prisma:256](/Users/mustafa/Workspace/active/okulin/prisma/schema.prisma:256). Unique anahtar `weekKey + teacherId + dayIndex + slotId`: [schema.prisma:274](/Users/mustafa/Workspace/active/okulin/prisma/schema.prisma:274).

- [lib/slots.ts:267](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:267) — haftayı program şablonundan materyalize ediyor; okuma/yazma.
- [lib/slots.ts:275](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:275) — mevcut hafta kayıtlarını okuyor.
- [lib/slots.ts:333](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:333) — haftayı silip yeniden yazıyor.
- [lib/slots.ts:339](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:339) — öğretmen haftalık SlotBooking grid okuması.
- [lib/slots.ts:376](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:376) — mobil günlük toplu okuma.
- [lib/slots.ts:392](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:392) — mobil haftalık toplu okuma.

- [app/api/slots/route.ts:25](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:25) — GET.
- [app/api/slots/route.ts:50](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:50) — `teacherId` varsa tek öğretmen SlotBooking grid’i.
- [app/api/slots/route.ts:56](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:56) — `teacherId` yoksa tüm öğretmen SlotBooking grid’lerini birleştiriyor.
- [app/api/slots/route.ts:82](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:82) — veli süzmesi.
- [app/api/slots/route.ts:98](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:98) — rezervasyon yazma.
- [app/api/slots/route.ts:218](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:218) — haftalık öğrenci çakışmalarını yalnız SlotBooking’den okuyor.
- [app/api/slots/route.ts:259](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:259) — atomik upsert.
- [app/api/slots/route.ts:287](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:287) — iptal.
- [app/api/slots/route.ts:342](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:342) — kaydı boşaltma yazması.

- [app/api/program/route.ts:46](/Users/mustafa/Workspace/active/okulin/app/api/program/route.ts:46) — hafta grid’ini SlotBooking’den okuyor.
- [app/api/program/route.ts:70](/Users/mustafa/Workspace/active/okulin/app/api/program/route.ts:70) — geçici SlotBooking etütlerini hâlâ programa ekliyor.
- [app/api/program/route.ts:190](/Users/mustafa/Workspace/active/okulin/app/api/program/route.ts:190) — geçici etüt/ders SlotBooking yazması.
- [app/api/program/route.ts:203](/Users/mustafa/Workspace/active/okulin/app/api/program/route.ts:203) — `type:'etut'` hâlâ SlotBooking’e yazılabiliyor.

- [DirectorPanel.tsx:133](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:133) — kurum geneli SlotBooking okuması.
- [DirectorPanel.tsx:186](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:186) — SlotBooking rezervasyon yazması.
- [DirectorPanel.tsx:194](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:194) — SlotBooking iptali.
- [DirectorPanel.tsx:247](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:247) — öğrenci detaylarına yalnız `allSlots` geçiriyor.
- [DirectorPanel.tsx:286](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:286) — geçmiş modalının “mevcut hafta” verisi yalnız `allSlots`.

- [TeacherPanel.tsx:845](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:845) — “Rezervasyon” sekmesi SlotBooking grid’i okuyor.
- [TeacherPanel.tsx:877](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:877) — SlotBooking rezervasyonu yazıyor.
- [TeacherPanel.tsx:885](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:885) — SlotBooking iptali.
- [TeacherPanel.tsx:950](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:950) — SlotBooking rezervasyon UI’ı.
- Aynı öğretmen panelinde ayrı `Etütler` sekmesi `etut-sablon` kullanıyor: [TeacherPanel.tsx:972](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:972).

- [ParentPanel.tsx:67](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:67) — veli, geriye dönük uyumluluk için SlotBooking rezervasyonlarını da okuyor.

- [app/api/archive/route.ts:18](/Users/mustafa/Workspace/active/okulin/app/api/archive/route.ts:18) — geçmişi yalnız SlotBooking’den okuyor.
- [app/api/cron/weekly/route.ts:39](/Users/mustafa/Workspace/active/okulin/app/api/cron/weekly/route.ts:39) — haftalık arşiv yalnız SlotBooking grid’ini topluyor.
- [app/api/cron/weekly/route.ts:71](/Users/mustafa/Workspace/active/okulin/app/api/cron/weekly/route.ts:71) — yalnız bu kayıtları Redis arşivine yazıyor.
- [app/api/admin/week/route.ts:51](/Users/mustafa/Workspace/active/okulin/app/api/admin/week/route.ts:51) — `reinit`, tüm SlotBooking kayıtlarını siliyor.
- [app/api/admin/week/route.ts:60](/Users/mustafa/Workspace/active/okulin/app/api/admin/week/route.ts:60) — `reset-all`, hem programTemplate’i hem SlotBooking’i siliyor.

## 2. İki sistemin karıştığı/tutarsız yerler

### `/api/slots?week=...&teacherId` olmadan ne döndürüyor?

Kesin cevap: yalnız `SlotBooking`.

Akış:

- Tüm öğretmenleri dolaşıyor: [app/api/slots/route.ts:56](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:56).
- Her öğretmen için `getTeacherWeekSlots` çağırıyor: [app/api/slots/route.ts:60](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:60).
- Bu fonksiyon yalnız `tdb().slotBooking.findMany({weekKey, teacherId})` okuyor: [lib/slots.ts:350](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:350).
- `programTemplate.etutSablonlari` okunmuyor veya sonuçla birleştirilmiyor.

Dolayısıyla `studentId`’siz kurum geneli `/api/slots?week=` çağrısı `etut-sablon` rezervasyonlarını içermez.

### `allSlots` kullanıp serbest etütleri kaçıran paneller

- Müdür/rehber öğrenci detayları: [DirectorPanel.tsx:133](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:133), [DirectorPanel.tsx:247](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:247). `allSlots` yalnız `/api/slots`; öğrenci detayındaki “bu hafta etütleri” serbest etüt rezervasyonlarını kaçırır.
- Müdür/rehber öğrenci geçmiş modalının mevcut hafta bölümü: [DirectorPanel.tsx:286](/Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx:286). Yalnız SlotBooking.
- Sunucu geçmiş endpoint’i: [app/api/archive/route.ts:18](/Users/mustafa/Workspace/active/okulin/app/api/archive/route.ts:18). Serbest etütler hiçbir hafta için arşive girmez.
- Haftalık cron arşivi: [app/api/cron/weekly/route.ts:39](/Users/mustafa/Workspace/active/okulin/app/api/cron/weekly/route.ts:39). Serbest etütleri okumuyor.
- Öğretmen “Rezervasyon” sekmesi: [TeacherPanel.tsx:845](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:845). Yalnız SlotBooking’i gösteriyor; serbest etütler ayrı “Etütler” sekmesinde. Aynı kullanıcıya iki farklı rezervasyon modeli sunuluyor.

Kaçırmayanlar:

- Öğrenci paneli yalnız yeni `etut-sablon` kaynağına geçirilmiş: [StudentPanel.tsx:67](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:67).
- Veli iki kaynağı açıkça birleştiriyor: [ParentPanel.tsx:65](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:65).
- Müdür öğretmen-detay “Etütler” sekmesi doğru biçimde `etut-sablon/all` kullanıyor: [TeachersTab.tsx:31](/Users/mustafa/Workspace/active/okulin/app/_components/director/TeachersTab.tsx:31).
- Öğretmen yoklama ekranı serbest etütleri ayrıca okuyor: [TeacherPanel.tsx:203](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:203).

### İş kuralı tutarsızlıkları

- `etut-sablon` çakışmaları yalnız `etut-sablon` rezervasyonlarına bakıyor: [rezervasyon.ts:124](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:124).
- SlotBooking çakışmaları yalnız SlotBooking’e bakıyor: [slots/route.ts:217](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:217).
- Sonuç: aynı öğrenci aynı hafta iki sistemden aynı ders/matematik ailesi veya aynı saate rezervasyon alabilir.
- Haftalık maksimum öğrenci limiti yalnız SlotBooking sayıyor: [slots/route.ts:122](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:122). `reserveEtut` tarafında eşdeğer limit yok.
- Öğrenci self-booking kapatma ayarı `/api/slots` içinde uygulanıyor: [slots/route.ts:114](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:114). `reserveEtut` servisinde uygulanmıyor; web ve mobil serbest etüt rezervasyonu bu ayarı atlıyor.
- Salt-okunur rehber kontrolü `/api/slots`ta var: [slots/route.ts:105](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:105). `etut-sablon/rezervasyon` servis yolunda eşdeğeri görünmüyor.
- `/api/program` hâlâ geçici `type:'etut'` SlotBooking üretebiliyor: [program/route.ts:203](/Users/mustafa/Workspace/active/okulin/app/api/program/route.ts:203). “SlotBooking artık yalnız ders” hedefi kod seviyesinde tamamlanmamış.

## 3. Hafta-bazlı geçişte öncelikli regresyon riskleri

### P0 — veri doğruluğunu doğrudan bozanlar

1. **İptalde hafta kimliği yok.**

   Web ve mobil DELETE yalnız `{teacherId, etutId}` kabul ediyor: [web route:19](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/rezervasyon/route.ts:19), [servis:150](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:150). Hafta-bazlı kayıtta aynı şablonun hangi haftadaki rezervasyonunun iptal edileceği belirlenemez. Öğrenci UI da hafta göndermiyor: [StudentPanel.tsx:145](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:145).

2. **`studentId` okuyan bütün yollar yeni rezervasyon kaynağına geçirilmezse rezervasyonlar boş veya tüm haftalarda dolu görünür.**

   Kritik okuyucular: `etut-sablon/all`, `studentBookedEtuts`, `listBookableEtuts`, web öğrenci/öğretmen/müdür panelleri, mobil today/week ve yoklama geçmişi. Bunların tamamı yukarıdaki envanterdeki `sb.studentId` satırlarıdır.

3. **İkinci, kuralsız rezervasyon yazma yolu var.**

   `/api/etut-sablon` PATCH doğrudan şablona öğrenci yazıyor: [route.ts:130](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:130). `reserveEtut` içindeki grup, ders, geçmiş zaman, doluluk, saat, aynı ders ve matematik ailesi kontrollerinin hiçbirini kullanmıyor. Hafta alanı da yok. Kaldırılmalı veya aynı hafta-bazlı servise yönlendirilmeli.

4. **İki kaynağın çakışma kuralları birleşik değil.**

   Yeni model yalnız `etut-sablon` rezervasyonlarını haftalık kontrol ederse mevcut SlotBooking kayıtlarıyla; yalnız SlotBooking kontrol edilirse yeni kayıtlarla çakışma yakalanmaz. Aynı saat karşılaştırması ayrıca farklı kimliklerle yapılıyor: SlotBooking `slotId`, serbest etüt `start`.

5. **JSON read-modify-write yarış durumu.**

   Rezervasyonda öğretmenin tüm `programTemplate` JSON’u okunup değiştirilip geri yazılıyor: [rezervasyon.ts:101](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:101), [rezervasyon.ts:145](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:145). Paralel iki rezervasyon birbirinin değişikliğini ezebilir. SlotBooking’deki atomik unique/upsert güvencesi burada yok: [slots/route.ts:253](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:253). Hafta-bazlı rezervasyon ayrı Prisma modeli ve unique anahtarla tutulmalı.

### P1 — yetki ve hafta politikası

6. **“Bu hafta + Pazar açılan sonraki hafta” kuralı backend’de yok.**

   `reserveEtut` gelen herhangi bir `weekKey`i kabul ediyor: [rezervasyon.ts:70](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:70). Yalnız slotun geçmişte olup olmadığı denetleniyor: [rezervasyon.ts:111](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:111). Uzak gelecek hafta rezervasyonu mümkündür.

7. **Web hafta parametreleri doğrulanmıyor.**

   `/api/etut-sablon/all`: [route.ts:16](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts:16); rezervasyon servisi: [rezervasyon.ts:73](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:73). Mobil liste regex ile doğruluyor: [mobile route.ts:21](/Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/route.ts:21), fakat POST servisinde aynı doğrulama yok.

8. **Pazar açılma hesabı merkezi ve Türkiye saat diliminde yapılmalı.**

   Kodda slot zamanı açıkça TSİ `+03` kabul ediyor: [slots.ts:173](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:173). Yeni hafta erişim kararı istemci saatine veya sunucunun varsayılan timezone’una bırakılırsa Pazar sınırında web/mobil farklı davranır.

9. **Tekrarlayan rezervasyon için mevcut veri alanı yok.**

   `pasifHaftalar` şablonun aktifliğini yönetiyor; rezervasyon kapsamını değil: [slots.ts:66](/Users/mustafa/Workspace/active/okulin/lib/slots.ts:66). “Tek hafta / tüm haftalar” ayrı bir rezervasyon kapsamı olmalı. Tüm haftalar yazması yalnız müdür+rehber backend yetkisiyle korunmalı; UI gizlemek yeterli değil.

10. **Yönetici muafiyeti ve rehber yetkisi kesinleştirilmeli.**

    Mevcut `isManager` aynı ders/matematik kuralını atlıyor: [rezervasyon.ts:128](/Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts:128). Ancak salt-okunur rehber burada ayrıca reddedilmiyor. Tekrarlayan rezervasyon yetkisi `canManage` ile salt-okunur durum ayrıştırılarak uygulanmalı.

### P2 — görünüm, geçmiş ve sessiz hata riskleri

11. **Müdür öğrenci görünümü ve geçmiş sistemi yeni kayıtları kaçırır.**

    `DirectorPanel allSlots`, `/api/archive` ve haftalık cron yeni hafta-bazlı rezervasyon tablosunu okumazsa serbest etütler mevcut hafta ve geçmişte görünmez.

12. **Geçmiş etüt yoklaması güncel şablona bağımlı.**

    [attendance/student/route.ts:69](/Users/mustafa/Workspace/active/okulin/app/api/attendance/student/route.ts:69) geçmiş yoklama kaydını bugünkü şablonla çözüyor. Şablon silinir, saat/ders değiştirilir veya rezervasyon alanları taşınırsa geçmiş kaydın etiketi boş/yanlış olur. Yoklama kaydında tarihsel snapshot veya hafta-bazlı rezervasyon join’i gerekir.

13. **Şablon silme ve `reset-all` için cascade politikası belirsiz.**

    Şablon silme: [etut-sablon/route.ts:155](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:155). `reset-all`: [admin/week/route.ts:60](/Users/mustafa/Workspace/active/okulin/app/api/admin/week/route.ts:60). Yeni rezervasyonlar ayrı tabloda tutulursa geçmiş rezervasyonların silinmesi mi korunması mı gerektiği açıkça kodlanmalı; aksi halde orphan veya toplu veri kaybı olur.

14. **Şablon saati/günü değiştirilince mevcut haftalık rezervasyonların anlamı değişebilir.**

    POST mevcut şablonu aynı `id` ile güncelliyor: [etut-sablon/route.ts:88](/Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts:88). Rezervasyon yalnız `templateId + weekKey` tutarsa geçmiş kayıtlar yeni saate kayar. Rezervasyonda gün/saat snapshot’ı veya immutable şablon sürümü gerekir.

15. **Hatalar bazı panellerde sessizce boş listeye çevriliyor.**

    - Veli `etut-sablon` hatasını boş liste yapıyor: [ParentPanel.tsx:68](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:68).
    - Veli tüm yükleme hatasında görünümü boşaltıyor: [ParentPanel.tsx:87](/Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx:87).
    - Öğretmen rezervasyon listesi API hatasını boş liste yapıyor: [TeacherPanel.tsx:644](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:644).
    - Öğretmen yoklaması serbest etüt hatasını boş liste yapıyor: [TeacherPanel.tsx:206](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:206).
    - Müdür öğretmen rezervasyon listesi hatayı boş liste yapıyor: [TeachersTab.tsx:43](/Users/mustafa/Workspace/active/okulin/app/_components/director/TeachersTab.tsx:43).
    - Program Editörü şablon okuma hatasını boş şablon gibi gösteriyor: [ProgramEditor.tsx:86](/Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx:86).

    “Sessiz hata istemiyoruz” şartı için bu `.catch(() => boş veri)` yolları hata durumuna dönüştürülmeli; boş veri ile erişim/DB/API hatası ayrılmalı.

16. **Haftalık limit iki sistem toplamından hesaplanmıyor.**

    `maxWeeklyPerStudent` yalnız SlotBooking sayıyor: [slots/route.ts:125](/Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts:125). Yeni rezervasyon tablosu ana sistem olacaksa limit aynı merkezi servis üzerinden hesaplanmalı.

17. **Mevcut UI hafta aralıkları planlanan politikayla uyumsuz.**

    Öğrenci `WeekNav` serbest ileri/geri: [StudentPanel.tsx:160](/Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx:160). Öğretmen serbest etüt ekranı mevcut hafta ile `+2` arasında dolaşıyor: [TeacherPanel.tsx:711](/Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx:711). Görüntüleme ile rezervasyon yetkisi ayrılmalı; geçmiş/gelişmiş hafta okunabilir olsa bile öğrenci yazması backend tarafından sınırlandırılmalı.

Ek ortam notu: kullanılan Vercel CLI `56.2.1`; güncel `56.3.2` için `npm i -g vercel@latest` önerilir.

---

# GEMINI BAĞIMSIZ DENETİMİ (2026-07-19)

Okulin (Next.js 14 + Prisma + TS) projesindeki etüt rezervasyon sisteminin koddaki mevcut durumunun **bağımsız denetim raporu** aşağıdadır.

---

# GÖREV 1: Etüt Rezervasyonlarını OKUYAN ve YAZAN Tüm Yerler

### 1. Backend Servisleri ve Yardımcı Fonksiyonlar (`lib/`)
* **[lib/etut/rezervasyon.ts](file:///Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts)**
  * `studentBookedEtuts` (**Satır 55–64**): `etut-sablon` | **OKUMA** — `getAllProgramTemplates()` üzerinden tüm öğretmenlerin `programTemplate.etutSablonlari` dizisini tarayarak öğrencinin etütlerini okur.
  * `reserveEtut` (**Satır 68–146**): `etut-sablon` | **YAZMA** — Öğrencinin etüt rezervasyon verilerini (`studentId`, `studentName`, `studentCls`, `branch`, `bookedBy`, `bookedAt`) **doğrudan şablon nesnesine (`template.etutSablonlari[idx]`) yazar** (**Satır 137–145**).
  * `cancelEtut` (**Satır 150–167**): `etut-sablon` | **YAZMA** — Etüt şablonundaki `studentId`, `studentName`, `studentCls`, `branch`, `bookedBy`, `bookedAt` alanlarını **siler** (**Satır 162–165**).
  * `listBookableEtuts` (**Satır 184–219**): `etut-sablon` | **OKUMA** — Öğrenciye açık etütleri ve doluluk durumlarını (`booked: Boolean(sb.studentId)`) okur (**Satır 211**).
* **[lib/slots.ts](file:///Users/mustafa/Workspace/active/okulin/lib/slots.ts)**
  * `computeCellFromEntry` (**Satır 227–238**): `SlotBooking` (eski şablon etüt) | **OKUMA** — Şablondaki sabit etüt `entry.type === 'etut'` verilerini SlotBooking hücresine dönüştürür.
  * `initWeekForTeacher` (**Satır 267–336**): `SlotBooking` | **YAZMA** — Verilen haftanın `SlotBooking` tablosunu silip şablondaki ders/etüt tanımlarına göre yeniden yazar (**Satır 333–335**).
  * `getTeacherWeekSlots` (**Satır 339–357**): `SlotBooking` | **OKUMA** — Prisma `slotBooking.findMany` sorgusu ile haftalık grid hücrelerini okur.
  * `getDayCellsAllTeachers` & `getWeekCellsAllTeachers` (**Satır 376–403**): `SlotBooking` | **OKUMA** — Mobil ve özet ekranlar için `SlotBooking` tablosunu sorgular.
  * `getProgramTemplate` / `setProgramTemplate` (**Satır 425–435**): `etut-sablon` & Grid | **OKUMA / YAZMA** — `Teacher.programTemplate` JSON alanını okur ve günceller.

---

### 2. Backend API Route'ları (`app/api/`)
* **[app/api/slots/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts)**
  * **GET** (**Satır 25–93**): `SlotBooking` | **OKUMA** — Kurum geneli veya öğretmen bazlı `SlotBooking` tablosunu okur. `etut-sablon` verilerini **okumaz/döndürmez**.
  * **POST** (**Satır 98–283**): `SlotBooking` | **YAZMA** — SlotBooking tablosuna slot bazlı etüt/ders rezervasyonu upsert eder (**Satır 259–280**).
  * **DELETE** (**Satır 287–351**): `SlotBooking` | **YAZMA** — SlotBooking tablosundaki rezervasyonu iptal eder (`booked: false`) (**Satır 342–349**).
* **[app/api/etut-sablon/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts)**
  * **GET** (**Satır 64–70**): `etut-sablon` | **OKUMA** — `Teacher.programTemplate.etutSablonlari` dizisini döner.
  * **POST** (**Satır 73–100**): `etut-sablon` | **YAZMA** — Öğretmenin serbest etüt şablonunu ekler/günceller.
  * **PUT** (**Satır 103–128**): `etut-sablon` | **YAZMA** — Etüdün genel aktifliğini veya haftalık pasifliğini (`pasifHaftalar`) değiştirir.
  * **PATCH** (**Satır 131–153**): `etut-sablon` | **YAZMA** — Müdür editöründen etüde doğrudan öğrenci atar/kaldırır (`sb.studentId = student.id`) (**Satır 140–147**).
  * **DELETE** (**Satır 156–163**): `etut-sablon` | **YAZMA** — Etüt şablonunu tamamen siler.
* **[app/api/etut-sablon/all/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/all/route.ts)**
  * **GET** (**Satır 13–56**): `etut-sablon` | **OKUMA** — Tüm öğretmenlerin ilgili haftadaki aktif etüt şablonlarını ve rezervasyon durumlarını (`studentId`, `studentName`, `booked`) liste olarak döner.
* **[app/api/etut-sablon/rezervasyon/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/rezervasyon/route.ts)**
  * **POST** (**Satır 21–27**): `etut-sablon` | **YAZMA** — `reserveEtut` servisini çağırır.
  * **DELETE** (**Satır 29–35**): `etut-sablon` | **YAZMA** — `cancelEtut` servisini çağırır.
* **[app/api/program/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/program/route.ts)**
  * **GET** (**Satır 35–82**): `SlotBooking` | **OKUMA** — Şablondaki dersler ile `SlotBooking`'deki geçici etüt/dersleri birleştirir.
  * **POST** (**Satır 85–224**): `SlotBooking` & `etut-sablon` | **OKUMA / YAZMA** — Ders programı güncellenirken `etutSablonlari` alanını koruyarak `programTemplate` ve `SlotBooking` yazar (**Satır 183**).
  * **DELETE** (**Satır 231–248**): `etut-sablon` | **OKUMA / YAZMA** — Program silinirken `etutSablonlari`'nı koruyarak grid derslerini temizler (**Satır 244**).
* **[app/api/mobile/v1/etut/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/route.ts)**
  * **GET** (**Satır 13–27**): `etut-sablon` | **OKUMA** — Mobil uygulama için `listBookableEtuts` servisini çağırır.
* **[app/api/mobile/v1/etut/reserve/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/mobile/v1/etut/reserve/route.ts)**
  * **POST & DELETE** (**Satır 13–38**): `etut-sablon` | **YAZMA** — Mobil uygulamadan `reserveEtut` ve `cancelEtut` çağırır.

---

### 3. Paneller (Frontend Web Arayüzü)
* **Müdür Paneli (`DirectorPanel`)**:
  * **[app/_components/DirectorPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx)**
    * **Satır 141, 171, 182**: `SlotBooking` | **OKUMA** — `/api/slots?week=...` çağrısı ile `allSlots` listesini çeker. (`etut-sablon` etütlerini içermez).
    * **Satır 266**: `SlotBooking` | **YAZMA** — Sınıf/Öğrenci detayından etüt iptali yaparken `DELETE /api/slots` çağırır.
    * **Satır 289**: `SlotBooking` | **OKUMA** — `HistoryModal` bileşenine `allSlots` aktarır.
  * **[app/_components/director/TeachersTab.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/director/TeachersTab.tsx)**
    * **Satır 43**: `etut-sablon` | **OKUMA** — `/api/etut-sablon/all?week=...` çağrısı ile öğretmenin etüt rezervasyonlarını çeker.
    * **Satır 55**: `etut-sablon` | **YAZMA** — `/api/etut-sablon/rezervasyon` `DELETE` isteği ile etütü iptal eder.
  * **[app/_components/director/ProgramEditor.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/director/ProgramEditor.tsx)**
    * **Satır 86**: `etut-sablon` | **OKUMA** — `/api/etut-sablon?teacherId=...` ile öğretmenin etüt şablonlarını çeker.
    * **Satır 100**: `etut-sablon` | **YAZMA** — `POST /api/etut-sablon` (yeni etüt şablonu).
    * **Satır 110**: `etut-sablon` | **YAZMA** — `DELETE /api/etut-sablon` (şablon sil).
    * **Satır 120**: `etut-sablon` | **YAZMA** — `PUT /api/etut-sablon` (etüt aktif/pasif toggle).
    * **Satır 131**: `etut-sablon` | **YAZMA** — `PATCH /api/etut-sablon` (doğrudan öğrenci atama).
  * **[app/_components/director/SinifOgrenci.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/director/SinifOgrenci.tsx) & [StudentList.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/director/StudentList.tsx)**
    * **SinifOgrenci.tsx Satır 55 / StudentList.tsx Satır 91**: `SlotBooking` | **OKUMA** — `DirectorPanel`'den gelen `allSlots` prop'unu okur.
* **Öğretmen Paneli (`TeacherPanel`)**:
  * **[app/_components/TeacherPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/TeacherPanel.tsx)**
    * **Satır 206**: `etut-sablon` | **OKUMA** — `TeacherAttendancePanel` için `/api/etut-sablon/all?week=...` ile yoklamaya girecek etütleri çeker.
    * **Satır 644**: `etut-sablon` | **OKUMA** — `TeacherEtutPanel` için etüt şablonlarını çeker.
    * **Satır 667 & 683**: `etut-sablon` | **YAZMA** — `POST` / `DELETE` `/api/etut-sablon/rezervasyon` ile öğrenci atar/kaldırır.
    * **Satır 851, 879, 887**: `SlotBooking` | **OKUMA / YAZMA** — "Ders Programım" sekmesinde `/api/slots` grid işlemleri yapar.
* **Öğrenci Paneli (`StudentPanel`)**:
  * **[app/_components/StudentPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx)**
    * **Satır 68**: `etut-sablon` | **OKUMA** — `/api/etut-sablon/all?week=...` ile aktif etütleri çeker.
    * **Satır 139**: `etut-sablon` | **YAZMA** — `POST /api/etut-sablon/rezervasyon` ile rezervasyon yapar.
    * **Satır 147**: `etut-sablon` | **YAZMA** — `DELETE /api/etut-sablon/rezervasyon` ile iptal eder.
* **Veli Paneli (`ParentPanel`)**:
  * **[app/_components/ParentPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/ParentPanel.tsx)**
    * **Satır 67**: `SlotBooking` | **OKUMA** — `GET /api/slots?week=...&studentId=...`
    * **Satır 68**: `etut-sablon` | **OKUMA** — `GET /api/etut-sablon/all?week=...&studentId=...`
    * **Satır 86**: İki listeden gelen veriyi birleştirir (`setAllSlots([...slotList, ...etutList])`).

---

### 4. Mobil Uygulama Servisleri (`lib/mobile/` & `mobile/src/`)
* **[lib/mobile/today.ts](file:///Users/mustafa/Workspace/active/okulin/lib/mobile/today.ts)**
  * **Satır 133–144**: `etut-sablon` | **OKUMA** — Öğrenci "Bugün" ekranı için `getAllProgramTemplates()` üzerinden `etutSablonlari` okur.
  * **Satır 195**: `etut-sablon` | **OKUMA** — Veli "Bugün" ekranı için etütleri okur.
  * **Satır 260–270**: `etut-sablon` | **OKUMA** — Öğretmen "Bugün" ekranı için serbest etüt şablonlarını okur. (Dersler ise `SlotBooking`'den okunur - **Satır 238**).
* **[lib/mobile/week.ts](file:///Users/mustafa/Workspace/active/okulin/lib/mobile/week.ts)**
  * **Satır 50–58**: `etut-sablon` | **OKUMA** — Öğrenci/Veli haftalık görünümü için `etutSablonlari` okur.
* **[mobile/src/app/etut.tsx](file:///Users/mustafa/Workspace/active/okulin/mobile/src/app/etut.tsx)**
  * **Satır 22**: `etut-sablon` | **OKUMA** — `/api/mobile/v1/etut` uç noktasına istek atar.
  * **Satır 35 & 49**: `etut-sablon` | **YAZMA** — `/api/mobile/v1/etut/reserve` uç noktasına `POST` ve `DELETE` istekleri atar.

---

### 5. Yoklama, Arşiv, Admin ve Cron İşlemleri
* **[app/api/attendance/student/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/attendance/student/route.ts)**
  * **Satır 69–78**: `etut-sablon` | **OKUMA** — `isEtut: true` devamsızlık kayıtlarında ders adını ve saat aralığını bulmak için `programTemplate.etutSablonlari` okur.
  * **Satır 86–107**: `SlotBooking` | **OKUMA** — `isEtut: false` ders devamsızlıkları için `SlotBooking` tablosunu sorgular.
* **[app/api/attendance/summary/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/attendance/summary/route.ts)**
  * **Satır 51**: `SlotBooking` | **OKUMA** — `getTeacherWeekSlots` çağırır; etütleri dışlar, sadece ders yoklamalarını özetler.
* **[app/api/archive/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/archive/route.ts)**
  * **Satır 22 & 27**: `SlotBooking` | **OKUMA** — `tdb().slotBooking.findMany({ where: { booked: true } })` sorgusu atar. **`etut-sablon` kayıtlarını TAMAMEN KAÇIRIR.**
* **[app/api/admin/week/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/admin/week/route.ts)**
  * **Satır 55, 73**: `SlotBooking` | **YAZMA** — `slotBooking.deleteMany({})` çalıştırır.
  * **Satır 68**: `etut-sablon` | **YAZMA** — `reset-all` işlemi `programTemplate: {}` yazarak tüm `etutSablonlari` dizisini **SİLER**.
* **[app/api/cron/weekly/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/cron/weekly/route.ts)**
  * **Satır 45–68**: `SlotBooking` | **OKUMA** — Haftalık devir cron'u, sadece `SlotBooking` tablosunu sorgulayıp Redis'e arşivler. **`etut-sablon` rezervasyonlarını hiç arşivlemez!**

---

# GÖREV 2: İki Sistem Arasındaki Karışıklıklar ve Tutarsızlıklar

1. **`/api/slots?week=` (Org-geneli, teacherId'siz GET) Etüt Kaçırma Sorunu**:
   * **Durum**: [app/api/slots/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/slots/route.ts) **Satır 56–80** aralığı, `getAllTeachers()` döngüsüyle `getTeacherWeekSlots` çağırır. `getTeacherWeekSlots` ise yalnızca Prisma `SlotBooking` tablosundan okuma yapar ([lib/slots.ts](file:///Users/mustafa/Workspace/active/okulin/lib/slots.ts) **Satır 350**).
   * **Sonuç**: `/api/slots?week=` yanıtında **SADECE `SlotBooking` verileri (dersler) döner, HİÇBİR `etut-sablon` verisi DÖNMEZ.**

2. **`allSlots` Kullanan ve `etut-sablon`'u Kaçıran Paneller**:
   * **Müdür Paneli > Sınıf/Öğrenci > Öğrenci Detayı**:
     * [app/_components/DirectorPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx) **Satır 141, 171, 182** üzerinde `/api/slots?week=` ile `allSlots` çekilir ve [SinifOgrenci.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/director/SinifOgrenci.tsx) -> [StudentList.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/director/StudentList.tsx) -> [StudentBookingsView.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/StudentBookingsView.tsx) bileşenine aktarılır.
     * **Kök Neden**: `allSlots` içinde `etut-sablon` verisi olmadığı için müdür öğrenci detay kartına tıkladığında öğrencinin aldığı serbest etütler **görünmez ("Bu hafta hiç etüt yok" yazar)**.
   * **Müdür Paneli > Öğrenci Detayından Etüt İptali**:
     * [DirectorPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx) **Satır 266**'daki `onCancelBooking` handler'ı `DELETE /api/slots` endpoint'ini çağırır.
     * **Kök Neden**: Etüt `etut-sablon` sisteminde olduğu için `/api/slots` endpoint'i `404 Rezervasyon bulunamadı` hatası döndürür.
   * **Müdür Paneli > Geçmiş Modal (`HistoryModal`)**:
     * [DirectorPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/DirectorPanel.tsx) **Satır 289**'da mevcut hafta etütleri olarak `allSlots` süzülür. `etut-sablon` etütleri bu filtrede çıkmaz.
   * **Geçmiş / Arşiv Alt Sistemi (`/api/archive` ve Haftalık Cron)**:
     * [app/api/archive/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/archive/route.ts) **Satır 22–30** ve [app/api/cron/weekly/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/cron/weekly/route.ts) **Satır 45–68** sadece `SlotBooking` tablosunu okur. Öğrencilerin serbest etüt rezervasyonları haftalık devirde arşivlenmez ve geçmişte sorgulanamaz.

---

# GÖREV 3: Hafta-Bazlı Modele Geçerken Riskli Noktalar ve Sessiz Hata İhtimalleri

*(Öncelik Sırasıyla)*

### 1. KRİTİK RİSK 1: Şablon Seviyesinde `studentId` Okuma (Sessiz Global Doluluk Bug'ı)
* **Koddaki Yeri**: [lib/etut/rezervasyon.ts](file:///Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts) **Satır 137–145** (`reserveEtut`) ve [app/api/etut-sablon/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/route.ts) **Satır 141** (`PATCH`).
* **Mevcut Durum & Tehlike**: Rezervasyon yapıldığında `sb.studentId = targetStudentId` ifadesi doğrudan `Teacher.programTemplate` içerisindeki şablon nesnesine yazılmaktadır.
* **Sessiz Hata Riski**: Hafta-bazlı veritabanı veya dictionary yapısına geçildiğinde, koddaki herhangi bir okuma noktası (ör. mobil `today.ts` **Satır 137**, mobil `week.ts` **Satır 53**, `attendance/student/route.ts` **Satır 69**, `listBookableEtuts` **Satır 200**) hâlâ `sb.studentId` okumaya devam ederse, bir haftada alınan etüt **tüm geçmiş ve gelecek haftalarda dolu görünür** veya yanlış haftanın verisini sessizce sunar.

### 2. KRİTİK RİSK 2: Eksik `weekKey` İletimi ve Varsayılan Hafta Fallback'i
* **Koddaki Yeri**: [app/_components/StudentPanel.tsx](file:///Users/mustafa/Workspace/active/okulin/app/_components/StudentPanel.tsx) **Satır 147** (`handleCancel`) ve [app/api/etut-sablon/rezervasyon/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/etut-sablon/rezervasyon/route.ts) **Satır 19** (`DeleteSchema`).
* **Mevcut Durum & Tehlike**: `DELETE /api/etut-sablon/rezervasyon` isteği gönderilirken gövdede `weekKey` **gönderilmemektedir** (`{ teacherId, etutId }`). Servis tarafında `cancelEtut` da `weekKey` parametresi almamaktadır ([lib/etut/rezervasyon.ts](file:///Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts) **Satır 150**).
* **Sessiz Hata Riski**: İptal işlemi hafta-bazlı hale getirildiğinde, `weekKey` verilmezse kod sessizce `getWeekKey()` (içinde bulunulan mevcut hafta) varsayımına düşecektir. Öğrenci veya müdür **sonraki haftadaki (W+1)** etüdünü iptal etmek istediğinde, istek **mevcut haftadaki (W0)** rezervasyonu silmeye çalışacak veya "Rezervasyon bulunamadı" hatası verecektir.

### 3. YÜKSEK RİSK 3: Hafta Yetki ve Erişim Sınırı (Mevcut Hafta + Pazar Açılan Sonraki Hafta)
* **Koddaki Yeri**: Servis tarafında henüz hafta erişim sınırı kontrolü yoktur; [lib/slots.ts](file:///Users/mustafa/Workspace/active/okulin/lib/slots.ts) **Satır 189**'da yalnız `isEditableWeek` (+2 hafta) kontrolü vardır.
* **Mevcut Durum & Tehlike**: İş kuralına göre öğrenci sadece içinde bulunduğu hafta ve Pazar günü açılan sonraki haftaya rezervasyon yapabilmeli; tekrarlayan (tüm haftalar) rezervasyonu yalnız müdür/rehber yapabilmelidir.
* **Sessiz Hata Riski**:
  * Pazar günü geçişinde TSİ (+03) saat dilimi hizalaması yapılmazsa (UTC `getDay()` Pazar gününü farklı saatte başlatabilir), öğrenciye sonraki hafta erken veya geç açılabilir.
  * Sadece istemcide (UI) kısıt koyulup backend API'de (`reserveEtut`) öğrenci rolü için hafta sınırı doğrulanmazsa, API üzerinden gelecek isteklerle 3-4 hafta sonrasına sessizce etüt yazılabilir.

### 4. YÜKSEK RİSK 4: Çakışma Kurallarının (Aynı Saat / Aynı Ders / Matematik Ailesi) Hafta-Bazlı Sorgulanması
* **Koddaki Yeri**: [lib/etut/rezervasyon.ts](file:///Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts) **Satır 55–64** (`studentBookedEtuts`) ve **Satır 125–135** (`branchConflicts`, `mathFamilyConflict`).
* **Mevcut Durum & Tehlike**: Öğrencinin daha önce etüt alıp almadığını kontrol eden `studentBookedEtuts`, `weekKey` parametresi almaktadır ancak içindeki `sb.studentId === studentId` kontrolü şablondan okuduğu için tüm haftalara etki etmekteydi.
* **Sessiz Hata Riski**: Hafta-bazlı modele geçildiğinde `studentBookedEtuts` fonksiyonu **kesin olarak sadece ilgili `weekKey`'e ait rezervasyonları** sorgulamalıdır. Eğer eski bir sorgu veya önbellek (cache) haftalar arası sızarsa, A haftasında Matematik etüdü alan öğrenci B haftasında Matematik etüdü almak istediğinde `"Bu hafta matematik etüdü zaten almış"` engeline takılır.

### 5. ORTA RİSK 5: Geçmiş Slot Filtreleri ve Zaman Karşılaştırmaları (`slotStartTime`)
* **Koddaki Yeri**: [lib/etut/rezervasyon.ts](file:///Users/mustafa/Workspace/active/okulin/lib/etut/rezervasyon.ts) **Satır 111–112** ve [lib/slots.ts](file:///Users/mustafa/Workspace/active/okulin/lib/slots.ts) **Satır 175–186** (`slotStartTime`).
* **Mevcut Durum & Tehlike**: `slotStartTime(weekKey, dayIndex, start)` fonksiyonu ISO hafta string'inden Pazartesi gününü türetip slot saatini `Date.UTC` olarak hesaplar.
* **Sessiz Hata Riski**: `weekKey` gelecek hafta (ör. `2026-W30`) olduğunda `slotStartTime` doğru olarak gelecekteki zamanı verir. Ancak istemci tarafındaki `isSlotPast` fonksiyonu ile backend'deki `Date.now()` karşılaştırması milisaniye ve saat dilimi bazında tam örtüşmezse, Pazar geceleri veya hafta geçiş saatlerinde öğrenciye açık görünen etüt backend'de "Geçmiş bir etüde rezervasyon yapılamaz" hatası ile reddedilebilir.

### 6. ORTA RİSK 6: Yoklama (`Attendance`) Entegrasyonu Kırılması
* **Koddaki Yeri**: [app/api/attendance/student/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/attendance/student/route.ts) **Satır 51 & 69–78**.
* **Mevcut Durum & Tehlike**: Etüt yoklama kayıtları `Attendance.lessonNo` alanında `e<etutId>` formatında tutulur (ör. `e_cm7x...`). API bu `etutId`'yi bulmak için `progCache[teacher.legacyId]?.etutSablonlari` listesini arar.
* **Sessiz Hata Riski**: Etüt rezervasyonları hafta-bazlı modele geçtiğinde, yoklama kartlarının geçmiş etüt detaylarını (saat, ders) doğru gösterebilmesi için şablon `id`'lerinin sabit kalması ve tarih bazlı doğru eşleşmenin korunması gerekir. aksi halde öğrenci devamsızlık dökümünde etüt ders adı boş çıkacaktır.

### 7. DÜŞÜK RİSK 7: `reset-all` Admin İşleminde Etüt Şablonlarının Silinmesi
* **Koddaki Yeri**: [app/api/admin/week/route.ts](file:///Users/mustafa/Workspace/active/okulin/app/api/admin/week/route.ts) **Satır 68**.
* **Mevcut Durum & Tehlike**: `reset-all` komutu `programTemplate: {}` yazarak tüm ders programını sıfırlarken `etutSablonlari` dizisini de sıfırlamaktadır.
* **Sessiz Hata Riski**: Hafta-bazlı etüt yapısına geçildiğinde serbest etüt saat tanımlarının (şablonlarının) korunması, sadece haftalık rezervasyon kayıtlarının temizlenmesi gerekir.

---

### Özeti Sonlandırma ve Sonraki Adım Önerisi
Denetim raporu tamamlanmıştır. Hafta-bazlı modele geçiş uygulamasını başlatmak için bir plan oluşturmamı isterseniz `/plan` komutunu önerebilirim.

---

# EXPLORE AJANI (Claude) BAĞIMSIZ DENETİMİ (2026-07-19)

## Veri modeli (kök neden)
- lib/slots.ts:51-64 EtutSablonu — rezervasyon alanları (studentId/studentName/studentCls/branch/bookedBy/bookedAt) şablona DÜZ yazılı, hafta bilgisi YOK → tüm haftalar dolu (BUG).
- lib/slots.ts:57 pasifHaftalar zaten hafta-scoped (aktiflik). Rezervasyon da aynı desende olmalı.
- lib/slots.ts:68-72 etutAktifThisWeek yalnız aktiflik. Yeni effectiveReservation(sb,weekKey) yanına eklenmeli.

## OKUYAN yerler → effectiveReservation'a çevrilecek
Backend: etut-sablon/all/route.ts:25-43 (MERKEZİ okuma, bug'ın yayıldığı yüzey; veli filtresi 48-52); rezervasyon.ts:55-65 studentBookedEtuts; rezervasyon.ts:107-109 reserveEtut doluluk; :157-158 cancelEtut sahiplik; :200,211,213 listBookableEtuts (mobil); lib/mobile/week.ts:50-54; lib/mobile/today.ts:134-141 (öğrenci/veli) + :261-267 (öğretmen); attendance/student/route.ts:69-77 (branch şablondan — hafta-scoped'a taşınınca boş gelir).
Frontend: StudentPanel.tsx:68-88,103; TeacherPanel.tsx:206,644-646; TeachersTab.tsx:43-44; ParentPanel.tsx:68-72; DTO student-types.ts:29-40.

## YAZAN yerler
- rezervasyon.ts:137-142 reserveEtut (düz yaz, weekKey yazmada kullanılmıyor); :162-163 cancelEtut (weekKey YOK input:150); etut-sablon/route.ts:140-147 PATCH (weekKey/branch/bookedAt YOK, çakışma denetimi YOK).
- Çağıranlar: web rezervasyon/route.ts:21-35 (POST'ta weekKey var, DELETE'te yok); mobil reserve/route.ts:14-38 (contracts.ts:55-60 reserve weekKey VAR, :62-64 cancel YOK); frontend StudentPanel:139,147 / TeacherPanel:666,683 / TeachersTab:55.

## Org geneli /api/slots?week= → SlotBooking-only, etut-sablon KAÇIRILIYOR
- slots/route.ts:56-92 allSlots yalnız getTeacherWeekSlots (SlotBooking). etut-sablon HİÇ yok.
- Kaçıran: DirectorPanel.tsx:141,171,182 → allSlots(84) → StudentList:253 → StudentBookingsView (serbest etüt görünmez + iptal EDİLEMEZ, handler 264-270 sadece /api/slots DELETE); DirectorPanel:289-294 HistoryModal.
- Doğru (merge eden): ParentPanel.tsx:67-72 (/api/slots + /api/etut-sablon/all MERGE). TeachersTab ayrı /api/etut-sablon/all kullanıyor (dün düzeltildi).

## Çakışma kuralları hafta-bazlı olmalı
- Saf: rezervasyon.ts:41-50. Toplama studentBookedEtuts:55-65 → effectiveReservation(sb,weekKey).studentId ile filtrele (yoksa A haftası dolu diye B reddedilir). Doğru referans: slots/route.ts:217-241 (where weekKey+booked+studentId).

## Hafta/geçmiş kullanımı
- getWeekKey constants.ts:251. slotStartTime slots.ts:175-186 (geçmiş: reserveEtut:111, etut-sablon POST:83, /api/slots POST:154). getAdjacentWeek shared.tsx:31-49 (StudentPanel:160 ÜST SINIR YOK). isSlotPast shared.tsx:52-68 (StudentPanel:126). isEditableWeek slots.ts:189-194 (current..+2) YALNIZ grid'e, etüt rezervasyona uygulanMIYOR. Hafta açma cron/weekly:32-36 + admin/week:15-26 etut-sablon'a DOKUNMUYOR.

## Riskler (öncelik)
1. Düz rezervasyon=tüm haftalar (yaz 137-142+PATCH 140-147, oku all:37-42, iptal 162-163 weekKey'siz). Çekirdek.
2. Çakışma yanlış-pozitif (studentBookedEtuts:55-65).
3. Müdür tarafı serbest etüt kaçırıyor (görüntü+iptal).
4. Yoklama branş kaybı (attendance/student:69-77; lessonNo='e'+etutId weekKey içermiyor).
5. PATCH atama diverjansı (weekKey/branch/çakışma yok).
6. İptal şemaları weekKey'siz (contracts:62-64, DeleteSchema:19, cancelEtut:150).
7. Tekrarlı vs tek-hafta ayrımı yok (rol kapısı reserveEtut:82-86 isManager).
8. Öğrenci hafta üst-sınırı yok (reserveEtut:111 sadece geçmiş; StudentPanel:160 sınırsız). isEditableWeek öğrenci varyantı gerek.
Güvenli: program/route.ts:44,161,183,237,244 grid yazarken etutSablonlari opak korunuyor → hafta-scoped altyapı bu yoldan sağ kalır.

## ÜÇ DENETİMİN ORTAK SONUCU (çapraz-doğrulandı)
- Codex + Gemini + Explore: aynı P0'lar. Codex EK önerisi: hafta-bazlı rezervasyonu JSON map yerine AYRI Prisma tablosu + unique(orgSlug,branch,teacherId,etutId,weekKey) ile tut → atomiklik (JSON read-modify-write yarışını önler, SlotBooking gibi).
- Ek gap'ler (denetimlerden, plana dahil): çift-sistem çakışma birleşimi, haftalık limit iki-sistem toplamı, self-booking-kapalı + salt-okunur-rehber kuralları reserveEtut'te YOK, .catch(()=>boş) sessiz-hata yolları hataya çevrilmeli, yoklama snapshot, şablon sil/reset cascade, TSİ Pazar-açılma merkezi hesap.
