// SQL göçü bayrağı. AÇIK (OKULIN_USE_SQL=1) → veri erişimi PostgreSQL (tdb).
// KAPALI (varsayılan) → mevcut Redis yolu, birebir dokunulmadan. Üretimde tüm modüller
// göç edilip tam test geçene kadar KAPALI; sonra atomik çevrilir, Redis = anında rollback.
export const useSql = () => process.env.OKULIN_USE_SQL === '1';
