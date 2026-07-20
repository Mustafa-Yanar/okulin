import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { listEtutlerForWeek } from '@/lib/etut/rezervasyon';
import { allowedBookingWeeks, type BookingRole } from '@/lib/etut/weeks';
import { getWeekKey } from '@/lib/constants';

// GET /api/etut-sablon/all?week=YYYY-Www — o haftanın EFEKTİF etüt listesi (Faz 3: EtutSablon+
// EtutReservation TABLOSUNDAN; bayat JSON yolu kapandı). Rezervasyon sahipliği artık HAFTA-BAZLI.
// bookableWeeks: rolün YAZABİLECEĞİ haftalar (sunucu-otoriter, istemci TSİ hesabı yapmaz).

const BOOKING_ROLES = new Set(['student', 'teacher', 'director', 'counselor']);

// Bilinçli inline rol dallanması: veli yalnız kendi çocuğunun etütlerini görür.
export const GET = withAuth('auth', 'etut', async (req, _ctx, session) => {
  const { searchParams } = new URL(req.url);
  const weekKey = searchParams.get('week') || getWeekKey();

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
  return NextResponse.json({ weekKey, etutler, bookableWeeks });
});
