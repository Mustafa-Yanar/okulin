'use client';

// okulin marka logosu — gradient yuvarlak kare içinde mezuniyet kepi + wordmark.
// Wordmark sayfa fontuyla render edilir (SVG'ye gömülmez → her yerde net).
// size: 'sm' | 'md' | 'lg'. wordmark=false → yalnız mark.

import { GraduationCap } from 'lucide-react';

type LogoSize = 'sm' | 'md' | 'lg';

interface LogoSizeSpec {
  box: number;
  icon: number;
  text: string;
  radius: number;
}

const SIZES: Record<LogoSize, LogoSizeSpec> = {
  sm: { box: 28, icon: 15, text: 'text-base', radius: 8 },
  md: { box: 36, icon: 19, text: 'text-xl', radius: 10 },
  lg: { box: 44, icon: 24, text: 'text-2xl', radius: 12 },
};

interface LogoProps {
  size?: LogoSize;
  wordmark?: boolean;
  className?: string;
}

export default function Logo({ size = 'md', wordmark = true, className = '' }: LogoProps) {
  const s = SIZES[size] || SIZES.md;
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <div
        className="flex items-center justify-center text-white shrink-0"
        style={{
          width: s.box,
          height: s.box,
          borderRadius: s.radius,
          background: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
          boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
        }}
      >
        <GraduationCap size={s.icon} strokeWidth={2.2} />
      </div>
      {wordmark && (
        <span
          className={`${s.text} tracking-tight`}
          style={{ fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}
        >
          okul<span style={{ color: '#6366f1' }}>in</span>
        </span>
      )}
    </div>
  );
}
