// TSİ (+03) hafta penceresi — birleşik rezervasyon servisi (Faz 2b bookEtut) için.
// DİKKAT: lib/constants getWeekKey SUNUCU-YEREL saat kullanır (Vercel=UTC) →
// Pzt 00:00-03:00 TSİ arasında YANLIŞ (önceki) hafta döndürür. Rezervasyon pencere
// kuralı bu yüzden buradaki TSİ-doğru hesabı kullanır; getWeekKey'e DOKUNULMAZ
// (mevcut çağıranların davranışı korunur — onların göçü ayrı iş).

const TSI_OFFSET_MS = 3 * 60 * 60 * 1000;

export type BookingRole = 'student' | 'teacher' | 'director' | 'counselor';

// Sonraki haftanın öğrenci/öğretmene açıldığı an: Pazar 11:00 TSİ
// (Mustafa kararı 2026-07-20 — haftalık cron "0 8 * * 0" UTC = Pazar 11:00 TSİ ile hizalı).
export const SUNDAY_OPEN_MINUTES = 11 * 60;

// TSİ duvar-saati parçaları (UTC alanlarında okunur — sunucu saat diliminden bağımsız).
function tsiParts(now: Date): { dow: number; minutes: number } {
  const t = new Date(now.getTime() + TSI_OFFSET_MS);
  return { dow: t.getUTCDay(), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() }; // dow: 0=Pazar
}

// TSİ'ye göre ISO-8601 hafta anahtarı ("YYYY-Www").
export function currentWeekKeyTSI(now: Date = new Date()): string {
  const t = new Date(now.getTime() + TSI_OFFSET_MS);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ISO-8601 hafta anahtarı biçim doğrulayıcı (Faz 2 audit-fix FIX-C) — W01..W53 aralığı
// (W00 ve W54+ formatı tutsa da geçersiz ISO hafta olurdu). booking.ts normalizeWeekKey
// (RECURRING'te geçersiz → 400; W99 gibi bir değer effectiveFromWeek'e yazılırsa
// resolveEffective'in string karşılaştırmasında ASLA erişilemeyen 'ölü seri' yaratır) ve
// app/api/etut-sablon/rezervasyon/route.ts POST şeması bunu kullanır.
export function isValidWeekKey(wk: string): boolean {
  return /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(wk);
}

// weekKey'i delta hafta kaydır (ISO-doğru, yıl sınırı dahil).
export function shiftWeekKey(weekKey: string, delta: number): string {
  const [y, wStr] = weekKey.split('-W');
  const jan4 = new Date(Date.UTC(parseInt(y), 0, 4));
  const dow = jan4.getUTCDay() || 7;
  const mon = new Date(jan4);
  mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (parseInt(wStr) - 1 + delta) * 7);
  // Pazartesi 12:00 TSİ anı üzerinden anahtar üret (gün kayması riski yok)
  return currentWeekKeyTSI(new Date(mon.getTime() + 12 * 60 * 60 * 1000 - TSI_OFFSET_MS));
}

// Saklama (retention) sınırı: bu anahtardan ESKİ haftalar silinebilir; sınırın KENDİSİ
// ve sonrası tutulur (yani tam `weeks` hafta geriye kadar veri kalır).
// 'YYYY-Www' sıfır-dolgulu olduğundan string kıyası kronolojiktir (shouldRollWeek ile aynı ilke)
// → çağıran `weekKey: { lt: cutoff }` ile silebilir, tarih sütununa ihtiyaç yoktur.
export function retentionCutoffWeekKey(weeks: number, now: Date = new Date()): string {
  return shiftWeekKey(currentWeekKeyTSI(now), -weeks);
}

// Rollover kararı (Faz 4 FIX-1, Codex kritik bulgusu): stored current_week takvimden İLERİDEyse
// devir ZATEN yapılmıştır (çifte cron/retry) → atla. Geride/eşitse devret (kaçırılmış hafta
// telafisi: her koşu 1 hafta ilerletir, arka arkaya koşular yetişir).
export function shouldRollWeek(storedWeek: string, actualWeek: string): boolean {
  return storedWeek <= actualWeek; // ISO 'YYYY-Www' string kıyası kronolojik
}

// Rolün REZERVASYON YAZABİLECEĞİ haftalar (spec §5). Görüntüleme serbest — bu yazma kapısı.
export function allowedBookingWeeks(role: BookingRole, now: Date = new Date()): string[] {
  const cur = currentWeekKeyTSI(now);
  if (role === 'director' || role === 'counselor') {
    return [cur, shiftWeekKey(cur, 1), shiftWeekKey(cur, 2)];
  }
  const { dow, minutes } = tsiParts(now);
  const nextOpen = dow === 0 && minutes >= SUNDAY_OPEN_MINUTES;
  return nextOpen ? [cur, shiftWeekKey(cur, 1)] : [cur];
}
