// E2E dosyalarının güvenlik sınıfları. Yeni *.spec.js eklendiğinde mimari sözleşme
// testi bu listelerden birine bilinçli yerleştirilmesini zorunlu kılar.
const LOCAL_SAFE = [
  'int-access-boundaries.spec.js',
  'int-money-types.spec.js',
  'int-payment-callback.spec.js',
  'int-slots-rules.spec.js',
  'smoke.spec.js',
  'sql-auth.spec.js',
  'sql-multicontext.spec.js',
  'sql-reads.spec.js',
  'sql-writes.spec.js',
  'ui-duyuru.spec.js',
  'ui-etut-overview.spec.js',
  'ui-etut.spec.js',
  'ui-odev.spec.js',
  'ui-yoklama.spec.js',
];

const REDIS_REQUIRED = [
  'int-mobile-auth.spec.js',
  'int-mobile-content.spec.js',
  'int-mobile-push.spec.js',
  'int-mobile-v2.spec.js',
  'int-ratelimit.spec.js',
];

const EXTERNAL_SERVICE = ['int-program-solve.spec.js'];
const INFRASTRUCTURE_MUTATION = ['int-tenant-isolation.spec.js'];

module.exports = { LOCAL_SAFE, REDIS_REQUIRED, EXTERNAL_SERVICE, INFRASTRUCTURE_MUTATION };
