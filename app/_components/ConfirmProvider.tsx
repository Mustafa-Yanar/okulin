'use client';

// Stilli onay diyaloğu — native confirm() yerine. Tema-uyumlu, erişilebilir.
// Kullanım:  const confirm = useConfirm();
//            if (!await confirm('Silinsin mi?')) return;
//            if (!await confirm({ title, message, confirmLabel, danger:false })) return;
// ⚠️ DAİMA `await` ile çağır — unutulursa Promise truthy döner ve onay atlanır.

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

// Çağıran tarafın verebileceği seçenekler (hepsi opsiyonel)
export interface ConfirmOptions {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

// State'te tutulan, varsayılanları doldurulmuş hali
interface ResolvedConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
}

export type ConfirmFn = (arg?: string | ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm bir ConfirmProvider içinde kullanılmalı');
  return ctx;
}

interface ConfirmProviderProps {
  children: React.ReactNode;
}

export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [opts, setOpts] = useState<ResolvedConfirmOptions | null>(null);
  const resolverRef = useRef<((result: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((arg) => {
    const o: ConfirmOptions = typeof arg === 'string' ? { message: arg } : (arg || {});
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setOpts({
        title: o.title || 'Emin misiniz?',
        message: o.message || '',
        confirmLabel: o.confirmLabel || 'Sil',
        cancelLabel: o.cancelLabel || 'Vazgeç',
        danger: o.danger !== false, // varsayılan: tehlikeli (silme)
      });
    });
  }, []);

  const settle = useCallback((result: boolean) => {
    setOpts(null);
    const r = resolverRef.current;
    resolverRef.current = null;
    if (r) r(result);
  }, []);

  // ESC = vazgeç (yalnız diyalog açıkken)
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') settle(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [opts, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={() => settle(false)}>
          <div role="alertdialog" aria-modal="true"
            className="card-elevated w-full max-w-sm animate-modal-in outline-none"
            onClick={(e) => e.stopPropagation()}>
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: opts.danger ? 'var(--color-danger-bg)' : 'color-mix(in srgb, var(--brand,#6366f1) 12%, transparent)' }}>
                  <AlertTriangle size={20} style={{ color: opts.danger ? 'var(--color-danger)' : 'var(--brand,#6366f1)' }} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-subheading">{opts.title}</h3>
                  {opts.message && (
                    <p className="text-body-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{opts.message}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-5">
                <button className="btn-ghost" onClick={() => settle(false)}>{opts.cancelLabel}</button>
                <button className={opts.danger ? 'btn-danger' : 'btn-primary'}
                  onClick={() => settle(true)} autoFocus>{opts.confirmLabel}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
