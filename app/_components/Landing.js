'use client';

// okulin apex (okulin.com) tanıtım sayfası. Kurum-bağımsız.
// "Giriş Yap" → kurum kodu modalı → /api/gate → kurumun subdomain'ine yönlendirir.
// Modern/sade SaaS dili; uygulamanın mevcut tasarım token'larıyla (card, pill,
// --brand, brand-tonlu ikon daireleri) uyumlu.

import { useState, useEffect, useRef } from 'react';
import {
  CalendarClock, Users, Sparkles, ClipboardCheck, LineChart, UsersRound,
  Wallet, BookOpen, Megaphone, ArrowRight, X, LogIn, ShieldCheck, Zap, Heart,
} from 'lucide-react';
import Logo from './Logo';
import { formatCode, normalizeCode } from '@/lib/orgcode';

const FEATURES = [
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

const HIGHLIGHTS = [
  { icon: Zap, title: 'Dakikalar içinde hazır', desc: 'Kurulum yok; kurumunuzun kodu ile giriş yapın, kendi logonuzla başlayın.' },
  { icon: ShieldCheck, title: 'Güvenli ve izole', desc: 'Her kurumun verisi ayrı; rol bazlı yetkiler ve şifreli ödeme altyapısı.' },
  { icon: Heart, title: 'Öğretmen tarafından tasarlandı', desc: 'Sahadaki gerçek ihtiyaçlardan doğdu; gereksiz karmaşa yok.' },
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
            <a href="#neden" className="hover:text-[var(--text-primary)] transition-colors">Neden okulin</a>
          </nav>
          <button onClick={() => setModalOpen(true)} className="btn-primary !px-5 !py-2 flex items-center gap-2 text-sm">
            <LogIn size={15} /> Giriş Yap
          </button>
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
            <button onClick={() => setModalOpen(true)} className="btn-primary !px-6 !py-3 flex items-center gap-2 text-base">
              <LogIn size={18} /> Kurum koduyla giriş
            </button>
            <a href="#ozellikler" className="btn-ghost !px-6 !py-3 flex items-center gap-2 text-base">
              Özellikleri gör <ArrowRight size={16} />
            </a>
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

      {/* ── Neden okulin ──────────────────────────────────────────── */}
      <section id="neden" style={{ background: 'var(--bg-surface)', borderTop: '1px solid var(--border-subtle)', borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-5 py-16 md:py-20">
          <div className="grid md:grid-cols-3 gap-8">
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
        </div>
      </section>

      {/* ── CTA bandı ─────────────────────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-5 py-20 md:py-24">
        <div className="card-elevated text-center px-6 py-14 relative overflow-hidden">
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 0%, color-mix(in srgb, var(--brand,#6366f1) 14%, transparent), transparent 60%)' }} />
          <div className="relative">
            <h2 className="tracking-tight" style={{ fontSize: 'clamp(1.6rem,4vw,2.25rem)', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
              Kurumunuzun koduyla hemen başlayın
            </h2>
            <p className="mt-3 text-base max-w-lg mx-auto" style={{ color: 'var(--text-secondary)' }}>
              Kurum kodunuz yoksa yöneticinizden isteyin. Giriş yaptığınızda kurumunuzun kendi
              logosu ve rengiyle karşılaşacaksınız.
            </p>
            <button onClick={() => setModalOpen(true)} className="btn-primary !px-7 !py-3 mt-7 inline-flex items-center gap-2 text-base">
              <LogIn size={18} /> Giriş Yap
            </button>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer style={{ borderTop: '1px solid var(--border-subtle)' }}>
        <div className="max-w-6xl mx-auto px-5 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <Logo size="sm" />
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            © {new Date().getFullYear()} okulin · Eğitim kurumu yönetim platformu
          </p>
        </div>
      </footer>

      {modalOpen && <CodeModal onClose={() => setModalOpen(false)} />}
    </div>
  );
}

function FeatureCard({ icon: Icon, title, desc }) {
  return (
    <div className="card p-5 transition-all hover:-translate-y-0.5" style={{ transitionDuration: '160ms' }}>
      <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3"
        style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 10%, var(--bg-surface))', color: '#6366f1' }}>
        <Icon size={21} strokeWidth={2} />
      </div>
      <h3 className="text-base" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>{desc}</p>
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

// Kurum kodu modalı — kod → /api/gate → subdomain'e yönlendir.
function CodeModal({ onClose }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e) {
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
      const data = await res.json().catch(() => ({}));
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
