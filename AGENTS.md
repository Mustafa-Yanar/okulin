# Etüttakip — AI Agent Bağlamı

> Araç-bağımsız proje bağlamı. Claude Code, Gemini Code Assist, Cursor vb. hepsi bunu okur.
> Hassas bilgiler (credential, token, şifre) burada DEĞİL — `CLAUDE.local.md`'de (gitignore'da).

## Proje
Eğitim/etüt takip uygulaması: öğrenci-öğretmen-ders-yoklama-program yönetimi + otomatik ders programı oluşturucu.
- **Stack:** Next.js 14 (App Router) + Upstash Redis (KV) + bcryptjs/jose (JWT auth) + Tailwind + lucide-react + xlsx.
- **Çözücü:** Google OR-Tools CP-SAT (Python serverless, Vercel).
- **Deploy:** Vercel, her push otomatik (~40-50s). Canlı: https://cozumetut.vercel.app
- **Dil:** Türkçe (kod yorumları + UI + commit mesajları Türkçe).

## Çalışma kuralı (commit & deploy)
Her özellik/düzeltme tamamlanınca onay beklemeden: değişen dosyaları `git add <dosya>` (`-A` KULLANMA), açıklayıcı Türkçe commit, push → Vercel otomatik deploy. **Koşul: build başarılı geçmeli** (`npm run build`), kırıksa commit atma. Commit mesajı sonu `Co-Authored-By:`.

## Klasör yapısı
- `app/` — App Router sayfaları + API routes. `app/page.js` ana SPA (çok büyük tek dosya: director/teacher/student panelleri).
- `app/api/*/route.js` — Node.js endpoint'leri (27 route: admin, auth, attendance, slots, program, program-solve, teachers, students, class-schedule, cron, deneme, guidance vb.).
- `api/solve.py` + `api/solver/` — Python CP-SAT çözücü (kök `api/`, Next'in `app/api`'sinden AYRI).
- `lib/` — `constants.js` (gruplar/slotlar/branşlar/COL_COURSES), `slots.js` (Redis slot/program helpers), `auth.js` (jose JWT), `redis.js`, `teacherMigrate.js`.

## Redis şeması
- `teachers` set → `teacher:<id>` = `{id, name, username, passwordHash, branches[], allowedGroups, offDays, photoUrl}`.
- `students` set → `student:<id>` = `{id, name, cls, group, ...}`.
- `program:<id>` → ders programı ŞABLONU (haftadan bağımsız, kalıcı): `{[dayIdx]:{[slotId]:{type:'available'|'ders'|'etut', cls?, branch?, studentId?, fixed?}}}`. `type:'available'` = müdürün "bu slotta ders verilebilir" işareti.
- `slot:<weekKey>:<teacherId>:<dayIdx>:<slotId>` → o haftanın grid hücresi (TTL 16 gün).
- `current_week`, `slot_times`, `director`.

## Gruplar & sınıflar (lib/constants.js)
- Ortaokul: 701,702 (7), 801,802 (8). Lise: 9→101,102; 10→201,202; 11Say→301-303, 11EA→304-306; 12Say→401-405, 12EA→406-410. Mezun: Say m1-m5, EA m6-m10.
- 12.sınıf "lise" grubunda ama TYT/AYT/Geometri görür.

## Branş sistemi (ÖNEMLİ — 2026-05 refactor)
- Öğretmen: tek `branches: string[]` (eski `branch`+`extraBranches` KALDIRILDI). **Ders adı = branş adı, otomatik eşleme YOK.**
- Grup→branş matrisi (`BRANCHES_BY_GROUP`):
  - ortaokul: Türkçe, Matematik, Fen Bilgisi, Sosyal Bilgiler, İnkılap Tarihi, İngilizce
  - lise: Türkçe, Matematik, TYT Matematik, AYT Matematik, Geometri, Fizik, Kimya, Biyoloji, Tarih, Coğrafya, Felsefe
  - mezun: Türkçe, TYT Matematik, AYT Matematik, Geometri, Fizik, Kimya, Biyoloji, Tarih, Coğrafya, Felsefe
- Öğretmen branş seçimi `allowedGroups`'a göre kısıtlı. Matematik tek branş (kapsam allowedGroups'tan); 9-11'de "Matematik", 12+mezun'da TYT/AYT/Geometri ayrı dersler.
- Eligible: `course in teacher.branches && group in allowedGroups`.

## Otomatik ders programı (CP-SAT)
- Akış: `ProgramOlusturucu.js generate()` → `POST /api/program-solve` (Node, director auth) → `/solve` (next.config.js rewrite → `api/solve.py`) → `api/solver/model.py`.
- **Proxy URL kritik:** production'da sabit alias `cozumetut.vercel.app` kullanır (VERCEL_URL deployment-protection'a takılır). `SOLVER_SHARED_SECRET` ile korunur.
- Blok = aynı gün 2 ardışık slot, aynı öğretmen. Mezun: Pzt-Per × w1-w6 (12 blok). Lise: hafta sonu e1-e12 (6 blok/gün, sınır yok — 2026-05-29 kaldırıldı) + hafta içi w10-w11. Ortaokul: hafta sonu e1-e10 + hafta içi w10-w11. Hafta içi w1-w6 sadece mezun.
- Kısıtlar (HARD): bir sınıf-ders tek öğretmen (TYT/AYT/Geometri ayrı); aynı sınıf+ders aynı gün max 1 blok; öğretmen/sınıf (gün,slot) tek; izin günü (offDays); KATI aktif-slot (sadece müdürün `available` işaretlediği slotlar — işaretsiz öğretmene ders YOK). SOFT: maxWeekly aşımı + yük dengeleme.
- Ön eşleştirme (preset): müdür öğretmen→sınıf→ders kilitler (HARD).
- Çözücü çıktısı `{assigned, unplaced, tLoad, presetWarnings, ms}`. `slot` 0-tabanlı index.
- Lokal test: `cd api && ../.venv-solver/bin/python -m solver._harness` (venv + ortools gerekir).

## Etüt sistemi kuralları
- Öğrenci rezervasyonda ders (branş) seçer; slot'a yazılır. Seçilebilir = `teacher.branches ∩ allowedBranchesForClass(cls)`.
- Aynı dersten haftada 2. etüt YOK. 12/mezun: TYT/AYT/Geometri "matematik ailesi" → yalnız birinden alınabilir. Müdür bypass eder.

## Dikkat / tuzaklar
- Upstash boş pipeline'da `.exec()` → "Pipeline is empty" hatası. Komut eklenmemişse exec etme.
- `lib/slots.js getAllTeachers` + `teachers GET` eski şemayı `normalizeTeacher` ile çevirir (savunma).
- macOS'ta `timeout` komutu yok; `vercel logs` için arka plan + dosya yönlendirme kullan.
- Mock/test endpoint prod'da bırakma. Auth token client'a expose etme. `.env.local`/credentials commit etme.

## Sonradan Eklenen Büyük Özellikler (2026-05/06)

Aşağıdaki özellikler projeye eklendi — detay hafıza dosyalarında (`~/.claude/projects/.../memory/`).

- **Multi-tenant:** `t:<org>:<branch>:` Redis prefix. `lib/tenant.js` + `lib/db.js` (Proxy). `lib/org.js` host→org/branch. Middleware x-org/x-branch header. Şu an tek kurum (cozum/main), altyapı hazır.
- **Roller:** director, counselor (rehber = müdür eksi muhasebe), teacher, student, parent, accountant, org_admin, superadmin. `isManager(session)` = director||counselor. `lib/auth.js`.
- **Veli paneli:** telefon-bazlı, salt-okunur (program/ödeme/rehberlik/duyurular). İlk şifre = telefon.
- **Muhasebe:** `app/api/finance/` — öğrenci tahsilatı + `expense/` (kurum giderleri + personel maaş/ek ödeme). `app/_components/finance/`.
- **LMS Kütüphane:** PDF/video/link kaynakları, Vercel Blob, sınıf bazlı hedefleme. `app/api/resources/`.
- **Duyuru sistemi:** müdür/rehber → rol×kapsam hedefleme, okundu takibi, push bildirimi. `app/api/announcements/`.
- **Ödeme altyapısı (PayTR):** BYO-keys model (her kurum kendi hesabını bağlar). `lib/payment/crypto.js` (AES-256-GCM), `lib/payment/paytr.js` (createToken/verifyCallback), `lib/payment/index.js` (sağlayıcı soyutlaması — iyzico sonra eklenir). `lib/finance.js` `applyInstallmentPayment` ortak helper. `app/api/payment/config|start|callback`. Veli panelinde "Öde" butonu + iframe modal. Canlıda test edildi (2026-06-01). **Gerçek PayTR hesabı bekleniyor.**
- **Cron:** haftalık slot (`0 8 * * 0`), günlük yedek (`0 0 * * *`), günlük ödeme hatırlatma push'u (`0 6 * * *`). `vercel.json`.
- **Web Push:** `lib/push.js` `sendPushToUser(role, userId, payload)`. VAPID.
- **Kurum markalama:** `api/org` → `org:<slug>` global kayıt (renk/logo/isim). Dinamik PWA manifest.
- **`lib/finance.js`:** applyInstallmentPayment — manuel ödeme + online callback ortak helper (çift kredilendirme yok).

## Mevcut açık işler (Mustafa elle yapacak)
- ~~Migration sonrası fazla branş temizliği~~ — ARTIK GEÇERSİZ (2026-06-04): gerçek öğretmen kayıtları silindi, canlıda yalnız test kaydı var. Yeni öğretmenler TeacherForm'dan doğru branşla girilince sorun oluşmaz.
- Gerçek PayTR mağaza hesabı aç → Settings'e gir → test_mode'da dene → active aç.
- Mali müşavire danış: GVK 20/B istisna mı, şahıs şirketi mi (lisans geliri modeli).
