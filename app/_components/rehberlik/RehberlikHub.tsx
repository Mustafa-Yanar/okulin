'use client';

// "Rehberlik" hub'ı — yoklama, ödev, davranış ve (müdürde) denemeler tek sekme altında
// pill-tabs ile toplanır. Sidebar şişmesin diye 4 ayrı sekme yerine 1 sekme + alt sekme.
// İçerik aynen mevcut bileşenlerden gelir; bu dosya yalnız yerleşim/yönlendirme yapar.

import React, { useState } from 'react';
import { ClipboardList, NotebookPen, Award, BarChart2, FileText, ScanLine } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { DirectorAttendanceView } from '../director/Attendance';
import { OdevManager } from '../odev/Odev';
import { DavranisManager } from '../davranis/Davranis';
import OptikFormTab from '../director/OptikFormTab';
import DirectorDenemeYonetimi from './DirectorDenemeYonetimi';
import { useUrlParam } from '../useUrlParam';
import type { Session } from '@/lib/auth';
import type { ShowToast } from '../types';

interface RehberlikHubProps {
  session: Session;
  showToast: ShowToast; // DirectorDenemeYonetimi zorunlu ister; panel her zaman geçer
}

export default function RehberlikHub({ session, showToast }: RehberlikHubProps) {
  const [rtab, setRtab] = useUrlParam('rtab');
  const [denemeTab, setDenemeTab] = useState('sinavlar');

  // Denemeler rehbere de açık: tüm /api/deneme + /api/optik uçları zaten
  // ['director','counselor']'a izinli (rehber = müdür eksi muhasebe; deneme analizi
  // çekirdek rehberlik işidir). Eskiden yalnız müdürde gösteriliyordu — UI eksikti.
  const subtabs: [string, string, LucideIcon][] = [
    ['yoklama', 'Yoklama', ClipboardList],
    ['odev', 'Ödevler', NotebookPen],
    ['davranis', 'Davranış', Award],
    ['denemeler', 'Denemeler', BarChart2],
  ];
  const active = subtabs.some(([k]) => k === rtab) ? rtab : 'yoklama';

  return (
    <div>
      <div className="pill-tabs mb-4">
        {subtabs.map(([key, label, Icon]) => (
          <button key={key} onClick={() => setRtab(key)}
            className={`pill-tab press-effect${active === key ? ' is-active' : ''}`}>
            <Icon size={13} /> <span>{label}</span>
          </button>
        ))}
      </div>

      {active === 'yoklama' && <DirectorAttendanceView showToast={showToast} />}
      {active === 'odev' && <OdevManager showToast={showToast} userRole={session.role} userId={session.id} />}
      {active === 'davranis' && <DavranisManager showToast={showToast} userRole={session.role} userId={session.id} />}

      {active === 'denemeler' && (
        <div>
          <div className="pill-tabs mb-4">
            {([['sinavlar', 'Sınavlar', FileText], ['optik', 'Optik Form', ScanLine]] as [string, string, LucideIcon][]).map(([k, l, Icon]) => (
              <button key={k} onClick={() => setDenemeTab(k)}
                className={`pill-tab press-effect${denemeTab === k ? ' is-active' : ''}`}>
                <Icon size={13} /> <span>{l}</span>
              </button>
            ))}
          </div>
          {denemeTab === 'optik'
            ? <OptikFormTab showToast={showToast} />
            : <DirectorDenemeYonetimi showToast={showToast} />}
        </div>
      )}
    </div>
  );
}
