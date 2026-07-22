// Prisma Decimal → number normalizasyonu (Float→Decimal para göçü, 2026-07-23).
//
// NEDEN: Para kolonları DB'de Decimal(12,2) — ama TÜM uygulama (web UI, native mobil,
// PDF'ler, e2e) API'den parayı JSON NUMBER olarak bekler. Prisma Decimal objesi
// JSON.stringify'da STRING'e döner ve aritmetikte sessiz bozulma riski taşır.
// Bu katman taban client'a kurulur (lib/prisma $extends) → tdb zinciri + backup dahil
// her yol number görür; istemci sözleşmesi değişmez.
//
// Derin yürüyüş: para, başka model kökünden de gelir (student include finance include
// installments — muhasebe listesi/mobil today/payment-start). Kök sonucun tamamı
// yüründüğü için nested değerler de yakalanır. Sonuç nesneleri taze olduğundan
// yerinde mutasyon güvenli ve kopyasızdır.
import { Prisma } from '@prisma/client';

// Para taşıyan VEYA include ile para taşıyabilen kök modeller — yalnız bunların
// sonuçları yürünür (backup'ın tablo-tablo dump'ı gibi büyük sorgularda gereksiz
// walk maliyeti olmasın). Yeni bir kökten finance/installment/expense include
// edilirse bu sete EKLENMELİ (int-money-types e2e tip assertleri regresyonu yakalar).
export const MONEY_WALK_MODELS = new Set(['Finance', 'Installment', 'Expense', 'Student', 'PayOrder']);

export function decimalToNumberDeep<T>(v: T): T {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  if (Prisma.Decimal.isDecimal(v)) return Number(v) as unknown as T;
  if (v instanceof Date) return v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = decimalToNumberDeep(v[i]);
    return v;
  }
  if (Buffer.isBuffer(v)) return v;
  for (const k of Object.keys(v)) {
    (v as Record<string, unknown>)[k] = decimalToNumberDeep((v as Record<string, unknown>)[k]);
  }
  return v;
}
