// PostgreSQL advisory kilitleri — transaction ömürlü (pg_advisory_xact_lock), tx bitince
// otomatik bırakılır. Alan-bağımsız: etüt rezervasyonu, slot gridi ve finans yolu aynı
// altyapıyı kullanır (eskiden lib/etut/reservations.ts içindeydi; finans modülünün etüt
// dosyasından kilit import etmesi yanlış bağ olurdu → nötr modüle taşındı).
//
// SIRA KURALI (deadlock-free, TÜM çağrı yerlerinde SABİT): ÖNCE lockResource, SONRA
// lockStudentWeek. İki transaction ikisini de istiyorsa (aynı kaynak+aynı öğrenci) anahtar
// çifti özdeş → aynı sırada alınır → döngü yok. Farklı öğrenci+aynı kaynak yalnız
// kaynak-kilidinde, aynı öğrenci+farklı kaynak yalnız öğrenci-kilidinde çekişir → deadlock
// yapısal olarak imkânsız.

import type { Prisma } from '@prisma/client';

// Öğrenci+hafta advisory lock — çapraz-sistem (SlotBooking+EtutReservation) limit/çakışma
// yarışını önler (Gemini denetimi). branch AÇIKÇA anahtarda (Faz 2 audit-fix FIX-A) —
// eskiden yoktu, orgSlug+studentId+weekKey tek başına branch'ler arası da aynı anahtara
// düşüyordu (aynı studentId farklı branch'lerde teorik olarak var olabilir — id şeması
// bunu engellemese de anahtar tam-kapsamlı olmalı).
// Salt=0 — lockResource'un salt=1'inden FARKLI namespace (aşağıdaki gerekçe).
export async function lockStudentWeek(tx: Prisma.TransactionClient, orgSlug: string, branch: string, studentId: string, weekKey: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgSlug}:${branch}:${studentId}:${weekKey}`}, 0))`;
}

// Kaynak-bazlı advisory lock (Faz 2 audit-fix FIX-A, KRİTİK) — kök neden: lockStudentWeek
// yalnız öğrenci+hafta üzerinde kilitleniyordu; İKİ FARKLI öğrenci AYNI kaynağa (etüt
// sablonId+weekKey, ya da SlotBooking hücresi) eşzamanlı başvurunca FARKLI kilit alıyor →
// ikisi de boş görüyor → 2. yazma 1.'yi sessizce eziyor (ya da unique-ihlali → 500).
// Çağıran, çekişilen kaynağı temsil eden herhangi bir string anahtar verir:
//   `etut:${orgSlug}:${branch}:${sablonId}:${weekKey}`
//   `slotweek:${orgSlug}:${branch}:${weekKey}:${teacherId}`
//   `finance:${orgSlug}:${branch}:${studentId}`   (para yolu — ledger read-modify-write)
// Salt=1 (lockStudentWeek'in salt=0'ından FARKLI, Faz 2 audit-fix carry-over) — iki fonksiyon
// STRING ANAHTAR ÇAKIŞMASI olasılığına karşı (örn. bir kaynak-anahtarı tesadüfen bir
// öğrenci-hafta anahtarıyla bayt-bayt eşleşirse) ayrı hash NAMESPACE'lerinde yaşar; aksi halde
// hashtextextended aynı (key,salt) çiftinden aynı lock-id üretir ve iki AYRI mantıksal kaynak
// aynı advisory lock'u paylaşıp gereksiz yere serileşebilirdi.
export async function lockResource(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 1))`;
}
