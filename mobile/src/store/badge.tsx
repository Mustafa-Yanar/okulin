import React, { createContext, useContext, useMemo, useState } from 'react';

// Okunmamış bildirim sayacı — tab rozeti + ekranlar arası paylaşım.
// Kaynak gerçek sunucu (unreadCount her today/inbox yanıtında gelir); bu context
// yalnız son bilinen değeri taşır.
interface BadgeValue {
  unread: number;
  setUnread(n: number): void;
}

const BadgeContext = createContext<BadgeValue | null>(null);

export function UnreadBadgeProvider({ children }: { children: React.ReactNode }) {
  const [unread, setUnread] = useState(0);
  const value = useMemo(() => ({ unread, setUnread }), [unread]);
  return <BadgeContext.Provider value={value}>{children}</BadgeContext.Provider>;
}

export function useUnreadBadge(): BadgeValue {
  const ctx = useContext(BadgeContext);
  if (!ctx) throw new Error('useUnreadBadge, UnreadBadgeProvider içinde kullanılmalı');
  return ctx;
}
