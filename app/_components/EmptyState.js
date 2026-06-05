'use client';

// Tek tip boş-durum bileşeni — "henüz X yok / bulunamadı" ekranları için.
// iOS UI kit "Empty States" düzeninden uyarlandı: yumuşak ikon dairesi + başlık
// + opsiyonel açıklama + opsiyonel aksiyon. Tema değişkenleriyle (açık/koyu uyumlu).
//
// Kullanım:
//   <EmptyState icon={Users} title="Henüz öğretmen yok" description="Yeni öğretmen ekleyin." />
//   <EmptyState icon={Search} title="Sonuç bulunamadı" compact />
//   <EmptyState icon={FileText} title="Kaynak yok" action={<button className="btn-primary ...">Ekle</button>} />

export default function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,   // dar alanlar (liste içi) için daha küçük boşluk
  card = false,       // kart zemini içinde göstermek istenirse
}) {
  const pad = compact ? 'py-8' : 'py-12';
  const iconSize = compact ? 22 : 28;
  const circle = compact ? 'w-12 h-12' : 'w-16 h-16';

  const body = (
    <div className={`flex flex-col items-center text-center ${pad} px-4`}>
      {Icon && (
        <div
          className={`${circle} rounded-full flex items-center justify-center mb-3`}
          style={{
            background: 'color-mix(in srgb, var(--brand, #6366f1) 8%, var(--bg-surface))',
            color: 'color-mix(in srgb, var(--brand, #6366f1) 55%, var(--text-muted))',
          }}
        >
          <Icon size={iconSize} strokeWidth={1.75} />
        </div>
      )}
      <p
        className={compact ? 'text-sm' : 'text-base'}
        style={{ fontWeight: 600, color: 'var(--text-primary)' }}
      >
        {title}
      </p>
      {description && (
        <p className="text-caption mt-1 max-w-[34ch]" style={{ color: 'var(--text-muted)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );

  if (card) {
    return <div className="card overflow-hidden">{body}</div>;
  }
  return body;
}
