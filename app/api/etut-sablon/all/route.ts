import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { listEtutlerForWeek } from '@/lib/etut/rezervasyon';
import { allowedBookingWeeks, isValidWeekKey, type BookingRole } from '@/lib/etut/weeks';
import { getWeekKey } from '@/lib/constants';

// GET /api/etut-sablon/all?week=YYYY-Www — o haftanın EFEKTİF etüt listesi (Faz 3: EtutSablon+
// EtutReservation TABLOSUNDAN; bayat JSON yolu kapandı). Rezervasyon sahipliği artık HAFTA-BAZLI.
// bookableWeeks: rolün YAZABİLECEĞİ haftalar (sunucu-otoriter, istemci TSİ hesabı yapmaz).

const BOOKING_ROLES = new Set(['student', 'teacher', 'director', 'counselor']);

// Bilinçli inline rol dallanması: veli yalnız kendi çocuğunun etütlerini görür.
export const GET = withAuth('auth', 'etut', async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const weekParam = searchParams.get('week');
  // resolveEffective ISO-string sıralamasına dayanır; 'foo'/'2026-W99' gibi geçersiz
  // değerler recurring'i yanlış efektif gösterebilir — sessiz düşüş yerine 400 (teşhis edilebilir).
  if (weekParam && !isValidWeekKey(weekParam)) {
    return NextResponse.json({ error: 'Geçersiz hafta formatı' }, { status: 400 });
  }
  const weekKey = weekParam || getWeekKey();

  const etutler = await listEtutlerForWeek(weekKey);
  const bookableWeeks = BOOKING_ROLES.has(session.role)
    ? allowedBookingWeeks(session.role as BookingRole)
    : [];

  if (session.role === 'parent') {
    const childId = searchParams.get('studentId');
    const allowed = childId && canReadStudent(session, childId);
    const mine = allowed ? etutler.filter(e => e.studentId === childId) : [];
    return NextResponse.json({ weekKey, etutler: mine, bookableWeeks });
  }

  // Additive: opsiyonel studentId — tek öğrenciye daraltır (örn. StudentEtutTab).
  const studentId = searchParams.get('studentId');
  const scoped = studentId ? etutler.filter(e => e.studentId === studentId) : etutler;
  return NextResponse.json({ weekKey, etutler: scoped, bookableWeeks });
});
