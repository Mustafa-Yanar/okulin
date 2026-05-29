// Türk cep telefonu doğrulama ve normalleştirme (dependency-free).
// SMS gönderimi için tutarlı kanonik format gerekir: 10 hane, 5 ile başlar.
//
// Kabul edilen girişler (hepsi aynı kanonik forma normalize olur):
//   "0532 123 45 67", "+90 532 123 45 67", "905321234567",
//   "00905321234567", "5321234567", "0532-123-45-67"
// Kanonik çıktı: "5321234567"

// Ham girişi kanonik 10 haneli forma çevirir. Geçersizse null.
export function normalizeTurkishMobile(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, ''); // sadece rakamlar

  // Ülke kodu / baştaki sıfır temizle
  if (digits.startsWith('0090')) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith('90')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);

  // Kanonik: 10 hane ve 5 ile başlamalı (tüm Türk GSM operatörleri)
  if (digits.length !== 10) return null;
  if (digits[0] !== '5') return null;
  return digits;
}

// Geçerli Türk cep numarası mı?
export function isValidTurkishMobile(raw) {
  return normalizeTurkishMobile(raw) !== null;
}

// Görüntüleme formatı: "0532 123 45 67". Geçersizse ham değeri olduğu gibi döndürür.
export function formatTurkishMobile(raw) {
  const n = normalizeTurkishMobile(raw);
  if (!n) return raw || '';
  return `0${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6, 8)} ${n.slice(8, 10)}`;
}

// SMS API'leri için 90 ön ekli form: "905321234567". Geçersizse null.
export function toSmsFormat(raw) {
  const n = normalizeTurkishMobile(raw);
  return n ? `90${n}` : null;
}
