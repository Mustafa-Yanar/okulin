// "1.2.3" biçimli sürüm karşılaştırma — bootstrap minSupportedVersion kapısı için.
// Eksik/bozuk parça 0 sayılır (fail-open değil: "0.0.0" min her sürümü geçirir,
// superadmin min'i yükselttiğinde eski sürüm kapıya takılır).
export function semverLt(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}
