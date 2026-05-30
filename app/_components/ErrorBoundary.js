'use client';

import React from 'react';
import { reportError } from '@/lib/error-client';

// Pencere düzeyi hataları (yakalanmamış hata + reddedilen promise) /api/log'a raporlar.
// Görünmez yardımcı bileşen — bir kez listener kurar.
export function GlobalErrorListener() {
  React.useEffect(() => {
    const onError = (event) => {
      reportError({
        message: event?.message || 'Bilinmeyen hata',
        stack: event?.error?.stack,
        source: 'window',
      });
    };
    const onRejection = (event) => {
      const reason = event?.reason;
      reportError({
        message: (reason && (reason.message || String(reason))) || 'İşlenmeyen promise reddi',
        stack: reason?.stack,
        source: 'unhandledrejection',
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);
  return null;
}

// React render hatalarını yakalar; uygulamanın komple beyaz ekrana düşmesini önler.
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    reportError({
      message: error?.message || 'React render hatası',
      stack: error?.stack,
      source: 'react',
      componentStack: info?.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
          <div className="card-elevated max-w-md w-full p-8 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-red-50 flex items-center justify-center text-red-500 text-2xl">!</div>
            <h2 className="font-700 text-lg mb-2" style={{ fontWeight: 700 }}>Bir şeyler ters gitti</h2>
            <p className="text-sm text-gray-500 mb-6">
              Beklenmeyen bir hata oluştu. Sayfayı yenilemeyi deneyin. Sorun sürerse yöneticiye bildirin.
            </p>
            <button className="btn-primary w-full" onClick={() => window.location.reload()}>
              Sayfayı Yenile
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
