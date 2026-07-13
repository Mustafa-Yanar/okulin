'use client';

// okulin apex (okulin.com) tanıtım sayfası. Kurum-bağımsız.
// İki kitle: (1) mevcut kurum kullanıcısı → "Giriş Yap" (kurum kodu) → /api/gate → subdomain.
//           (2) yeni kurum (satış) → "Kurumunuz için deneyin" → demo formu (/api/demo-request).
// Modern/sade SaaS dili; uygulamanın mevcut tasarım token'larıyla (card, pill,
// --brand, brand-tonlu ikon daireleri) uyumlu. Sahte referans YOK — dürüst hikaye.

import { useState, useEffect, useRef } from 'react';
import {
  CalendarClock, Users, Sparkles, ClipboardCheck, LineChart, UsersRound,
  Wallet, BookOpen, Megaphone, ArrowRight, X, LogIn, ShieldCheck, Zap, Heart,
  Building2, GraduationCap, HeartHandshake, User, Quote, Receipt, ChevronDown,
  Send, CheckCircle2, Moon, Sun,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Logo from './Logo';
import { useDarkMode } from './ThemeToggle';
import { formatCode, normalizeCode } from '@/lib/orgcode';

// Landing üst barında tema değiştirici (uygulama içiyle aynı mekanizma: useDarkMode).
function DarkToggle() {
  const { dark, toggle } = useDarkMode();
  return (
    <button
      onClick={toggle}
      aria-label={dark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
      title={dark ? 'Aydınlık temaya geç' : 'Karanlık temaya geç'}
      className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-colors hover:bg-[var(--bg-muted)]"
      style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
    >
      {dark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: CalendarClock, title: 'Etüt & Rezervasyon', desc: 'Öğrenciler ders bazlı etüt seçer, slotlar otomatik dolar; haftalık takip tek ekranda.' },
  { icon: Users, title: 'Öğrenci & Öğretmen', desc: 'Sınıf, grup, branş ve izin günleriyle eksiksiz kayıt yönetimi.' },
  { icon: Sparkles, title: 'Otomatik Ders Programı', desc: 'Kısıtları siz koyun, çözücü en uygun haftalık programı saniyeler içinde kursun.' },
  { icon: ClipboardCheck, title: 'Yoklama', desc: 'Günlük sınıf yoklaması, devamsızlık takibi ve veli bilgilendirmesi.' },
  { icon: LineChart, title: 'Deneme Analizi', desc: 'TYT/AYT net gelişimi, ders bazlı grafikler, optik form okuma.' },
  { icon: UsersRound, title: 'Veli Paneli', desc: 'Program, ödeme, rehberlik ve duyurular velinin telefonunda.' },
  { icon: Wallet, title: 'Muhasebe', desc: 'Tahsilat, taksit, kurum giderleri ve personel ödemeleri tek yerde.' },
  { icon: BookOpen, title: 'LMS Kütüphane', desc: 'PDF, video ve bağlantı kaynaklarını sınıf bazlı paylaşın.' },
  { icon: Megaphone, title: 'Duyuru & Bildirim', desc: 'Rol ve kapsam hedefli duyurular, anlık push bildirimleri.' },
];

const ROLES: { icon: LucideIcon; title: string; points: string[] }[] = [
  {
    icon: Building2, title: 'Müdür & Yönetici',
    points: ['Tüm kurumu tek panelden yönetin', 'Otomatik ders programı oluşturun', 'Tahsilat, gider ve maaş takibi', 'Rol ve kapsam hedefli duyurular'],
  },
  {
    icon: GraduationCap, title: 'Öğretmen',
    points: ['Etüt ve ders programını görün', 'Hızlı yoklama alın', 'Deneme sonuçlarını analiz edin', 'Sınıfa kaynak paylaşın'],
  },
  {
    icon: HeartHandshake, title: 'Veli',
    points: ['Çocuğunun programını takip edin', 'Ödemeleri görün ve online ödeyin', 'Rehberlik notlarına erişin', 'Duyuruları anında alın'],
  },
  {
    icon: User, title: 'Öğrenci',
    points: ['Etüt rezervasyonu yapın', 'Haftalık programınızı görün', 'Deneme netlerinizi izleyin', 'Ders kaynaklarına ulaşın'],
  },
];

const STEPS = [
  { n: '1', title: 'Kurumunuzu tanımlayın', desc: 'Logo, marka rengi, sınıflar ve branşlar — okulin kurumunuza özel açılır.' },
  { n: '2', title: 'Ekibinizi ekleyin', desc: 'Öğretmen, öğrenci ve velileri tek tek ya da Excel ile içeri aktarın.' },
  { n: '3', title: 'Yönetmeye başlayın', desc: 'Program, yoklama, ödeme ve iletişim tek ekranda akıcı şekilde işler.' },
];

const HIGHLIGHTS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Zap, title: 'Dakikalar içinde hazır', desc: 'Kurulum yok; kurumunuzun kodu ile giriş yapın, kendi logonuzla başlayın.' },
  { icon: ShieldCheck, title: 'Güvenli ve izole', desc: 'Her kurumun verisi ayrı; rol bazlı yetkiler ve şifreli ödeme altyapısı.' },
  { icon: Receipt, title: 'Şeffaf fiyat', desc: 'Sabit yıllık lisans. Öğrenci başına ücret yok, işlem komisyonu yok — ne ödeyeceğinizi baştan bilirsiniz.' },
  { icon: Heart, title: 'Öğretmen tarafından tasarlandı', desc: 'Sahadaki gerçek ihtiyaçlardan doğdu; gereksiz karmaşa yok.' },
];

const FAQ = [
  { q: 'Verilerim güvende mi?', a: 'Her kurumun verisi tamamen ayrı ve izole tutulur. Şifreler şifrelenerek saklanır, erişim role göre sınırlandırılır. Ödeme altyapısı uçtan uca şifrelidir.' },
  { q: 'Kendi logomu ve rengimi kullanabilir miyim?', a: 'Evet. Kurumunuz kendi logosu ve marka rengiyle açılır; öğretmen, veli ve öğrenciye okulin değil, sizin kurumunuz olarak görünür.' },
  { q: 'Mobilde çalışır mı?', a: 'Evet. Tarayıcıdan çalışır ve telefona uygulama gibi eklenebilir (PWA). Ayrı kurulum veya mağaza indirme gerekmez.' },
  { q: 'Kaç öğrenci veya öğretmen ekleyebilirim?', a: 'Sınır yok. Küçük bir etüt merkezinden çok şubeli kuruma kadar ölçeklenir; veli ve öğrenci erişimi dahildir.' },
  { q: 'Kurulum ne kadar sürer?', a: 'Kurumunuz tanımlandıktan sonra dakikalar içinde giriş yapıp kullanmaya başlarsınız. İstersek öğrenci ve öğretmen listenizi içeri aktarmanıza yardımcı oluruz.' },
  { q: 'Ödeme nasıl işliyor?', a: 'Sabit yıllık lisans modeli; öğrenci başına ücret veya işlem komisyonu yoktur. Detaylar için bizimle iletişime geçmeniz yeterli.' },
];

export default function Landing() {
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <div style={{ background: 'var(--bg-base)', minHeight: '100vh' }}>
      {/* ── Üst bar ───────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30" style={{ background: 'color-mix(in srgb, var(--bg-base) 85%, transparent)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <Logo size="md" />
          <nav className="hidden md:flex items-center gap-7 text-sm" style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            <a href="#ozellikler" className="hover:text-[var(--text-primary)] transition-colors">Özellikler</a>
            <a href="#roller" className="hover:text-[var(--text-primary)] transition-colors">Kimler kullanır</a>
            <a href="#sss" className="hover:text-[var(--text-primary)] transition-colors">SSS</a>
            <a href="#iletisim" className="hover:text-[var(--text-primary)] transition-colors">İletişim</a>
          </nav>
          <div className="flex items-center gap-2 shrink-0">
            <DarkToggle />
            <button onClick={() => setModalOpen(true)} className="btn-primary !px-5 !py-2 flex items-center gap-2 text-sm">
              <LogIn size={15} /> Giriş Yap
            </button>
          </div>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 pt-16 pb-20 md:pt-24 md:pb-28 grid md:grid-cols-2 gap-12 items-center">
        <div>
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-5"
            style={{ fontWeight: 600, background: 'color-mix(in srgb, var(--brand,#6366f1) 10%, transparent)', color: '#6366f1', border: '1px solid color-mix(in srgb, var(--brand,#6366f1) 22%, transparent)' }}>
            <Sparkles size={13} /> Eğitim kurumları için yönetim platformu
          </span>
          <h1 className="tracking-tight" style={{ fontSize: 'clamp(2rem, 5vw, 3.25rem)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
            Kurumunuzu <span style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>tek panelden</span> yönetin
          </h1>
          <p className="mt-5 text-lg max-w-xl" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            Öğrenci, öğretmen, yoklama, ders programı, deneme analizi, veli iletişimi ve muhasebe —
            hepsi tek, sade bir sistemde. Dershane, etüt merkezi ve özel öğretim kursları için.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href="#iletisim" className="btn-primary !px-6 !py-3 flex items-center gap-2 text-base">
              Kurumunuz için deneyin <ArrowRight size={18} />
            </a>
            <button onClick={() => setModalOpen(true)} className="btn-ghost !px-6 !py-3 flex items-center gap-2 text-base">
              <LogIn size={17} /> Kurum koduyla giriş
            </button>
          </div>
        </div>
        <HeroPreview />
      </section>

      {/* ── Özellikler ────────────────────────────────────────────── */}
      <section id="ozellikler" className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.6rem,4vw,2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Kurumun ihtiyacı olan her şey
          </h2>
          <p className="mt-3 text-base" style={{ color: 'var(--text-secondary)' }}>
            Tek tek farklı araçlar yerine, eğitim sürecinin tamamı için bütünleşik bir sistem.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => <FeatureCard key={f.title} {...f} />)}
        </div>
      </section>

      {/* ── Kimler kullanır (Roller) ──────────────────────────────── */}
      <section id="roller" style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-20">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.6rem,4vw,2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Herkes için doğru ekran
            </h2>
            <p className="mt-3 text-base" style={{ color: 'var(--text-secondary)' }}>
              Müdürden öğrenciye kadar her rol, yalnızca ihtiyacı olanı görür.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {ROLES.map((r) => <RoleCard key={r.title} {...r} />)}
          </div>
        </div>
      </section>

      {/* ── Nasıl çalışır ─────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="text-center max-w-2xl mx-auto mb-12">
          <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.6rem,4vw,2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Üç adımda başlayın
          </h2>
          <p className="mt-3 text-base" style={{ color: 'var(--text-secondary)' }}>
            Kurmak günler değil, dakikalar sürer.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-5">
          {STEPS.map((s, i) => <StepCard key={s.n} {...s} last={i === STEPS.length - 1} />)}
        </div>
      </section>

      {/* ── Hikaye ────────────────────────────────────────────────── */}
      <section style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-3xl mx-auto px-5 py-16 md:py-20 text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-6"
            style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)', color: '#6366f1' }}>
            <Quote size={24} />
          </div>
          <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.4rem,3.5vw,2rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            okulin nasıl doğdu?
          </h2>
          <p className="mt-5 text-lg" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            okulin'i, bir dershanede ders veren bir matematik öğretmeni geliştirdi.
            Dağınık Excel dosyaları, kaybolan yoklamalar, takip edilemeyen ödemeler ve
            elle hazırlanan ders programları… Bu günlük sorunları çözmek için yola çıktı.
          </p>
          <p className="mt-4 text-lg" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Bu yüzden okulin kurumsal bir yazılım gibi karmaşık değil; sahadan gelen,
            öğretmenin ve yöneticinin gerçekten kullanacağı kadar sade bir sistem.
          </p>
        </div>
      </section>

      {/* ── Neden okulin ──────────────────────────────────────────── */}
      <section id="neden" className="max-w-6xl mx-auto px-5 py-16 md:py-20">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
          {HIGHLIGHTS.map((h) => {
            const Icon = h.icon;
            return (
              <div key={h.title}>
                <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)', color: '#6366f1' }}>
                  <Icon size={22} strokeWidth={2} />
                </div>
                <h3 className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{h.title}</h3>
                <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{h.desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── SSS ───────────────────────────────────────────────────── */}
      <section id="sss" style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-3xl mx-auto px-5 py-16 md:py-20">
          <div className="text-center mb-12">
            <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.6rem,4vw,2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Sık sorulan sorular
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {FAQ.map((f, i) => <FaqItem key={i} {...f} />)}
          </div>
        </div>
      </section>

      {/* ── İletişim / Demo ───────────────────────────────────────── */}
      <DemoSection />

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <div className="flex items-center gap-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <a href="#ozellikler" className="hover:text-[var(--text-primary)] transition-colors">Özellikler</a>
            <a href="#sss" className="hover:text-[var(--text-primary)] transition-colors">SSS</a>
            <button onClick={() => setModalOpen(true)} className="hover:text-[var(--text-primary)] transition-colors">Kurum girişi</button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            © {new Date().getFullYear()} okulin
          </p>
        </div>
      </footer>

      {modalOpen && <CodeModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="card p-5 transition hover:-translate-y-0.5" style={{ transitionDuration: '160ms' }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 10%, var(--bg-surface))', color: '#6366f1' }}>
        <Icon size={21} strokeWidth={2} />
      </div>
      <h3 className="text-base" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{desc}</p>
    </div>
  );
}

function RoleCard({ icon: Icon, title, points }: { icon: LucideIcon; title: string; points: string[] }) {
  return (
    <div className="card p-5">
      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-4"
        style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff' }}>
        <Icon size={21} strokeWidth={2} />
      </div>
      <h3 className="text-base mb-3" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      <ul className="flex flex-col gap-2">
        {points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" style={{ color: '#6366f1' }} />
            <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepCard({ n, title, desc }: { n: string; title: string; desc: string; last?: boolean }) {
  return (
    <div className="card p-6">
      <div className="w-10 h-10 rounded-full flex items-center justify-center mb-4 text-lg"
        style={{ fontWeight: 800, background: 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)', color: '#6366f1' }}>
        {n}
      </div>
      <h3 className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{desc}</p>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left"
        aria-expanded={open}
      >
        <span className="text-base" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{q}</span>
        <ChevronDown
          size={18}
          className="shrink-0 transition-transform"
          style={{ color: 'var(--text-muted)', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>
      {open && (
        <p className="px-5 pb-4 -mt-1 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{a}</p>
      )}
    </div>
  );
}

// Hero görseli — uygulamayı andıran sade CSS mockup (gerçek ekran görüntüsü değil).
function HeroPreview() {
  return (
    <div className="relative hidden md:block">
      <div className="absolute -inset-6 rounded-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle at 70% 30%, color-mix(in srgb, var(--brand,#6366f1) 22%, transparent), transparent 70%)' }} />
      <div className="card-elevated relative overflow-hidden p-0">
        {/* sahte üst bar */}
        <div className="flex items-center gap-2 px-4 h-11" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <Logo size="sm" wordmark={false} />
          <div className="h-2.5 w-20 rounded-full" style={{ background: 'var(--bg-muted)' }} />
          <div className="ml-auto h-6 w-16 rounded-lg" style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 14%, transparent)' }} />
        </div>
        <div className="flex">
          {/* sahte sidebar */}
          <div className="w-14 shrink-0 py-3 flex flex-col items-center gap-3" style={{ borderRight: '1px solid var(--border-subtle)', background: 'var(--bg-surface)' }}>
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="w-7 h-7 rounded-lg" style={{ background: i === 0 ? 'color-mix(in srgb, var(--brand,#6366f1) 16%, transparent)' : 'var(--bg-muted)' }} />
            ))}
          </div>
          {/* sahte içerik */}
          <div className="flex-1 p-4">
            {/* pill sekmeler */}
            <div className="inline-flex gap-1 p-1 rounded-full mb-4" style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 6%, var(--bg-surface))', border: '1px solid color-mix(in srgb, var(--brand,#6366f1) 14%, transparent)' }}>
              <div className="h-6 w-16 rounded-full" style={{ background: 'var(--bg-surface)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--brand,#6366f1) 26%, transparent)' }} />
              <div className="h-6 w-16 rounded-full" />
              <div className="h-6 w-16 rounded-full" />
            </div>
            {/* mini grafik */}
            <div className="flex items-end gap-2 h-24 mb-4">
              {[40, 65, 50, 80, 60, 95, 75].map((h, i) => (
                <div key={i} className="flex-1 rounded-t-md" style={{ height: `${h}%`, background: `linear-gradient(180deg, color-mix(in srgb, var(--brand,#6366f1) ${30 + i * 6}%, transparent), color-mix(in srgb, var(--brand,#6366f1) 6%, transparent))` }} />
              ))}
            </div>
            {/* liste satırları */}
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center gap-3 py-2" style={{ borderTop: i ? '1px solid var(--border-subtle)' : 'none' }}>
                <div className="w-8 h-8 rounded-lg" style={{ background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', opacity: 0.85 }} />
                <div className="flex-1">
                  <div className="h-2.5 w-28 rounded-full mb-1.5" style={{ background: 'var(--bg-muted)' }} />
                  <div className="h-2 w-16 rounded-full" style={{ background: 'var(--bg-muted)', opacity: 0.6 }} />
                </div>
                <div className="h-5 w-12 rounded-full" style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// İletişim / demo talebi — yeni kurum bilgilerini bırakır (/api/demo-request).
function DemoSection() {
  const [form, setForm] = useState({ name: '', org: '', phone: '', email: '', note: '', website: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  function set(k: string, v: string) { setForm(prev => ({ ...prev, [k]: v })); setError(''); }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (form.name.trim().length < 2) { setError('Lütfen adınızı girin.'); return; }
    if (form.org.trim().length < 2) { setError('Lütfen kurum adını girin.'); return; }
    if (form.phone.trim().length < 5) { setError('Lütfen geçerli bir telefon girin.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/demo-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(data.error || 'Bir hata oluştu. Tekrar deneyin.'); setLoading(false); return; }
      setDone(true);
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.');
      setLoading(false);
    }
  }

  return (
    <section id="iletisim" className="max-w-6xl mx-auto px-5 py-20 md:py-24">
      <div className="card-elevated relative overflow-hidden grid md:grid-cols-2 gap-8 p-8 md:p-12">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--brand,#6366f1) 12%, transparent), transparent 55%)' }} />
        {/* Sol: davet metni */}
        <div className="relative">
          <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.6rem,4vw,2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
            Kurumunuz okulin'i denesin
          </h2>
          <p className="mt-4 text-base" style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            Bilgilerinizi bırakın, kurumunuza özel bir demo için sizinle iletişime geçelim.
            Kurulumda ve mevcut listelerinizi aktarmada size yardımcı oluruz.
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {['Taahhüt yok, ücretsiz demo', 'Kurumunuza özel logo ve renk', 'Kurulumda birebir destek'].map(t => (
              <li key={t} className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <CheckCircle2 size={16} style={{ color: '#6366f1' }} /> {t}
              </li>
            ))}
          </ul>
        </div>

        {/* Sağ: form */}
        <div className="relative">
          {done ? (
            <div className="h-full flex flex-col items-center justify-center text-center py-8">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mb-4"
                style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 14%, transparent)', color: '#6366f1' }}>
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Talebiniz alındı</h3>
              <p className="mt-2 text-sm max-w-xs" style={{ color: 'var(--text-secondary)' }}>
                En kısa sürede sizinle iletişime geçeceğiz. İlginiz için teşekkürler.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-3">
              {/* honeypot — botlar doldurur, insan görmez */}
              <input
                type="text" tabIndex={-1} autoComplete="off"
                value={form.website} onChange={e => set('website', e.target.value)}
                style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
                aria-hidden="true"
              />
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-caption block mb-1">Ad Soyad *</label>
                  <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="Adınız" />
                </div>
                <div>
                  <label className="text-caption block mb-1">Kurum Adı *</label>
                  <input className="input" value={form.org} onChange={e => set('org', e.target.value)} placeholder="Dershane / kurs adı" />
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-caption block mb-1">Telefon *</label>
                  <input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="05xx xxx xx xx" inputMode="tel" />
                </div>
                <div>
                  <label className="text-caption block mb-1">E-posta</label>
                  <input className="input" value={form.email} onChange={e => set('email', e.target.value)} placeholder="opsiyonel" inputMode="email" />
                </div>
              </div>
              <div>
                <label className="text-caption block mb-1">Mesaj</label>
                <textarea className="input resize-none" rows={3} value={form.note} onChange={e => set('note', e.target.value)} placeholder="Kurumunuz hakkında kısa bilgi (opsiyonel)" />
              </div>
              {error && <p className="input-hint input-hint--error">{error}</p>}
              <button className="btn-primary w-full !py-3 flex items-center justify-center gap-2" disabled={loading}>
                {loading ? 'Gönderiliyor…' : <>Demo talep et <Send size={16} /></>}
              </button>
              <p className="text-caption text-center">Bilgileriniz yalnızca sizinle iletişim için kullanılır.</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

// Kurum kodu modalı — kod → /api/gate → subdomain'e yönlendir.
function CodeModal({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const clean = normalizeCode(code);
    if (clean.length < 4) { setError('Lütfen geçerli bir kurum kodu girin.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: clean }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; host?: string };
      if (!res.ok || !data.host) {
        setError(data.error || 'Kurum bulunamadı.');
        setLoading(false);
        return;
      }
      // Kurumun giriş ekranına yönlendir (kendi logosu/rengiyle açılır)
      window.location.href = `https://${data.host}`;
    } catch {
      setError('Bağlantı hatası. Tekrar deneyin.');
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="card-elevated w-full max-w-sm p-7 relative" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} aria-label="Kapat" className="absolute top-4 right-4 btn-ghost !p-1.5">
          <X size={16} />
        </button>
        <div className="flex flex-col items-center text-center mb-6">
          <Logo size="md" wordmark={false} className="mb-3" />
          <h2 className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>Kurum koduyla giriş</h2>
          <p className="text-caption mt-1">Kurumunuzun size verdiği kodu girin.</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <input
            ref={inputRef}
            className={`input text-center tracking-[0.3em] text-lg ${error ? 'input-error' : ''}`}
            style={{ fontWeight: 700 }}
            value={formatCode(code)}
            onChange={e => { setCode(normalizeCode(e.target.value)); setError(''); }}
            placeholder="XXX-XXX"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={7}
          />
          {error && <p className="input-hint input-hint--error text-center">{error}</p>}
          <button className="btn-primary w-full !py-3 flex items-center justify-center gap-2" disabled={loading}>
            {loading ? 'Kontrol ediliyor…' : <>Devam et <ArrowRight size={16} /></>}
          </button>
        </form>
        <p className="text-caption text-center mt-4">
          Kodunuz yok mu? Kurum yöneticinizle iletişime geçin.
        </p>
      </div>
    </div>
  );
}
