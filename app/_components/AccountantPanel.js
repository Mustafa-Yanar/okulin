'use client';
import React, { useState, useEffect } from 'react';
import FinancePanel from './finance/FinancePanel';
import ExpensePanel from './finance/ExpensePanel';
import { OnKayitManager } from './crm/OnKayit';
import AccountantStudents from './accountant/AccountantStudents';

// externalTab: Sidebar'dan gelen aktif sekme ('finance' | 'expenses' | 'onkayit' | 'ogrenciler').
// intakeAllowed: kurum config permissions.accountant.intake — kapalıysa kayıt sekmeleri
// finansa düşer (sidebar zaten gizler; URL'de kalmış ?sekme'ye karşı ikinci kat).
export default function AccountantPanel({ session, showToast, externalTab, onExternalTabChange, intakeAllowed = true }) {
  let tab = externalTab || 'finance';
  if (!intakeAllowed && (tab === 'onkayit' || tab === 'ogrenciler')) tab = 'finance';

  // Ön Kayıt → Öğrenciler köprüsü: "kayıt oldu" adayının bilgileriyle form önceden dolu açılır.
  const [studentPrefill, setStudentPrefill] = useState(null);
  // Kayıt → Ödemeler köprüsü: yeni öğrencinin adı finans aramasına taşınır (mount'ta okunur).
  const [financeFocus, setFinanceFocus] = useState('');
  useEffect(() => { if (tab !== 'finance' && financeFocus) setFinanceFocus(''); }, [tab, financeFocus]);

  const goFinance = (name) => { setFinanceFocus(name || ''); onExternalTabChange?.('finance'); };

  return (
    <div>
      {tab === 'finance' && <FinancePanel session={session} showToast={showToast} initialSearch={financeFocus} />}
      {tab === 'expenses' && <ExpensePanel session={session} showToast={showToast} />}
      {tab === 'onkayit' && intakeAllowed && (
        <OnKayitManager showToast={showToast}
          onCreateStudent={(lead) => {
            setStudentPrefill({ name: lead.studentName || '', parentName: lead.parentName || '', parentPhone: lead.phone || '' });
            onExternalTabChange?.('ogrenciler');
          }} />
      )}
      {tab === 'ogrenciler' && intakeAllowed && (
        <AccountantStudents showToast={showToast} prefill={studentPrefill}
          onPrefillConsumed={() => setStudentPrefill(null)} onGoFinance={goFinance} />
      )}
    </div>
  );
}
