'use client';

import { useEffect, useState } from 'react';

// Öğretmen: tüm denemelerin tüm öğrenci sıralamasını görür (salt okunur).
export default function TeacherDeneme() {
  const [exams, setExams] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [ranking, setRanking] = useState([]);

  useEffect(() => {
    fetch('/api/deneme/exams', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => setExams(d.exams || []));
  }, []);

  async function open(id) {
    if (openId === id) return setOpenId(null);
    const res = await fetch(`/api/deneme/exams/${id}`, { credentials: 'same-origin' });
    if (res.ok) {
      setRanking((await res.json()).ranking);
      setOpenId(id);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-800 text-gray-900" style={{ fontWeight: 800 }}>
          Deneme Sonuçları
        </h1>
        <p className="text-sm text-gray-400">Tüm öğrencilerin deneme sıralamaları</p>
      </div>

      {exams.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400">
          Henüz deneme yüklenmedi.
        </div>
      ) : (
        <div className="space-y-3">
          {exams.map((e) => (
            <div key={e.id} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <button onClick={() => open(e.id)} className="w-full p-4 text-left">
                <div className="font-700 text-gray-800" style={{ fontWeight: 700 }}>
                  {e.name}
                </div>
                <div className="text-xs text-gray-400">
                  {e.examType} · {new Date(e.date).toLocaleDateString('tr-TR')}
                </div>
              </button>
              {openId === e.id && (
                <div className="border-t border-gray-100 max-h-96 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-gray-500 sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2 font-600" style={{ fontWeight: 600 }}>Sıra</th>
                        <th className="text-left px-4 py-2 font-600" style={{ fontWeight: 600 }}>İsim</th>
                        <th className="text-right px-4 py-2 font-600" style={{ fontWeight: 600 }}>Toplam Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking.map((r) => (
                        <tr key={r.rank} className="border-t border-gray-50 hover:bg-gray-50">
                          <td className="px-4 py-2 text-gray-500">{r.rank}</td>
                          <td className="px-4 py-2 text-gray-700">
                            {r.excelName}
                            {!r.studentId && <span className="text-xs text-amber-500 ml-2">(eşleşmedi)</span>}
                          </td>
                          <td className="px-4 py-2 text-right font-700 text-indigo-600" style={{ fontWeight: 700 }}>
                            {r.toplamNet.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
