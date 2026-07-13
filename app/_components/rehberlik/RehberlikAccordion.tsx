'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown, ClipboardList, ListChecks, BarChart3, Target } from 'lucide-react';
import KonuTakibi from './KonuTakibi';
import DenemeAnaliz from './DenemeAnaliz';
import HedefKarti from './HedefKarti';

interface RehberlikAccordionProps {
  solvedContent: ReactNode;
  subjects: string[];
  editable?: boolean;
  studentId?: string;
}

// Rehberlik sekmesinin 3 akordiyon kartı.
// - solvedContent: 1. kart içeriği (çözülen sorular) — panele göre dışarıdan verilir
// - subjects: konu takibi dersleri (guidanceSubjectsFor sonucu, branşa göre süzülmüş gelir)
// - editable: konu slider'ları düzenlenebilir mi
// - studentId: müdür/öğretmen başka öğrenci için; öğrenci kendi için boş
export default function RehberlikAccordion({ solvedContent, subjects, editable, studentId }: RehberlikAccordionProps) {
  const [open, setOpen] = useState<string | null>(null); // hepsi kapalı başlar

  const cards = [
    {
      key: 'hedef',
      label: 'Haftalık Hedef',
      icon: Target,
      body: <HedefKarti studentId={studentId} editable={editable} />,
    },
    { key: 'solved', label: 'Haftalık Çözülen Sorular', icon: ClipboardList, body: solvedContent },
    {
      key: 'topics',
      label: 'Konu Takibi',
      icon: ListChecks,
      body: <KonuTakibi subjects={subjects} editable={editable} studentId={studentId} />,
    },
    {
      key: 'deneme',
      label: 'Deneme Analizi',
      icon: BarChart3,
      body: <DenemeAnaliz studentId={studentId} />,
    },
  ];

  return (
    <div className="space-y-3">
      {cards.map(({ key, label, icon: Icon, body }) => {
        const isOpen = open === key;
        return (
          <div key={key} className="card overflow-hidden">
            <button
              onClick={() => setOpen(isOpen ? null : key)}
              className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Icon size={18} className="text-brand" />
                <span className="font-700 text-gray-800" style={{ fontWeight: 700 }}>
                  {label}
                </span>
              </span>
              <ChevronDown
                size={18}
                className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {isOpen && <div className="px-4 pb-4 pt-1">{body}</div>}
          </div>
        );
      })}
    </div>
  );
}
