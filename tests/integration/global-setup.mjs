export default async function setup() {
  // Dış sarmalayıcı veritabanı güvenlik kilidini kurduktan sonra her entegrasyon
  // koşusunu aynı, tamamen sentetik başlangıç durumuna getirir.
  await import('../../scripts/test/seed-local-db.mjs');
}
