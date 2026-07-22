import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth';
import { listStudentEtutHistory, listTeacherEtutHistory } from '@/lib/etut/history';

// GET /api/archive?type=teacher&id=xxx  veya  ?type=student&id=xxx
// Etüt geçmişi — tek kaynak EtutReservation (lib/etut/history: geçmiş+cari hafta efektif,
// RECURRING freeze dahil). 2026-07-22 denetim B3/dalga2: SlotBooking (ders) yarısı
// KALDIRILDI — booked satır artık hiç üretilmiyor (grid rezervasyon yüzeyi dalga1'de
// emekli) ve tarihsel booked veri de yoktu (canlı tarama: tüm haftalarda booked=0).
// Kanıt/harita: docs/superpowers/specs/2026-07-22-buyuk-temizlik-faz1-harita.md (B3/B5).
export const GET = withAuth(['director', 'counselor'], async (req) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // 'teacher' | 'student'
  const id = searchParams.get('id');

  if (!type || !id) return NextResponse.json({ error: 'type ve id gerekli' }, { status: 400 });
  if (type !== 'teacher' && type !== 'student') return NextResponse.json({ error: 'Geçersiz type' }, { status: 400 });

  // lib/etut/history zaten hafta-azalan sıralı döndürür (buildEtutHistoryWeeks).
  const weeks = type === 'teacher' ? await listTeacherEtutHistory(id) : await listStudentEtutHistory(id);

  return NextResponse.json({ weeks });
});
