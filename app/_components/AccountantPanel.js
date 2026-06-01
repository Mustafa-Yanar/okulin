'use client';
import React, { useState } from 'react';
import { Wallet } from 'lucide-react';
import FinancePanel from './finance/FinancePanel';
import ExpensePanel from './finance/ExpensePanel';

export default function AccountantPanel({ session, showToast }) {
  const [tab, setTab] = useState('finance');
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0891b2,#0284c7)' }}>
          <Wallet size={20} color="white" />
        </div>
        <div>
          <h2 className="text-xl font-800 text-gray-900" style={{ fontWeight: 800 }}>Muhasebe Paneli</h2>
          <p className="text-sm text-gray-500">Öğrenci ödemeleri, giderler ve finansal takip</p>
        </div>
      </div>

      <div className="flex gap-1 mb-6 p-1 bg-gray-100 rounded-xl w-fit">
        {[['finance', '📊 Öğrenci Ödemeleri'], ['expenses', '💸 Giderler']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-600 transition-all ${tab === k ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
            style={{ fontWeight: 600 }}>{l}</button>
        ))}
      </div>

      {tab === 'finance' && <FinancePanel session={session} showToast={showToast} />}
      {tab === 'expenses' && <ExpensePanel session={session} showToast={showToast} />}
    </div>
  );
}
