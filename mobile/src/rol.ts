// Rol → Türkçe etiket (oturum payload'ındaki role değerleri; UI her yerde bunu kullanır).
export const ROLE_LABEL: Record<string, string> = {
  student: 'Öğrenci',
  parent: 'Veli',
  teacher: 'Öğretmen',
  director: 'Müdür',
  accountant: 'Muhasebeci',
  counselor: 'Rehber',
  org_admin: 'Kurum Yöneticisi',
};

export function rolEtiketi(role: string | undefined): string {
  return (role && ROLE_LABEL[role]) || role || '';
}
