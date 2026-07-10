'use client';

// ─── Skeleton blokları ────────────────────────────────────────────────────────

interface SkeletonLineProps {
  width?: string;
  height?: string;
}

export function SkeletonLine({ width = 'w-full', height = 'h-4' }: SkeletonLineProps) {
  return <div className={`skeleton ${width} ${height}`} />;
}

export function SkeletonCard() {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="skeleton w-10 h-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <SkeletonLine width="w-2/3" height="h-4" />
          <SkeletonLine width="w-1/3" height="h-3" />
        </div>
      </div>
    </div>
  );
}

interface SkeletonListProps {
  count?: number;
}

export function SkeletonList({ count = 4 }: SkeletonListProps) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  cols?: number;
}

export function SkeletonTable({ rows = 5, cols = 4 }: SkeletonTableProps) {
  return (
    <div className="card overflow-hidden">
      <div className="p-4 space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-3">
            {Array.from({ length: cols }).map((_, j) => (
              <SkeletonLine key={j} width="flex-1" height="h-4" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Genel loading göstergesi ────────────────────────────────────────────────

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
}

export function LoadingSpinner({ size = 20, className = '' }: LoadingSpinnerProps) {
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24" fill="none"
      className={`animate-spin ${className}`}
      style={{ color: 'var(--brand, #6366f1)' }}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.2" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

interface LoadingBoxProps {
  height?: string;
  label?: string;
}

// İçeriği ortalayan loading kutusu — tam sayfa veya panel içi
export default function LoadingBox({ height = 'h-48', label = 'Yükleniyor…' }: LoadingBoxProps) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 ${height}`} aria-label={label}>
      <LoadingSpinner size={24} />
      <span className="text-caption">{label}</span>
    </div>
  );
}
