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

export type RoleCategory = 'student' | 'parent' | 'teacher' | 'management';

// Oturum rolü → kategori (sunucu MobileRoleCategory karşılığı).
// director/accountant/counselor/org_admin (+asst director payload'ı 'director' taşır)
// = management. Rol yoksa null (guard'lar yönlendirme yapar).
export function roleCategoryOf(role: string | undefined | null): RoleCategory | null {
  if (!role) return null;
  if (role === 'student' || role === 'parent' || role === 'teacher') return role;
  return 'management';
}
