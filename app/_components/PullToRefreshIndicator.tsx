'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  // usePullToRefresh hook'undaki değerler: idle | pulling | ready | refreshing | popping.
  // Hook henüz JS/paralel çeviride olduğundan geniş `string` tipi kullanıldı (literal karşılaştırmalar tip-güvenli).
  refreshState: string;
}

export default function PullToRefreshIndicator({ pullDistance, refreshState }: PullToRefreshIndicatorProps) {
  if (pullDistance <= 0) return null;

  return (
    <div
      className="absolute left-0 right-0 z-30 flex justify-center pointer-events-none transition duration-100"
      style={{
        top: '12px',
        height: `${pullDistance}px`,
        opacity: Math.min(pullDistance / 50, 1),
      }}
    >
      <div className="relative flex items-center justify-center w-full h-full">
        {refreshState === 'popping' ? (
          <div className="relative flex items-center justify-center w-8 h-8">
            <span className="absolute w-8 h-8 rounded-full border-2 border-[color:var(--brand)] animate-bubble-pop opacity-0" />
            <span className="absolute w-8 h-8 rounded-full border-2 border-purple-400 animate-bubble-pop-delayed opacity-0" />
            <div className="absolute w-2 h-2 rounded-full bg-yellow-400 animate-pop-dot-1" />
            <div className="absolute w-2 h-2 rounded-full bg-green-400 animate-pop-dot-2" />
            <div className="absolute w-2 h-2 rounded-full bg-blue-400 animate-pop-dot-3" />
            <div className="absolute w-2 h-2 rounded-full bg-pink-400 animate-pop-dot-4" />
          </div>
        ) : (
          <div
            className="rounded-full flex items-center justify-center"
            style={{
              width: '38px',
              height: '38px',
              background: 'var(--bg-surface)',
              backdropFilter: 'blur(12px)',
              border: `1.5px solid ${refreshState === 'ready' ? 'rgba(99,102,241,0.85)' : 'var(--border-subtle)'}`,
              transform: `scale(${Math.min(pullDistance / 60, 1.1)}) rotate(${pullDistance * 4.5}deg)`,
              boxShadow: refreshState === 'ready' ? '0 0 15px rgba(99,102,241,0.35)' : '0 2px 8px rgba(0,0,0,0.1)',
              transition: 'border-color 0.15s, box-shadow 0.15s',
            }}
          >
            {refreshState === 'refreshing' ? (
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--brand,#6366f1)' }} />
            ) : (
              <span
                className="rounded-full"
                style={{
                  width: '12px',
                  height: '12px',
                  background: refreshState === 'ready'
                    ? 'linear-gradient(135deg, var(--brand,#6366f1), color-mix(in srgb, var(--brand,#6366f1) 70%, #a855f7))'
                    : 'var(--bg-muted)',
                  boxShadow: refreshState === 'ready' ? '0 0 10px rgba(99,102,241,0.6)' : 'none',
                  transform: refreshState === 'ready' ? 'scale(1.1)' : 'scale(0.9)',
                  transition: 'all 0.2s',
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
