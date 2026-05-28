'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';

// Helper API Fetcher
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'İşlem başarısız');
  return data;
}

function Modal({ title, onClose, children, wide, xwide }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`card-elevated w-full ${xwide ? 'max-w-5xl' : wide ? 'max-w-3xl' : 'max-w-lg'} animate-slide-in max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-700 text-lg" style={{ fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 transition-colors"><X size={16} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Label({ children }) {
  return <label className="block text-xs font-600 text-gray-500 uppercase tracking-wide mb-1.5" style={{ fontWeight: 600 }}>{children}</label>;
}

function FormField({ label, children }) {
  return <div className="mb-4"><Label>{label}</Label>{children}</div>;
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
