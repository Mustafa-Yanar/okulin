import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { isAllowedHost } from '../config';
import { secureStorage } from './storage';
import { createTokenStore } from '../api/tokens';
import { ApiError, createApiClient, type ApiClient } from '../api/client';
import type { LoginRequest, MeResponse, MobileSessionInfo } from '../api/types';

// Oturum durumu — TEK aktif hesap (spec §16). Oturum snapshot'ı cihazda SAKLANMAZ:
// boot'ta /me çekilir (SecureStore ~2KB değer sınırı + taze payload — plan ADR'si).
// /me ağ hatasında 3 kısa deneme, sonra login ekranı (token'lar KORUNUR).

export interface OrgInfo {
  orgSlug: string;
  canonicalHost: string;
  name: string;
  shortName: string;
  logoUrl: string;
  themeColor: string;
}

export type SessionStatus = 'loading' | 'needs-org' | 'needs-login' | 'ready';

interface SessionContextValue {
  status: SessionStatus;
  org: OrgInfo | null;
  session: MobileSessionInfo | null;
  api: ApiClient | null;
  installationId: string | null;
  appVersion: string;
  saveOrg(o: OrgInfo): Promise<void>;
  leaveOrg(): Promise<void>;
  login(body: Pick<LoginRequest, 'username' | 'password' | 'role'>): Promise<void>;
  // localOnly: sunucu oturumu zaten kapatıldıysa (tüm cihazlardan çıkış) yalnız
  // yerel temizlik — ölü oturumla logout/unregister 401 gürültüsü üretmesin
  // (İnceleme Gemini 2.5).
  logout(localOnly?: boolean): Promise<void>;
  retryBoot(): void; // Gate "Yeniden dene" — /me açılış denemesini tekrarlar (offline kurtarma)
  rotateInstallationId(): Promise<string>; // push register 409'unda yeni kimlik (Codex #3)
  // Mobil şifre değişimi sonrası: yeni token çifti + güncel session (mustChangePassword:false).
  applyPasswordChanged(pair: { accessToken: string; refreshToken: string }, session: MobileSessionInfo): Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const ORG_KEY = 'okulin.org';
const INSTALLATION_KEY = 'okulin.installationId';

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [org, setOrg] = useState<OrgInfo | null>(null);
  const [session, setSession] = useState<MobileSessionInfo | null>(null);
  const [installationId, setInstallationId] = useState<string | null>(null);
  const [bootTick, setBootTick] = useState(0); // retryBoot sayacı (offline kurtarma)
  const appVersion = Constants.expoConfig?.version ?? '0.0.0';
  const tokens = useMemo(() => createTokenStore(secureStorage), []);

  const api = useMemo(() => {
    if (!org) return null;
    return createApiClient({
      baseUrl: `https://${org.canonicalHost}`,
      tokens,
      appVersion,
      onSessionExpired: () => {
        setSession(null);
        setStatus('needs-login');
      },
    });
  }, [org, tokens, appVersion]);

  // Açılış: installationId (yoksa üret, spec §6/4) + kayıtlı kurum.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let inst = await secureStorage.get(INSTALLATION_KEY);
      if (!inst) {
        inst = Crypto.randomUUID();
        await secureStorage.set(INSTALLATION_KEY, inst);
      }
      if (cancelled) return;
      setInstallationId(inst);
      const rawOrg = await secureStorage.get(ORG_KEY);
      if (cancelled) return;
      if (!rawOrg) {
        setStatus('needs-org');
        return;
      }
      // Bozuk/allowlist-dışı kayıt → güvenli düşüş: kurum seçimine dön
      // (İnceleme Codex #11 — doğrulamasız JSON.parse + host'a körü körüne bağlanma).
      try {
        const parsedOrg = JSON.parse(rawOrg) as OrgInfo;
        if (!parsedOrg?.canonicalHost || !isAllowedHost(parsedOrg.canonicalHost)) throw new Error('geçersiz kurum kaydı');
        setOrg(parsedOrg);
      } catch {
        await secureStorage.del(ORG_KEY);
        if (!cancelled) setStatus('needs-org');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Kurum yüklendi → refresh token varsa /me ile oturumu doğrula.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    (async () => {
      const refresh = await tokens.getRefresh();
      if (!refresh) {
        if (!cancelled) setStatus('needs-login');
        return;
      }
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const me = await api.get<MeResponse>('/api/mobile/v1/me');
          if (!cancelled) {
            setSession(me.session);
            setStatus('ready');
          }
          return;
        } catch (e) {
          if (cancelled) return;
          if (e instanceof ApiError && e.status === 401) return; // onSessionExpired zaten çekti
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1000)); // ağ — kısa dene
        }
      }
      // Ağ 3 denemede gelmedi: login ekranına düş (token'lar DURUR). Gate zaten
      // offline ekranını gösterir; "Yeniden dene" retryBoot() ile bu effect'i
      // tekrarlar — ağ gelince token'lı kullanıcı şifre yazmadan 'ready' olur.
      if (!cancelled) setStatus('needs-login');
    })();
    return () => {
      cancelled = true;
    };
  }, [api, tokens, bootTick]);

  const retryBoot = useCallback(() => setBootTick((t) => t + 1), []);

  // Push register 409'unda (installationId başka hesaba bağlı — Codex #3) yeni
  // kurulum kimliği üret; push.ts tek-retry ile kullanır.
  const rotateInstallationId = useCallback(async () => {
    const fresh = Crypto.randomUUID();
    await secureStorage.set(INSTALLATION_KEY, fresh);
    setInstallationId(fresh);
    return fresh;
  }, []);

  const saveOrg = useCallback(async (o: OrgInfo) => {
    await secureStorage.set(ORG_KEY, JSON.stringify(o));
    setOrg(o);
    setStatus('needs-login');
  }, []);

  const logout = useCallback(async (localOnly = false) => {
    if (api && !localOnly) {
      // Push bağını kopar (spec §8) — kayıt hiç yapılmadıysa sunucuda no-op.
      if (installationId) {
        await api.del('/api/mobile/v1/push/register', { installationId }).catch(() => {});
      }
      await api.logout();
    } else {
      await tokens.clear(); // localOnly / api yok: yalnız yerel temizlik
    }
    setSession(null);
    setStatus('needs-login');
  }, [api, installationId, tokens]);

  // Kurum değişimi (spec §6/7): oturum + push bağı + kayıtlı kurum temizlenir.
  const leaveOrg = useCallback(async () => {
    await logout();
    await secureStorage.del(ORG_KEY);
    setOrg(null);
    setStatus('needs-org');
  }, [logout]);

  const login = useCallback(
    async (body: Pick<LoginRequest, 'username' | 'password' | 'role'>) => {
      if (!api) throw new ApiError(0, 'Önce kurum seçilmeli.');
      const r = await api.login({
        ...body,
        installationId: installationId ?? undefined,
        deviceName: Device.modelName ?? undefined,
        platform: 'android',
      });
      setSession(r.session);
      setStatus('ready');
    },
    [api, installationId],
  );

  const applyPasswordChanged = useCallback(
    async (pair: { accessToken: string; refreshToken: string }, newSession: MobileSessionInfo) => {
      // Epoch'u artır (İnceleme Codex #2 / Gemini #1 — Critical): şifre değişimi sırasında
      // UÇUŞTA olan bir doRefresh yanıtı taze token'ları EZMESİN ve 401'ini logout'a
      // çevirMESİN. clear() epoch++ → eski epoch'lu setPair reddedilir (false), eski
      // epoch'lu doRefresh outcome 'stale' olur (onSessionExpired tetiklenmez).
      await tokens.clear();
      await tokens.setPair(pair);
      setSession(newSession);
    },
    [tokens],
  );

  // Context value memo'lu: her render'da yeni referans üretip TÜM tüketici
  // ekranları gereksiz re-render etmesin (İnceleme: Gemini 3.1).
  const value = useMemo<SessionContextValue>(
    () => ({ status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout, retryBoot, rotateInstallationId, applyPasswordChanged }),
    [status, org, session, api, installationId, appVersion, saveOrg, leaveOrg, login, logout, retryBoot, rotateInstallationId, applyPasswordChanged],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession, SessionProvider içinde kullanılmalı');
  return ctx;
}
