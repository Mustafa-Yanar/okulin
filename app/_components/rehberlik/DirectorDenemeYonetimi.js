'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, ChevronLeft, KeyRound, Upload, BarChart3, GitMerge } from 'lucide-react';
import AnswerKeyForm from './AnswerKeyForm';
import VeriGirisi from './VeriGirisi';
import SonucListesi from './SonucListesi';
import MergeListesi from './MergeListesi';

const TYPE_LABEL = { TYT: 'TYT', AYT: 'AYT', LGS: 'LGS' };

// Müdür/rehber: sınav oluştur → cevap anahtarı gir → (Faz 2) veri gir → (Faz 3) sonuç.
export default function DirectorDenemeYonetimi({ showToast }) {
  const [mode, setMode] = useState('list'); // 'list' | 'create' | 'detail' | 'merge'
  const [exams, setExams] = useState([]);
  const [detailId, setDetailId] = useState(null);

  async function loadList() {
    const res = await fetch('/api/deneme/exams', { credentials: 'same-origin' });
    if (res.ok) setExams((await res.json()).exams || []);
  }
  useEffect(() => { loadList(); }, []);

  function openDetail(id) {
    setDetailId(id);
    setMode('detail');
  }

  async function remove(id, e) {
    e.stopPropagation();
    if (!confirm('Bu sınavı (cevap anahtarı + tüm veriler) silmek istediğine emin misin?')) return;
    const res = await fetch(`/api/deneme/exams/${id}`, { method: 'DELETE', credentials: 'same-origin' });
    if (res.ok) {
      setExams((prev) => prev.filter((x) => x.id !== id));
      showToast('Sınav silindi');
    }
  }

  if (mode === 'create') {
    return (
      <CreateExam
        showToast={showToast}
        onCancel={() => setMode('list')}
        onCreated={(id) => { loadList(); openDetail(id); }}
      />
    );
  }

  if (mode === 'detail' && detailId) {
    return <ExamDetail examId={detailId} showToast={showToast} onBack={() => { setMode('list'); loadList(); }} />;
  }

  if (mode === 'merge') {
    return <MergeListesi exams={exams} showToast={showToast} onBack={() => setMode('list')} />;
  }

  // Liste
  return (
    <div className="space-y-3">
      <div className="flex justify-end gap-2">
        <button onClick={() => setMode('merge')} className="btn-ghost !px-4 !py-2 flex items-center gap-2">
          <GitMerge size={16} /> TYT+AYT Birleştir
        </button>
        <button onClick={() => setMode('create')} className="btn-primary !px-5 !py-2 flex items-center gap-2">
          <Plus size={16} /> Yeni Sınav
        </button>
      </div>

      {exams.length === 0 ? (
        <div className="card p-10 text-center text-gray-400">Henüz sınav oluşturulmadı.</div>
      ) : (
        exams.map((e) => (
          <div
            key={e.id}
            onClick={() => openDetail(e.id)}
            className="card p-4 flex items-center justify-between gap-3 cursor-pointer hover:brightness-[0.99]"
          >
            <div className="flex items-center gap-3">
              <span className="badge-info text-xs px-2 py-0.5 rounded">{TYPE_LABEL[e.examType] || e.examType}</span>
              <div>
                <div className="font-700 text-gray-800" style={{ fontWeight: 700 }}>{e.name}</div>
                <div className="text-xs text-gray-400">{new Date(e.date).toLocaleDateString('tr-TR')}</div>
              </div>
            </div>
            <button onClick={(ev) => remove(e.id, ev)} className="text-gray-300 hover:text-red-600 transition-colors">
              <Trash2 size={16} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function CreateExam({ showToast, onCancel, onCreated }) {
  const [name, setName] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [examType, setExamType] = useState('TYT');
  const [kitapcikSayisi, setKitapcik] = useState(1);
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return showToast('Sınav adı gir.', 'error');
    setSaving(true);
    try {
      const res = await fetch('/api/deneme/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: name.trim(), date: new Date(date).toISOString(), examType, kitapcikSayisi }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showToast(data.error || 'Oluşturulamadı', 'error');
      showToast('Sınav oluşturuldu');
      onCreated(data.examId);
    } catch {
      showToast('Sunucuya ulaşılamadı', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <button onClick={onCancel} className="text-sm text-gray-500 flex items-center gap-1 hover:text-gray-700">
        <ChevronLeft size={15} /> Sınavlar
      </button>
      <div className="card p-4 sm:p-5">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-600 mb-1" style={{ fontWeight: 600 }}>Sınav Adı</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ODAK AYT 5. Kurumsal Deneme" className="input" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 mb-1" style={{ fontWeight: 600 }}>Tarih</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1" style={{ fontWeight: 600 }}>Sınav Türü</label>
              <select value={examType} onChange={(e) => setExamType(e.target.value)} className="input">
                <option value="TYT">TYT</option>
                <option value="AYT">AYT</option>
                <option value="LGS">LGS</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1" style={{ fontWeight: 600 }}>Kitapçık Sayısı</label>
            <div className="flex gap-2">
              {[1, 2].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setKitapcik(n)}
                  className={`px-4 py-2 rounded-lg text-sm border ${kitapcikSayisi === n ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-gray-200 text-gray-600'}`}
                >
                  {n === 1 ? 'Tek (A)' : 'İki (A / B)'}
                </button>
              ))}
            </div>
          </div>
          <button type="submit" disabled={saving} className="btn-primary !px-6 !py-2.5 disabled:opacity-60">
            {saving ? 'Oluşturuluyor...' : 'Oluştur'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ExamDetail({ examId, showToast, onBack }) {
  const [exam, setExam] = useState(null);
  const [step, setStep] = useState('cevap'); // 'cevap' | 'veri' | 'sonuc'
  const [rows, setRows] = useState([]);

  async function load() {
    const res = await fetch(`/api/deneme/exams/${examId}`, { credentials: 'same-origin' });
    if (res.ok) {
      const d = await res.json();
      setExam(d.exam);
      setRows(d.exam?.rows || []);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [examId]);

  if (!exam) return <div className="card p-10 text-center text-gray-400">Yükleniyor…</div>;

  const STEPS = [
    ['cevap', 'Cevap Anahtarı', KeyRound],
    ['veri', 'Veri Girişi', Upload],
    ['sonuc', 'Sonuçlar', BarChart3],
  ];

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 flex items-center gap-1 hover:text-gray-700">
        <ChevronLeft size={15} /> Sınavlar
      </button>

      <div className="flex items-center gap-3">
        <span className="badge-info text-xs px-2 py-0.5 rounded">{TYPE_LABEL[exam.examType] || exam.examType}</span>
        <h2 className="font-700 text-xl" style={{ fontWeight: 700 }}>{exam.name}</h2>
        <span className="text-sm text-gray-400">{new Date(exam.date).toLocaleDateString('tr-TR')}</span>
      </div>

      <div className="pill-tabs">
        {STEPS.map(([k, label, Icon]) => (
          <button key={k} onClick={() => setStep(k)} className={`pill-tab${step === k ? ' is-active' : ''}`}>
            <Icon size={13} /> <span>{label}</span>
          </button>
        ))}
      </div>

      {step === 'cevap' && <AnswerKeyForm exam={exam} showToast={showToast} />}

      {step === 'veri' && (
        <VeriGirisi exam={exam} rows={rows} onChanged={load} showToast={showToast} />
      )}

      {step === 'sonuc' && <SonucListesi exam={exam} showToast={showToast} />}
    </div>
  );
}
