// Cron uçları oturum kullanmaz; Vercel Authorization: Bearer <CRON_SECRET> gönderir.
// Secret tanımsızken `Bearer undefined` kabul edilmemeli: yapılandırma hatası hiçbir
// koşulda yetkilendirmeye dönüşmez (fail-closed).
export function isCronAuthorized(request: Pick<Request, 'headers'>, secret = process.env.CRON_SECRET): boolean {
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}
