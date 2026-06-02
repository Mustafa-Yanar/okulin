'use client';
import React from 'react';
import FinancePanel from './finance/FinancePanel';
import ExpensePanel from './finance/ExpensePanel';

// externalTab: Sidebar'dan gelen aktif sekme ('finance' | 'expenses' | 'accountants' | ...)
export default function AccountantPanel({ session, showToast, externalTab }) {
  const tab = externalTab || 'finance';

  return (
    <div>
      {tab === 'finance' && <FinancePanel session={session} showToast={showToast} />}
      {tab === 'expenses' && <ExpensePanel session={session} showToast={showToast} />}
    </div>
  );
}
