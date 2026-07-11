import { NextResponse } from 'next/server';

// Servis katmanı HTTP hatası — lib↔route arası TEK hata sözleşmesi.
//
// SORUN (eski): bazı lib fonksiyonları iş-kuralı ihlalinde `{ ok:false, error, status }`
// döndürüyordu; her route bunu tek tek `NextResponse.json({ error }, { status })`
// biçimine ÇEVİRİYORDU → iki ayrı hata sözleşmesi + kopya çeviri kodu.
//
// ÇÖZÜM: servis fonksiyonu iş-kuralı ihlalinde `throw new HttpError(status, mesaj)`.
// withAuth (veya errorResponse) TEK noktada { error } gövdesine + doğru status'a çevirir.
// Route yalnız başarı değerini kullanır; hata çevirisi yapmaz.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

// HttpError → { error } + status JSON yanıtı. HttpError DIŞINDAKİ her şeyi yeniden
// fırlatır (gerçek 500'ler / Next'in redirect-notFound sinyalleri yutulmasın → varsayılan
// handler'a gitsin). withAuth catch bloğu ve withAuth kullanmayan route'lar bunu çağırır.
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  throw e;
}
