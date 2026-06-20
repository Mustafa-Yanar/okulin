'use client';

import React from 'react';
import { SlotTimesProvider } from './_components/SlotTimesContext';
import { ErrorBoundary, GlobalErrorListener } from './_components/ErrorBoundary';
import AppContent from './_components/AppContent';

// ─── APP ROOT ──────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <ErrorBoundary>
      <GlobalErrorListener />
      <SlotTimesProvider>
        <AppContent />
      </SlotTimesProvider>
    </ErrorBoundary>
  );
}
