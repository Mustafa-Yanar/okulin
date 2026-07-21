import { describe, it, expect } from 'vitest';
import { resolveTargetStudent, autoPickBranch } from './booking';
import { HttpError } from '@/lib/errors';

// resolveTargetStudent — lib/etut/rezervasyon.ts reserveEtut satır 76-87 ile BİREBİR:
// öğrenci kendini, öğretmen kendi etüdüne (aksi 403), müdür/rehber girdiyi hedefler;
// başka rol → 403 'Yetkisiz'; hedef boş kalırsa 400 'Öğrenci belirtilmedi'.
describe('resolveTargetStudent — hedef öğrenci çözümü (rol bazlı)', () => {
  it('öğrenci → her zaman kendisi (inputStudentId yok sayılır)', () => {
    expect(resolveTargetStudent('student', 'stu-1', 'teacher-1', 'baska-ogrenci')).toBe('stu-1');
  });

  it('öğretmen, kendi etüdü → inputStudentId hedeflenir', () => {
    expect(resolveTargetStudent('teacher', 'teacher-1', 'teacher-1', 'stu-9')).toBe('stu-9');
  });

  it("öğretmen, BAŞKA öğretmenin etüdü → 403 'Sadece kendi etütlerinize öğrenci yazabilirsiniz'", () => {
    expect(() => resolveTargetStudent('teacher', 'teacher-1', 'teacher-2', 'stu-9')).toThrow(HttpError);
    try {
      resolveTargetStudent('teacher', 'teacher-1', 'teacher-2', 'stu-9');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).message).toBe('Sadece kendi etütlerinize öğrenci yazabilirsiniz');
    }
  });

  it('müdür → inputStudentId hedeflenir', () => {
    expect(resolveTargetStudent('director', 'dir-1', 'teacher-1', 'stu-9')).toBe('stu-9');
  });

  it('rehber → inputStudentId hedeflenir', () => {
    expect(resolveTargetStudent('counselor', 'c-1', 'teacher-1', 'stu-9')).toBe('stu-9');
  });

  it("müdür, studentId verilmemiş → 400 'Öğrenci belirtilmedi'", () => {
    try {
      resolveTargetStudent('director', 'dir-1', 'teacher-1', undefined);
      throw new Error('beklenen hata fırlatılmadı');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(400);
      expect((e as HttpError).message).toBe('Öğrenci belirtilmedi');
    }
  });

  it("tanınmayan rol (örn. veli) → 403 'Yetkisiz'", () => {
    try {
      resolveTargetStudent('parent', 'p-1', 'teacher-1', 'stu-9');
      throw new Error('beklenen hata fırlatılmadı');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).status).toBe(403);
      expect((e as HttpError).message).toBe('Yetkisiz');
    }
  });
});

// autoPickBranch — lib/etut/rezervasyon.ts reserveEtut satır 115-119 ile BİREBİR (spec §4a:
// öğretmen branşı ∩ öğrencinin DÜZEY havuzu — decideBooking'in kural 8'iyle aynı kaynak).
describe('autoPickBranch — tek-aday ders otomatiği', () => {
  it('branch açıkça verilmişse aynen döner (havuzda olmasa bile — doğrulama decideBooking’de)', () => {
    expect(autoPickBranch(['Matematik'], ['Fizik'], 'Kimya')).toBe('Kimya');
  });

  it('branch yok + tek aday (öğretmen branşı ∩ havuz) → o aday otomatik seçilir', () => {
    expect(autoPickBranch(['Matematik', 'Fizik'], ['Fizik'], undefined)).toBe('Fizik');
  });

  it('branch yok + hiç aday yok → undefined (decideBooking reddeder)', () => {
    expect(autoPickBranch(['Matematik'], ['Fizik'], undefined)).toBeUndefined();
  });

  it('branch yok + birden fazla aday → belirsiz, undefined (kullanıcı seçmeli)', () => {
    expect(autoPickBranch(['Matematik', 'Fizik'], ['Matematik', 'Fizik'], undefined)).toBeUndefined();
  });

  it('branch boş string (falsy) → otomatik seçime düşer, verilmemiş gibi davranılır', () => {
    expect(autoPickBranch(['Matematik'], ['Matematik'], '')).toBe('Matematik');
  });
});
