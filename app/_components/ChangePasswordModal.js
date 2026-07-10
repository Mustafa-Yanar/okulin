'use client';

import React, { useState, useId, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { api } from './shared';

// Helper API Fetcher

function Modal({ title, onClose, children, wide, xwide }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  useEffect(() => {
    const prevFocus = document.activeElement;
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) prevFocus.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className={`card-elevated w-full ${xwide ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'} animate-modal-in max-h-[90vh] overflow-y-auto outline-none`}>
        <div className="flex items-center justify-between p-5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <h3 id={titleId} className="text-lg" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} aria-label="Kapat" className="p-2 rounded-lg transition-colors hover:bg-[var(--bg-muted)]" style={{ color: 'var(--text-secondary)' }}><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Label({ children, htmlFor }) {
  return <label htmlFor={htmlFor} className="text-label block mb-1.5">{children}</label>;
}

function FormField({ label, children }) {
  const id = React.useId();
  let associatedId;
  const content = React.Children.map(children, child => {
    if (!associatedId && React.isValidElement(child) && !child.props.id) {
      associatedId = id;
      return React.cloneElement(child, { id });
    }
    return child;
  });
  return <div className="mb-4"><Label htmlFor={associatedId}>{label}</Label>{content}</div>;
}

export default function ChangePasswordModal({ onClose, showToast }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    if (next !== next2) { showToast('Yeni şifreler eşleşmiyor', 'error'); return; }
    if (next.length < 4) { showToast('Şifre en az 4 karakter olmalı', 'error'); return; }
    setLoading(true);
    try {
      await api('/api/auth', { method: 'POST', body: JSON.stringify({ action: 'change_password', password: current, newPassword: next }) });
      showToast('Şifre başarıyla değiştirildi');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Şifremi Değiştir" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <FormField label="Mevcut Şifre">
          <input className="input" type="password" value={current} onChange={e => setCurrent(e.target.value)} required autoFocus />
        </FormField>
        <FormField label="Yeni Şifre">
          <input className="input" type="password" value={next} onChange={e => setNext(e.target.value)} required />
        </FormField>
        <FormField label="Yeni Şifre (Tekrar)">
          <input className="input" type="password" value={next2} onChange={e => setNext2(e.target.value)} required />
        </FormField>
        <div className="flex gap-3 pt-2">
          <button className="btn-primary flex-1" disabled={loading}>{loading ? 'Kaydediliyor...' : 'Değiştir'}</button>
          <button type="button" className="btn-ghost" onClick={onClose}>İptal</button>
        </div>
      </form>
    </Modal>
  );
}
