'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

export function usePullToRefresh(onRefresh) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshState, setRefreshState] = useState('idle'); // idle | pulling | ready | refreshing | popping

  const scrollContainerRef = useRef(null);
  const stateRef = useRef({ refreshState, pullDistance });
  useEffect(() => { stateRef.current = { refreshState, pullDistance }; }, [refreshState, pullDistance]);

  const touchStartY = useRef(0);
  const touchStartX = useRef(0);
  const isPullStart = useRef(false);
  const gestureDirection = useRef('none');

  const handleTouchStart = useCallback((e) => {
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

  const handleTouchMove = useCallback((e) => {
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

  const setScrollContainerRef = useCallback((node) => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.removeEventListener('touchstart', handleTouchStart);
      scrollContainerRef.current.removeEventListener('touchmove', handleTouchMove);
      scrollContainerRef.current.removeEventListener('touchend', handleTouchEnd);
    }
    if (node) {
      node.addEventListener('touchstart', handleTouchStart, { passive: false });
      node.addEventListener('touchmove', handleTouchMove, { passive: false });
      node.addEventListener('touchend', handleTouchEnd, { passive: true });
    }
    scrollContainerRef.current = node;
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { pullDistance, refreshState, setScrollContainerRef };
}
