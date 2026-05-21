"""Ders → branş eşlemesi ve öğretmen uygunluk mantığı.

Kaynak: app/_components/program/ProgramOlusturucu.js (COURSE_BRANCH, teacherTeaches,
teacherGroups). Blok havuzu (classBlockPairs) ve sütun anahtarı (colKeyFor) frontend'de
hesaplanıp payload ile geliyor; burada tekrar üretilmiyor (tek kaynak frontend).
"""

# Ders → branş. İnkılap Tarihi/Sosyal Bilgiler, TYT/AYT/Geometri→Matematik eşlemeleri kritik.
COURSE_BRANCH = {
    'Türkçe': 'Türkçe',
    'TYT Matematik': 'Matematik', 'AYT Matematik': 'Matematik', 'Geometri': 'Matematik',
    'Matematik': 'Matematik',
    'Fizik': 'Fizik', 'Kimya': 'Kimya', 'Biyoloji': 'Biyoloji',
    'Tarih': 'Tarih', 'Coğrafya': 'Coğrafya', 'Felsefe': 'Felsefe',
    'Fen Bilgisi': 'Fen Bilgisi',
    'Sosyal Bilgiler': 'Sosyal Bilgiler', 'İnkılap Tarihi': 'Sosyal Bilgiler',
    'İngilizce': 'İngilizce',
}


def course_branch(course):
    return COURSE_BRANCH.get(course, course)


def teacher_teaches(teacher, branch):
    """Öğretmen branşı veya ekstra branşıyla bu dersi verebilir mi."""
    if teacher.get('branch') == branch:
        return True
    return branch in (teacher.get('extraBranches') or [])


def teacher_groups(teacher):
    """Öğretmenin ders verebileceği gruplar (boşsa tüm gruplar)."""
    ag = teacher.get('allowedGroups') or []
    return ag if len(ag) > 0 else ['ortaokul', 'lise', 'mezun']


def eligible_teachers(teachers, course, group):
    """Bu (ders, grup) için uygun öğretmen id listesi."""
    branch = course_branch(course)
    ids = []
    for t in teachers:
        if teacher_teaches(t, branch) and group in teacher_groups(t):
            ids.append(t['id'])
    return ids
