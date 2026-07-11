import { describe, it, expect } from 'vitest';
import { parseBody, zName, zPassword, zNewPassword, zId, zMoney, zStringArray, z } from './validate';

// Sahte Request — .json() davranışını taklit eder (test sınırı: cast kaçınılmaz).
const reqOf = (body: unknown) => ({ json: async () => body }) as unknown as Request;
const reqThrows = () => ({ json: async () => { throw new SyntaxError('bad json'); } }) as unknown as Request;

describe('parseBody', () => {
  const Schema = z.object({ name: zName, fee: zMoney });

  it('geçerli gövdeyi parse eder', async () => {
    const r = await parseBody(reqOf({ name: 'Ali', fee: '1500' }), Schema);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ name: 'Ali', fee: 1500 }); // fee coerce edildi
  });

  it('bozuk JSON → 400 (500 değil)', async () => {
    const r = await parseBody(reqThrows(), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });

  it('şema ihlali → 400', async () => {
    const r = await parseBody(reqOf({ name: 123, fee: 10 }), Schema);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(400);
  });
});

describe('zName (tip karışıklığı koruması)', () => {
  it('string kabul, object/array/sayı red', () => {
    expect(zName.safeParse('Mustafa YANAR').success).toBe(true);
    expect(zName.safeParse('').success).toBe(false);
    expect(zName.safeParse({}).success).toBe(false);       // prototype pollution vektörü
    expect(zName.safeParse(['x']).success).toBe(false);
    expect(zName.safeParse(42).success).toBe(false);
    expect(zName.safeParse('x'.repeat(201)).success).toBe(false); // 200 üstü red
  });
});

describe('zPassword / zNewPassword', () => {
  it('zPassword boş olmayan string', () => {
    expect(zPassword.safeParse('a').success).toBe(true);
    expect(zPassword.safeParse('').success).toBe(false);
  });
  it('zNewPassword en az 6 karakter (sunucu kuralı)', () => {
    expect(zNewPassword.safeParse('12345').success).toBe(false);
    expect(zNewPassword.safeParse('123456').success).toBe(true);
  });
});

describe('zId', () => {
  it('kısa string token kabul, boş/non-string red', () => {
    expect(zId.safeParse('zjyov8wy').success).toBe(true);
    expect(zId.safeParse('m1').success).toBe(true);          // legacyId
    expect(zId.safeParse('oid-2026:abc_12').success).toBe(true); // payment oid / composite
    expect(zId.safeParse('').success).toBe(false);
    expect(zId.safeParse(123).success).toBe(false);
    expect(zId.safeParse('a b').success).toBe(false);        // boşluk red
    expect(zId.safeParse('<script>').success).toBe(false);   // açı parantezi red
  });
});

describe('zMoney', () => {
  it('string→number coerce, negatif/object/aşırı red', () => {
    expect(zMoney.safeParse('1500').success).toBe(true);
    expect(zMoney.parse('1500')).toBe(1500);
    expect(zMoney.safeParse(0).success).toBe(true);
    expect(zMoney.safeParse(-5).success).toBe(false);
    expect(zMoney.safeParse({}).success).toBe(false);
    expect(zMoney.safeParse(1e9).success).toBe(false); // 100M üstü
  });
});

describe('zStringArray', () => {
  it('string dizi kabul, non-string eleman red', () => {
    expect(zStringArray.safeParse(['Matematik', 'Fizik']).success).toBe(true);
    expect(zStringArray.safeParse([]).success).toBe(true);
    expect(zStringArray.safeParse(['ok', 5]).success).toBe(false);
    expect(zStringArray.safeParse('Matematik').success).toBe(false); // dizi değil
  });
});
