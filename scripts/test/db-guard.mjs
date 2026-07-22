const LOCAL_TEST_DATABASE_URL =
  'postgresql://okulin_test@127.0.0.1:55432/okulin_test?schema=public&sslmode=disable';

function describeDatabase(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('TEST_DATABASE_URL geçerli bir PostgreSQL adresi değil.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  return { url, database };
}

export function assertSafeTestDatabase(raw) {
  const { url, database } = describeDatabase(raw);
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const isLocal = localHosts.has(url.hostname);
  const remoteConfirmed = process.env.OKULIN_ALLOW_REMOTE_TEST_DB === 'SCHEMA_ONLY_CONFIRMED';

  if (!database.startsWith('okulin_test')) {
    throw new Error(
      `GÜVENLİK KİLİDİ: test veritabanı adı "okulin_test" ile başlamalı; bulunan: "${database || '(boş)'}".`,
    );
  }
  if (!isLocal && !remoteConfirmed) {
    throw new Error(
      'GÜVENLİK KİLİDİ: uzak test veritabanı reddedildi. Yalnız şema-kopyası/boş ve gerçek veri içermeyen bir veritabanı için OKULIN_ALLOW_REMOTE_TEST_DB=SCHEMA_ONLY_CONFIRMED kullanılabilir.',
    );
  }
  return { host: url.hostname, port: url.port || '5432', database, isLocal };
}

export function configureTestDatabase() {
  const raw = process.env.TEST_DATABASE_URL || LOCAL_TEST_DATABASE_URL;
  const info = assertSafeTestDatabase(raw);

  // Prisma şeması ile eski E2E yardımcıları farklı adları okuyabiliyor. Hepsini aynı,
  // kilitli test adresine sabitle; .env içindeki Neon değerlerinin önüne geç.
  process.env.TEST_DATABASE_URL = raw;
  process.env.DATABASE_POSTGRES_PRISMA_URL = raw;
  process.env.DATABASE_POSTGRES_URL_NON_POOLING = raw;
  process.env.DATABASE_URL = raw;
  process.env.DATABASE_URL_UNPOOLED = raw;
  process.env.DEFAULT_ORG = 'testkurs';
  process.env.APP_DOMAIN = process.env.APP_DOMAIN || 'localhost';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'local-test-web-secret-not-for-production';
  process.env.MOBILE_JWT_SECRET = process.env.MOBILE_JWT_SECRET || 'local-test-mobile-secret-not-for-production';
  process.env.PAYMENT_ENC_KEY = process.env.PAYMENT_ENC_KEY || 'local-test-payment-key-not-for-production';
  // Yerel web testinin .env'deki paylaşılan Upstash hesabına düşmesini engelle.
  // Rate-limit/reset yolları Redis kesintisinde bilinçli fail-open çalışır; bu adres
  // bağlantıyı anında reddeden yerel bir uçtur ve hiçbir dış veriye dokunmaz.
  process.env.UPSTASH_REDIS_REST_URL = 'http://127.0.0.1:1';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'local-test-redis-token';
  process.env.KV_REST_API_URL = 'http://127.0.0.1:1';
  process.env.KV_REST_API_TOKEN = 'local-test-redis-token';
  process.env.NODE_ENV = 'test';
  process.env.OKULIN_TEST_MODE = '1';
  return info;
}

export { LOCAL_TEST_DATABASE_URL };
