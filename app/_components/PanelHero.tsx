'use client';

import React from 'react';

// Kompakt karşılama başlığı — panel ana inişinde (öğretmen Program, öğrenci Müsait).
// Tarih eyebrow + gün-saatine göre selam + gradyan isim. Utilitarian app: küçük tutulur,
// yalnız ana sekmede gösterilir (her sekmede tekrar etmez).
export default function PanelHero({ name, subtitle }: { name?: string; subtitle?: React.ReactNode }) {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 6 ? 'İyi geceler' : h < 11 ? 'Günaydın' : h < 18 ? 'İyi çalışmalar' : 'İyi akşamlar';
  const first = (name || '').trim().split(/\s+/)[0] || name || '';
  const dateStr = now.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="reveal mb-4">
      <p className="text-[11px] font-bold uppercase" style={{ color: 'var(--brand,#6366f1)', letterSpacing: '0.1em' }}>{dateStr}</p>
      <h1 style={{ fontSize: 'clamp(20px,2.6vw,26px)', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.15, color: 'var(--text-primary)', margin: '2px 0 0' }}>
        {greet}, <span className="hero-grad">{first}</span>.
      </h1>
      {subtitle && <p className="text-body-sm mt-1">{subtitle}</p>}
    </div>
  );
}
