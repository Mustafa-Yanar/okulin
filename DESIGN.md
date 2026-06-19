---
name: okulin
colors:
  # Marka (varsayılan indigo — kurum başına --brand ile değişir, white-label)
  brand: "#6366f1"
  brand-deep: "#4f46e5"
  # Yüzeyler (açık tema)
  bg-base: "#f0f2f7"
  bg-surface: "#ffffff"
  bg-surface-2: "#eef1f7"
  bg-muted: "#e2e6ee"
  # Metin (açık tema, WCAG AA)
  text-primary: "#1a1d2e"
  text-secondary: "#5b6270"
  text-muted: "#646a76"
  # Semantik (açık tema)
  success: "#16a34a"
  warning: "#b45309"
  danger: "#dc2626"
  info: "#2563eb"
  # Karanlık tema yüzeyleri
  dark-bg-base: "#0f1117"
  dark-bg-surface: "#1a1d2e"
  dark-bg-surface-2: "#252836"
  dark-text-primary: "#e8eaf0"
---

# Tasarım Sistemi: okulin

Eğitim/kurum yönetim platformu (dershane + okul). Çok-kiracılı (white-label), rol-bazlı paneller (müdür / rehber / öğretmen / öğrenci / veli / muhasebe / süper-admin). Next.js 14 (App Router) + Tailwind + `globals.css` CSS değişken sistemi + Geist + lucide-react. Açık & karanlık tema (`html.dark`).

> **Not:** Tasarım sistemi Tailwind config'de DEĞİL — `app/globals.css`'teki CSS özel değişkenlerinde (`:root` / `html.dark`) yaşıyor. Tailwind yalnız utility taşıyıcı; gerçek token kaynağı burası.

## 1. Görsel Tema & Atmosfer

okulin sakin, profesyonel, **"Linear / Stripe"** hissinde bir kurumsal kontrol panelidir — kod yorumlarında bu referans açıkça geçer ("Linear/Stripe hissi", "iOS inner-rounded"). Açık temada yumuşak gri-mavi bir zemin (`#f0f2f7`) üzerine saf beyaz yüzeyler oturur; derinlik **ince 1px kenarlık + hafif yükselme gölgesi** ile taşınır — ne tamamen düz, ne de ağır floating. Renk az ve amaçlıdır: tek bir marka vurgusu (varsayılan indigo, kurum başına değişir) gezinme, aktif durum ve odak halkalarını sürer; geri kalan her şey nötr gri tonlarıdır. Hiyerarşi **renkten çok boyut ve ağırlıkla** kurulur (erişilebilirlik gereği bilinçli tercih).

Erişilebilirlik birinci sınıf bir kaygıdır: `globals.css` boyunca **WCAG AA (4.5:1)** kontrast ayarlarının ayrıntılı yorumları var (gri panel zeminine göre metin tonları tek tek hesaplanmış). Yoğunluk dashboard-uygun: bilgi yoğun ama nefes alan, kart-bazlı düzen. Genel his: **rafine ama gösterişsiz, güvenilir, kurumsal.**

## 2. Renk Paleti & Roller

### Birincil Zemin (Yüzeyler)
| İsim | Açık | Karanlık | Rol |
|---|---|---|---|
| Sayfa zemini | `#f0f2f7` yumuşak gri-mavi | `#0f1117` gece | Kök arka plan |
| Yüzey | `#ffffff` | `#1a1d2e` | Kart, modal, aktif pill |
| Yüzey-2 | `#eef1f7` | `#252836` | Input, ghost buton, ikincil panel |
| Muted | `#e2e6ee` | `#2d3144` | Hover zemini, ayraç bloğu |

### Vurgu & Etkileşim
- **Marka (varsayılan):** İndigo `#6366f1` → gradient `#4f46e5`. **Kurum başına `--brand` ile override** (white-label). Tüm aktif gezinme, pill aktif sekme, odak halkası, nav-item bunu kullanır (`color-mix` ile şeffaf tonlamalar).
- Kenarlıklar: subtle `rgba(0,0,0,0.09)`, light `rgba(0,0,0,0.12)` (karanlıkta beyaz alfa).

### Tipografi & Metin Hiyerarşisi
| İsim | Açık | Karanlık | Kontrast notu |
|---|---|---|---|
| Birincil | `#1a1d2e` | `#e8eaf0` | Başlık/gövde |
| İkincil | `#5b6270` | `#9ca3af` | Alt metin (gri zeminde 5.47 ✅) |
| Muted | `#646a76` | `#9ca3af` | Caption/label (AA ✅) |

### İşlevsel Durumlar (metin / bg / border üçlüsü)
| Durum | Açık metin | Açık bg | Karanlık metin |
|---|---|---|---|
| Başarı | `#16a34a` | `#f0fdf4` | `#4ade80` |
| Uyarı | `#b45309` (amber-700, AA için) | `#fffbeb` | `#fbbf24` |
| Hata | `#dc2626` | `#fef2f2` | `#f87171` |
| Bilgi | `#2563eb` | `#eff6ff` | `#60a5fa` |

> Tailwind'in ham renk sınıfları (`text-red-500`, `text-amber-600`, `text-gray-400`…) açık temada AA'yı geçemediği için `globals.css`'te koyu eşdeğerlerine bağlanmış — yeni kodda **ham Tailwind renk sınıfı yerine token/semantik sınıf** kullan.

## 3. Tipografi Kuralları

**Font:** **Geist** (400/500/600/700/800, Google Fonts) + sistem yedeği; mono: `SF Mono`/`Fira Code`. Geist = nötr, geometrik-humanist, modern SaaS hissi (impeccable'ın "Inter kullanma" kuralına zaten uyumlu).

### Hiyerarşi & Ağırlıklar
| Sınıf | Boyut | Ağırlık | Letter-spacing | Line-height |
|---|---|---|---|---|
| `.text-display` | 28px | 800 | -0.03em | 1.2 |
| `.text-heading` | 20px | 700 | -0.02em | 1.3 |
| `.text-subheading` | 16px | 600 | -0.01em | 1.4 |
| `.text-body` | 14px | 400 | — | 1.6 |
| `.text-body-sm` | 13px | 400 | — | 1.5 |
| `.text-label` | 11px | 700 | 0.06em + UPPERCASE | 1 |
| `.text-caption` | 12px | 400 | — | 1.4 |

Negatif letter-spacing büyük başlıklarda (sıkı, premium); pozitif + uppercase küçük etiketlerde. Gövde line-height cömert (1.6), display sıkı (1.2).

## 4. Bileşen Stilleri

### Butonlar
- **Gradient aksiyon** (`.btn-primary` indigo, `.btn-success` yeşil, `.btn-danger` kırmızı): radius **10px**, ağırlık 600, gölge + inset highlight. Hover: `translateY(-1px)` + güçlenen gölge. Active: lift sıfırlanır. Geçiş: `transform fast, box-shadow base` (açık özellik — `all` değil).
- **Ghost** (`.btn-ghost`): tam yuvarlak pill (9999px), surface zemin, 1px border; hover'da yüzey+metin koyulaşır; active `scale(0.97)`.
- **İkon** (`.btn-icon`): 32px daire, şeffaf; hover'da muted zemin; active `scale(0.95)`. Renk varyantları (danger/info/warning/success hover).

### Kartlar & Konteynerler
- `.card`: radius **16px**, 1px light border + katmanlı yumuşak gölge (inset highlight + 1px + 4px). `.card-elevated`: 20px, biraz daha yüksek.
- `.card-hover` / `.card-interactive`: hover'da `translateY(-2px)` + `shadow-md`; active `scale(0.98)`. Tıklanabilir his.
- `.modal`: radius **24px** (`--radius-2xl`), header/body/footer yapısı.

### Gezinme
- **Sidebar:** genişlik geçişli; Canva-tarzı dikey pill daralt/genişlet tutamağı (kenara yapışık, tüm yüzey tıklanır). `.nav-item-active` = marka-tonlu zemin + **3px sol marka çubuğu** + inset 1px.
- **Pill sekmeler** (`.pill-tabs` / `.pill-tab.is-active`): marka-tonlu yuvarlak şerit; aktif sekme = surface kapsül + ince marka çerçeve + yumuşak yükseklik gölgesi ("iOS inner-rounded"). 480px altı: tam genişlik eşit böler, metin `…` ile kısalır.

### Inputlar & Formlar
- `.input`: surface-2 zemin, 1px border, **10px** radius. Odak: marka border + **3px marka halo** (`color-mix 14%`). `.input-error`/`.input-success` kırmızı/yeşil halo. `:focus-visible` 2px indigo outline (klavye).
- `.badge`: 6px radius pill, semantik bg+metin+border üçlüsü, 11px/600.

### Alan-özel bileşenler
Ders/etüt slot grid (haftalık program), giriş ekranı rol kartları (hover glow `::before` radial), durum noktaları (`.status-dot-*`), pull-to-refresh kabarcık animasyonları.

## 5. Düzen İlkeleri

### Grid & Yapı
Rol-bazlı çok-panelli dashboard (her rol kendi paneli). Kart-bazlı bölümler; `.section-header` (başlık + aksiyon, space-between). İçerik genişliği panel-bazlı sınırlı.

### Boşluk Stratejisi
Radius ölçeği: sm 8 / md 12 / lg 16 / xl 20 / 2xl 24 px. Kart iç boşluğu 16–24px, modal 20–24px. Genel ritim 4px tabanlı.

### Hareket (motion)
**Tek easing eğrisi:** `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)` (hızlı başla, yumuşak otur). Süreler: fast 0.12s / base 0.18s / slow 0.28s — **hepsi <300ms**. Keyframe'ler: enter-up, enter-scale (0.95'ten), slide-in, modal-in (0.97'den) — hiçbiri `scale(0)` değil. `prefers-reduced-motion` onurlandırılır (hareket anında biter). Emil Kowalski craft bar'ından geçer.

### Duyarlılık & Dokunma
Ana kırılma 480px (pill sekmeler tam genişliğe yayılır). Dokunma hedefleri ≥32px. Tarayıcı pull-to-refresh kapalı (uygulamanın kendi göstergesi çalışır).

## 6. Tasarım Sistemi Notları (üretim için)

### Kullanılacak dil
"Sakin kurumsal dashboard, Linear/Stripe rafineliği, gri-mavi zemin + beyaz yüzey, tek marka vurgusu (indigo varsayılan, kurum-özel), ince 1px kenarlık + yumuşak yükselme gölgesi, Geist tipografi, sıkı başlık letter-spacing'i, sub-300ms ease-out hareket."

### Renk referansları
Marka indigo `#6366f1`; zemin `#f0f2f7`; yüzey `#ffffff`; metin `#1a1d2e`. Semantik: yeşil `#16a34a`, amber `#b45309`, kırmızı `#dc2626`, mavi `#2563eb`. **Daima `var(--token)` kullan, ham hex/Tailwind-renk değil** (tema + white-label + AA için).

### Yeni bileşen üretirken
1. Token'lardan başla (`--bg-surface`, `--text-primary`, `--brand`, `--radius-*`, `--transition-*`).
2. Yüzey ayrımını 1px border + hafif gölgeyle taşı, ağır gölgeden kaçın.
3. Etkileşime hover-lift + active-scale (0.95–0.98) ekle; geçişte `all` değil açık özellik.
4. Karanlık tema otomatik gelir (token'lar `html.dark`'ta tanımlı) — sabit renk yazma.
5. Hiyerarşiyi boyut/ağırlıkla kur, salt renge güvenme (AA).
