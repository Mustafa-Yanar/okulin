import { NextResponse } from 'next/server';
import { withAuth, canReadStudent } from '@/lib/auth';
import { listEtutlerForWeek, attachEtutYoklama } from '@/lib/etut/rezervasyon';
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
    if (!childId || !canReadStudent(session, childId)) {
      return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
    }
    const mine = etutler.filter(e => e.studentId === childId);
    return NextResponse.json({ weekKey, etutler: mine, bookableWeeks });
  }

  // Öğrenci boş/dolu slotları görür; fakat başka öğrencinin kimliği, dersi ve atama
  // kaynağı rezerve edilebilirlik için gerekli değildir. Kendi rezervasyonu tam kalır.
  if (session.role === 'student') {
    const safe = etutler.map((e) => {
      if (!e.studentId || e.studentId === session.id) return e;
      return { ...e, studentId: null, studentName: null, studentCls: null, branch: null, bookedBy: null, scope: null };
    });
    return NextResponse.json({ weekKey, etutler: safe, bookableWeeks });
  }

  // Öğretmenin meşru tüketicileri yalnız kendi yoklama/atama ekranlarıdır.
  if (session.role === 'teacher') {
    return NextResponse.json({ weekKey, etutler: etutler.filter(e => e.teacherId === session.id), bookableWeeks });
  }

  if (session.role !== 'director' && session.role !== 'counselor') {
    return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  }

  // Additive: opsiyonel studentId — tek öğrenciye daraltır (örn. StudentEtutTab).
  const studentId = searchParams.get('studentId');
  const scoped = studentId ? etutler.filter(e => e.studentId === studentId) : etutler;

  // Additive: ?att=1 (yalnız müdür/rehber) — atanmış satırlara etüt yoklama durumu
  // iliştirir (toplu görünüm rozeti). Diğer tüketiciler için maliyet eklemez.
  if (searchParams.get('att') === '1' && (session.role === 'director' || session.role === 'counselor')) {
    return NextResponse.json({ weekKey, etutler: await attachEtutYoklama(scoped, weekKey), bookableWeeks });
  }
  return NextResponse.json({ weekKey, etutler: scoped, bookableWeeks });
});
