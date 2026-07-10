'use client';

// Şube registry'sini bir kez yükleyip tüm panellere dağıtan client context.
// /api/classes tüm rollere açık (yalnız oturum ister). Registry boşsa boş dizi döner;
// tüketiciler classLabelFrom(classes, cls, classLabel) ile constants fallback'e düşer
// (kayıtsız kurumda davranış bit-bit aynı kalır). Tek kaynak — her panelde ayrı fetch yok.
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { ClassRecord } from '@/lib/classes';
import type { CourseRecord } from '@/lib/courses';

interface ClassesContextValue {
  classes: ClassRecord[];
  courses: CourseRecord[];
  loaded: boolean;
  reloadClasses: () => void | Promise<void>;
}

const ClassesContext = createContext<ClassesContextValue>({ classes: [], courses: [], loaded: false, reloadClasses: () => {} });

interface ClassesProviderProps {
  children: ReactNode;
}

export function ClassesProvider({ children }: ClassesProviderProps) {
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  // İlk fetch tamamlandı mı? Tüketiciler bunu "kayıt gerçekten boş" ile "henüz yüklenmedi"
  // ayrımı için kullanır — aksi halde ilk render'da boş diziyi "kayıtsız kurum" sanıp
  // sabit-kod fallback'ine düşebilirler.
  const [loaded, setLoaded] = useState(false);

  const reloadClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/classes', { credentials: 'same-origin' });
      if (!res.ok) return; // 401 vb. → fallback'te kal
      // res.json() `any` döndürür; GET /api/classes sözleşmesi { classes, courses } (route.ts GET).
      const data = (await res.json()) as { classes?: ClassRecord[]; courses?: CourseRecord[] };
      setClasses(Array.isArray(data.classes) ? data.classes : []);
      setCourses(Array.isArray(data.courses) ? data.courses : []);
    } catch {
      /* sessiz: ağ hatasında tüketiciler classLabel fallback'e düşer */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { reloadClasses(); }, [reloadClasses]);

  return (
    <ClassesContext.Provider value={{ classes, courses, loaded, reloadClasses }}>
      {children}
    </ClassesContext.Provider>
  );
}

export function useClasses(): ClassesContextValue {
  return useContext(ClassesContext);
}
