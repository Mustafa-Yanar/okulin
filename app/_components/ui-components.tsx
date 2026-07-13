import React from 'react';
import { BookOpen } from 'lucide-react';
import { brandGradient } from '@/lib/branding';
import type { Branding } from '@/lib/branding';

// AppContent showToast'ın ürettiği şekil: { msg, type } — types.ts'te yok, yerel tanım.
interface ToastData {
  msg: React.ReactNode;
  type: string;
}

interface ToastProps {
  toast: ToastData | null | undefined;
}

export function Toast({ toast }: ToastProps) {
  if (!toast) return null;
  // Record<string, string>: bilinmeyen type değeri || ile toast-success'e düşer (mevcut davranış).
  const cls: Record<string, string> = { success: 'toast-success', error: 'toast-error', info: 'toast-info' };
  // Ekran okuyucu bildirimi: hata acil (assertive/alert), başarı-bilgi kibar (polite/status).
  const isError = toast.type === 'error';
  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`fixed bottom-6 left-1/2 z-50 animate-fade-up -translate-x-1/2 toast-base ${cls[toast.type] || 'toast-success'}`}>
      {toast.msg}
    </div>
  );
}

interface LabelProps {
  children: React.ReactNode;
  htmlFor?: string;
}

export function Label({ children, htmlFor }: LabelProps) {
  return <label htmlFor={htmlFor} className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>{children}</label>;
}

interface FormFieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
}

export function FormField({ label, children }: FormFieldProps) {
  const id = React.useId();
  let associatedId: string | undefined;
  // isValidElement<{ id?: string }>: yalnız tip argümanı — props.id okuma/klonlama davranışı aynı.
  const content = React.Children.map(children, child => {
    if (!associatedId && React.isValidElement<{ id?: string }>(child) && !child.props.id) {
      associatedId = id;
      return React.cloneElement(child, { id });
    }
    return child;
  });
  return <div className="mb-4"><Label htmlFor={associatedId}>{label}</Label>{content}</div>;
}

interface BrandHeaderProps {
  branding?: Branding | null;
  subtitle?: React.ReactNode;
}

export function BrandHeader({ branding, subtitle }: BrandHeaderProps) {
  return (
    <div className="text-center mb-8">
      {branding?.logoUrl ? (
        <img src={branding.logoUrl} alt={branding.name}
          className="h-14 w-auto object-contain mx-auto mb-5"
          onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      ) : (
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-5"
          style={{ background: brandGradient(branding?.themeColor), boxShadow: '0 8px 24px rgba(99,102,241,0.3)' }}>
          <BookOpen size={26} color="white" />
        </div>
      )}
      <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)' }}>
        {branding?.shortName || 'okulin'}
      </h1>
      <p className="text-caption mt-1.5">{subtitle}</p>
    </div>
  );
}
