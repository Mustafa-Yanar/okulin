"""Öğretmen uygunluk mantığı (çoklu branş modeli).

Ders adı = branş adı; otomatik eşleme YOK. Öğretmen `branches[]` içinde verebildiği
dersleri tutar. Blok havuzu (classBlockPairs) ve sütun anahtarı frontend'de hesaplanıp
payload ile geliyor.
"""


def teacher_teaches(teacher, course):
    """Öğretmen bu dersi (= branşı) verebilir mi — branches listesinde mi."""
    return course in (teacher.get('branches') or [])


def teacher_groups(teacher):
    """Öğretmenin ders verebileceği gruplar (boşsa tüm gruplar)."""
    ag = teacher.get('allowedGroups') or []
    return ag if len(ag) > 0 else ['ortaokul', 'lise', 'mezun']


def eligible_teachers(teachers, course, group):
    """Bu (ders, grup) için uygun öğretmen id listesi."""
    ids = []
    for t in teachers:
        if teacher_teaches(t, course) and group in teacher_groups(t):
            ids.append(t['id'])
    return ids
