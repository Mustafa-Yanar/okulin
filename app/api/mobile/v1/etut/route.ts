import { NextResponse, type NextRequest } from 'next/server';
import { withMobileAuth } from '@/lib/mobile/auth';
import { contentLimited } from '@/lib/mobile/limits';
import { listBookableEtuts } from '@/lib/etut/rezervasyon';
import { trToday } from '@/lib/mobile/today';
import { ALL_DAYS } from '@/lib/constants';
import { getOrgConfig } from '@/lib/config';

// Öğrencinin bu hafta rezerve edebileceği etütler (spec §5.1). Yalnız öğrenci rolü;
// veli/öğretmen/yönetim 403 (mobil etüt yazma = öğrenci self-servis, plan ADR).
// Servis HttpError fırlatır → withMobileAuth tek noktada çevirir (kendi try/catch YOK).
export const runtime = 'nodejs';

export const GET = withMobileAuth(async (req: NextRequest, _ctx, session) => {
  if (session.role !== 'student') return NextResponse.json({ error: 'Yetkisiz' }, { status: 403 });
  const limited = await contentLimited(session.sid);
  if (limited) return limited;
  const mods = await getOrgConfig('modules');
  if (mods.etut === false) return NextResponse.json({ error: 'Bu modül kurumunuzda kapalı' }, { status: 403 });

  // Hafta biçim doğrulaması (İnceleme Codex #11): W00/W99 anlamsız haftalar getMondayOfWeek'i
  // saçma tarihlere normalize eder → geçersizde bu haftaya düş.
  const rawWeek = new URL(req.url).searchParams.get('week');
  const weekKey = rawWeek && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(rawWeek) ? rawWeek : trToday().weekKey;
  const bookable = await listBookableEtuts(String(session.id ?? ''), weekKey);
  const slots = bookable.map((b) => ({ ...b, dayLabel: ALL_DAYS[b.dayIndex]?.label ?? '' }));
  return NextResponse.json({ weekKey, slots });
});
