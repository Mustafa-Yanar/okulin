'use client';

// Şube registry'sini bir kez yükleyip tüm panellere dağıtan client context.
// /api/classes tüm rollere açık (yalnız oturum ister). Registry boşsa boş dizi döner;
// tüketiciler classLabelFrom(classes, cls, classLabel) ile constants fallback'e düşer
// (kayıtsız kurumda davranış bit-bit aynı kalır). Tek kaynak — her panelde ayrı fetch yok.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const ClassesContext = createContext({ classes: [], courses: [], reloadClasses: () => {} });

export function ClassesProvider({ children }) {
  const [classes, setClasses] = useState([]);
  const [courses, setCourses] = useState([]);

  const reloadClasses = useCallback(async () => {
    try {
      const res = await fetch('/api/classes', { credentials: 'same-origin' });
      if (!res.ok) return; // 401 vb. → fallback'te kal
      const data = await res.json();
      setClasses(Array.isArray(data.classes) ? data.classes : []);
      setCourses(Array.isArray(data.courses) ? data.courses : []);
    } catch {
      /* sessiz: ağ hatasında tüketiciler classLabel fallback'e düşer */
    }
  }, []);

  useEffect(() => { reloadClasses(); }, [reloadClasses]);

  return (
    <ClassesContext.Provider value={{ classes, courses, reloadClasses }}>
      {children}
    </ClassesContext.Provider>
  );
}

export function useClasses() {
  return useContext(ClassesContext);
}
