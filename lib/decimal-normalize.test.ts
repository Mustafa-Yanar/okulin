import { describe, it, expect } from 'vitest';
import { Prisma } from '@prisma/client';
import { decimalToNumberDeep } from './decimal-normalize';

const D = (s: string) => new Prisma.Decimal(s);

describe('decimalToNumberDeep', () => {
  it('düz Decimal → number', () => {
    expect(decimalToNumberDeep(D('1500.50'))).toBe(1500.5);
    expect(typeof decimalToNumberDeep(D('0'))).toBe('number');
  });

  it('nested obje + dizi (student→finance→installments şekli)', () => {
    const r = decimalToNumberDeep({
      id: 's1',
      finance: {
        totalFee: D('130000'), discount: D('10000'), netFee: D('120000.25'),
        installments: [
          { idx: 1, amount: D('10000'), paidAmount: D('10000') },
          { idx: 2, amount: D('10000'), paidAmount: null },
        ],
      },
    });
    expect(r.finance.netFee).toBe(120000.25);
    expect(r.finance.installments[0].paidAmount).toBe(10000);
    expect(r.finance.installments[1].paidAmount).toBeNull();
    expect(typeof r.finance.installments[1].amount).toBe('number');
  });

  it('Date/null/primitive/Json dokunulmaz', () => {
    const d = new Date('2026-07-23');
    const r = decimalToNumberDeep({ d, n: null, s: 'x', num: 5, j: { a: [1, 'b'] } });
    expect(r.d).toBe(d);
    expect(r.n).toBeNull();
    expect(r.s).toBe('x');
    expect(r.num).toBe(5);
    expect(r.j.a).toEqual([1, 'b']);
  });

  it('JSON.stringify sonucu number kalır (API sözleşmesi)', () => {
    const r = decimalToNumberDeep({ amount: D('43030') });
    expect(JSON.stringify(r)).toBe('{"amount":43030}');
  });

  it('aggregate/groupBy şekli (_sum) da dönüşür', () => {
    const r = decimalToNumberDeep({ _sum: { amount: D('63030.10') }, _count: 2 });
    expect(r._sum.amount).toBe(63030.1);
  });
});
