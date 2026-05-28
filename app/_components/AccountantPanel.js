import React from 'react';
import { Wallet } from 'lucide-react';
import FinancePanel from './finance/FinancePanel';

export default function AccountantPanel({ session, showToast }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#0891b2,#0284c7)' }}>
          <Wallet size={20} color="white" />
        </div>
        <div>
          <h2 className="text-xl font-800 text-gray-900" style={{ fontWeight: 800 }}>Muhasebe Paneli</h2>
          <p className="text-sm text-gray-500">Öğrenci ödemeleri ve finansal takip</p>
        </div>
      </div>
      <FinancePanel session={session} showToast={showToast} />
    </div>
  );
}
