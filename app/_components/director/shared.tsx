'use client';

// Müdür paneli paylaşılan primitifleri ve yardımcıları.
// DirectorPanel ve alt bileşenleri (forms, attendance, history, program, settings)
// bu tek kaynaktan import eder.

import React from 'react';
import { X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const GROUPS: Record<string, string> = { ortaokul: 'Ortaokul', lise: 'Lise', mezun: 'Mezun' };

interface SectionHeaderProps {
  title: React.ReactNode;
  count?: number | null;
  subtitle?: React.ReactNode;
  icon?: LucideIcon;
  children?: React.ReactNode;
}

// Tek tip bölüm/sekme başlığı — başlık (+ opsiyonel sayı), opsiyonel ikon + alt
// başlık, sağda opsiyonel aksiyonlar (children). Panel başlıkları bunu kullanır
// (eski ad-hoc flex+h3 blokları yerine; .section-header sınıfını kullanır).
export function SectionHeader({ title, count, subtitle, icon: Icon, children }: SectionHeaderProps) {
  return (
    <div className="section-header flex-wrap gap-3">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, var(--brand,#6366f1) 15%, transparent)' }}>
            <Icon size={20} style={{ color: 'var(--brand,#6366f1)' }} />
          </div>
        )}
        <div className="min-w-0">
          <h3 className="text-heading truncate">{title}{count != null ? ` (${count})` : ''}</h3>
          {subtitle && <p className="text-body-sm mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex gap-2 items-center shrink-0">{children}</div>}
    </div>
  );
}

// Ortak yardımcılar tek kaynaktan (../shared) re-export edilir — mevcut
// director alt-bileşen importları (./shared) değişmeden çalışmaya devam eder.
export { api, getAdjacentWeek, isSlotPast, WeekNav } from '../shared';

interface ModalProps {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  xwide?: boolean;
  lockClose?: boolean;
}

export function Modal({ title, onClose, children, wide, xwide, lockClose }: ModalProps) {
  const titleId = React.useId();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  // onClose/lockClose en güncel hâliyle okunsun ama effect her render tekrar kurulmasın.
  const onCloseRef = React.useRef(onClose); onCloseRef.current = onClose;
  const lockRef = React.useRef(lockClose); lockRef.current = lockClose;

  React.useEffect(() => {
    // activeElement Element döner; focus() varlığı runtime'da zaten kontrol ediliyor.
    const prevFocus = document.activeElement as HTMLElement | null;
    // İçeride zaten odaklı bir öğe yoksa (autoFocus input'unu çalma) modalı odakla.
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !lockRef.current) onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Kapanışta odağı tetikleyen öğeye geri ver — hâlâ DOM'daysa.
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
        prevFocus.focus();
      }
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`card-elevated w-full ${xwide ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'} animate-modal-in max-h-[90vh] overflow-y-auto outline-none`}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 id={titleId} className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} aria-label="Kapat" className="btn-icon"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

interface LabelProps {
  children: React.ReactNode;
  htmlFor?: string;
}

export function Label({ children, htmlFor }: LabelProps) {
  return <label htmlFor={htmlFor} className="text-label block mb-1.5">{children}</label>;
}

interface FormFieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
  error?: React.ReactNode;
  hint?: React.ReactNode;
}

// label'ı ilk form elemanı child'ına useId ile bağlar (ekran okuyucu + otomatik doldurma).
// Birden çok / element olmayan child varsa güvenle olduğu gibi bırakır.
// error: doluysa alan altında kırmızı mesaj + ilk input'a .input-error eklenir.
// hint: nötr yardımcı metin (error yokken gösterilir).
export function FormField({ label, children, error, hint }: FormFieldProps) {
  const id = React.useId();
  let associatedId: string | undefined;
  const content = React.Children.map(children, child => {
    // isValidElement daraltması props'u any yapar (React 18 tipi) — id/className erişimi güvenli.
    if (!associatedId && React.isValidElement(child) && !child.props.id) {
      associatedId = id;
      // İlk form elemanına id ver; error varsa hata stilini de ekle.
      const cls = error && typeof child.props.className === 'string' && child.props.className.includes('input')
        ? `${child.props.className} input-error`
        : child.props.className;
      return React.cloneElement(child, { id, className: cls, 'aria-invalid': error ? true : undefined });
    }
    return child;
  });
  return (
    <div className="mb-4">
      <Label htmlFor={associatedId}>{label}</Label>
      {content}
      {error ? <p className="input-hint input-hint--error">{error}</p>
        : hint ? <p className="input-hint">{hint}</p> : null}
    </div>
  );
}




export function guidanceSubjectsFor(cls: string | null | undefined): string[] {
  if (!cls) return [];
  if (cls.startsWith('7')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'Sosyal Bilgiler', 'İngilizce'];
  }
  if (cls.startsWith('8')) {
    return ['Türkçe', 'Matematik', 'Fen Bilgisi', 'İnkılap Tarihi', 'İngilizce'];
  }
  let isSayisal = false;
  let isEA = false;
  let grade = 0;
  if (cls.startsWith('m')) {
    const n = parseInt(cls.slice(1));
    isSayisal = n <= 5;
    isEA = n > 5;
    grade = 12;
  } else {
    grade = Math.floor(parseInt(cls) / 100);
    const sec = parseInt(cls.slice(1));
    if (grade === 3) { isSayisal = sec <= 3; isEA = sec > 3; }
    if (grade === 4) { isSayisal = sec <= 5; isEA = sec > 5; }
  }
  if (grade === 1 || grade === 2) {
    return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (grade === 3) {
    if (isSayisal) return ['Türkçe', 'Matematik', 'Fizik', 'Kimya', 'Biyoloji'];
    return ['Türkçe', 'Matematik', 'Tarih', 'Coğrafya', 'Felsefe'];
  }
  if (isSayisal) {
    return [
      'Türkçe',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik', 'AYT Fizik',
      'TYT Kimya', 'AYT Kimya',
      'TYT Biyoloji', 'AYT Biyoloji',
      'TYT Tarih', 'TYT Coğrafya', 'TYT Felsefe', 'Din Kültürü',
    ];
  }
  if (isEA) {
    return [
      'Türkçe', 'Edebiyat',
      'TYT Matematik', 'AYT Matematik', 'Geometri',
      'TYT Fizik', 'TYT Kimya', 'TYT Biyoloji',
      'TYT Tarih', 'AYT Tarih', 'TYT Coğrafya', 'AYT Coğrafya', 'TYT Felsefe', 'AYT Felsefe', 'Din Kültürü',
    ];
  }
  return [];
}
