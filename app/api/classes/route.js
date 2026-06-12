import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getClasses } from '@/lib/classes';
import { getCourses } from '@/lib/courses';

export const runtime = 'nodejs';

// GET /api/classes — geçerli kurumun şube listesi + ders kataloğu.
// Tüm giriş yapmış roller okur (dropdown'lar için). Registry boşsa constants fallback döner
// → davranış bugünküyle birebir. Yazma (CRUD) Adım 4'te eklenecek.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Giriş gerekli' }, { status: 401 });

  const [classes, courses] = await Promise.all([getClasses(), getCourses()]);
  return NextResponse.json({ classes, courses });
}
