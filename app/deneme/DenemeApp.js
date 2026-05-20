'use client';

import { ArrowLeft, BarChart3 } from 'lucide-react';
import DirectorDeneme from './DirectorDeneme';
import StudentDeneme from './StudentDeneme';
import TeacherDeneme from './TeacherDeneme';

export default function DenemeApp({ session }) {
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,#6366f1,#4f46e5)' }}
            >
              <BarChart3 size={16} color="white" />
            </div>
            <span className="font-800 text-gray-900" style={{ fontWeight: 800 }}>
              Deneme Analizi
            </span>
          </div>
          <a
            href="/"
            className="btn-ghost !px-3 !py-2 flex items-center gap-1.5 text-gray-600"
          >
            <ArrowLeft size={14} />
            <span className="text-xs font-600" style={{ fontWeight: 600 }}>
              Etüt Takibe Dön
            </span>
          </a>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        {session.role === 'director' && <DirectorDeneme session={session} />}
        {session.role === 'teacher' && <TeacherDeneme session={session} />}
        {session.role === 'student' && <StudentDeneme session={session} />}
      </main>
    </div>
  );
}
