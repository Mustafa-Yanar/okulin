'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

type RefreshState = 'idle' | 'pulling' | 'ready' | 'refreshing' | 'popping';
type GestureDirection = 'none' | 'down' | 'other';

export function usePullToRefresh(onRefresh: () => void | Promise<void>) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshState, setRefreshState] = useState<RefreshState>('idle'); // idle | pulling | ready | refreshing | popping

  const scrollContainerRef = useRef<HTMLElement | null>(null); // scrollTop okunan içerik alanı (<main>)
  const gestureTargetRef = useRef<HTMLElement | null>(null);   // touch dinleyicilerin bağlandığı kapsayıcı (header dahil)
  const stateRef = useRef<{ refreshState: RefreshState; pullDistance: number }>({ refreshState, pullDistance });
  useEffect(() => { stateRef.current = { refreshState, pullDistance }; }, [refreshState, pullDistance]);

  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const isPullStart = useRef(false);
  const gestureDirection = useRef<GestureDirection>('none');

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const container = scrollContainerRef.current;
    const isAtTop = container && container.scrollTop <= 2;
    const isIdle = stateRef.current.refreshState === 'idle';

    if (isAtTop && isIdle) {
      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
      isPullStart.current = true;
      gestureDirection.current = 'none';
    } else {
      isPullStart.current = false;
    }
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isPullStart.current) return;

    const currentY = e.touches[0].clientY;
    const currentX = e.touches[0].clientX;
    const diffY = currentY - touchStartY.current;
    const diffX = Math.abs(currentX - touchStartX.current);

    if (gestureDirection.current === 'none') {
      if (diffY > 6 && diffY > diffX) {
        gestureDirection.current = 'down';
      } else if (diffX > 6 || diffY < -6) {
        gestureDirection.current = 'other';
        isPullStart.current = false;
        return;
      }
    }

    if (gestureDirection.current === 'down') {
      const currentState = stateRef.current.refreshState;
      if (currentState === 'refreshing' || currentState === 'popping') return;

      if (e.cancelable) e.preventDefault();

      const dragDist = Math.min(diffY * 0.45, 110);
      setPullDistance(dragDist);
      setRefreshState(dragDist > 65 ? 'ready' : 'pulling');
    }
  }, []);

  const handleTouchEnd = useCallback(async () => {
    if (!isPullStart.current || gestureDirection.current !== 'down') {
      isPullStart.current = false;
      return;
    }
    isPullStart.current = false;

    const currentState = stateRef.current.refreshState;
    if (currentState === 'refreshing' || currentState === 'popping') return;

    const currentPull = stateRef.current.pullDistance;

    if (currentPull > 65) {
      setRefreshState('refreshing');
      setPullDistance(65);

      try {
        await onRefresh();
      } catch (err) {
        console.error('Pull to refresh error:', err);
      }

      setRefreshState('popping');
      setTimeout(() => {
        setPullDistance(0);
        setRefreshState('idle');
      }, 500);
    } else {
      setPullDistance(0);
      setRefreshState('idle');
    }
  }, [onRefresh]);

  // scrollTop'un okunacağı içerik alanını (<main>) işaretler — dinleyici bağlamaz.
  const setScrollContainerRef = useCallback((node: HTMLElement | null) => {
    scrollContainerRef.current = node;
  }, []);

  // Touch dinleyicilerini bağlanan kapsayıcıya kurar. Header'ı da kapsayan üst
  // kapsayıcıya verilirse, üst bardan çekince de uygulama animasyonu çalışır.
  const setGestureContainerRef = useCallback((node: HTMLElement | null) => {
    if (gestureTargetRef.current) {
      gestureTargetRef.current.removeEventListener('touchstart', handleTouchStart);
      gestureTargetRef.current.removeEventListener('touchmove', handleTouchMove);
      gestureTargetRef.current.removeEventListener('touchend', handleTouchEnd);
    }
    if (node) {
      node.addEventListener('touchstart', handleTouchStart, { passive: false });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    gestureTargetRef.current = node;
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { pullDistance, refreshState, setScrollContainerRef, setGestureContainerRef };
}
