import { describe, it, expect, vi } from 'vitest';

// tenant.js modül yüklenirken redis (env ister) + next/headers import eder; testte mock'la.
vi.mock('./redis', () => ({ default: {} }));
vi.mock('next/headers', () => ({ headers: () => ({ get: () => null }) }));

import { _scopedClient, prefixFor } from './tenant.js';
import { orgFromHost, resolveOrg } from './org.js';

const PREFIX = 't:cozum:main:';

// Çağrıları kaydeden sahte Upstash client.
function fakeClient(overrides = {}) {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); return overrides[name]?.(...args); };
  return {
    calls,
    get: rec('get'), set: rec('set'), del: rec('del'), exists: rec('exists'),
    incr: rec('incr'), expire: rec('expire'), sadd: rec('sadd'), srem: rec('srem'),
    smembers: rec('smembers'), scard: rec('scard'),
    keys: (...a) => { calls.push(['keys', ...a]); return (overrides.keys || (async () => []))(...a); },
    scan: (...a) => { calls.push(['scan', ...a]); return (overrides.scan || (async () => ['0', []]))(...a); },
    pipeline: overrides.pipeline,
  };
}

describe('orgFromHost / resolveOrg', () => {
  it('APP_DOMAIN yokken her host null → resolveOrg DEFAULT_ORG', () => {
    // APP_DOMAIN test ortamında tanımsız (boş) → null bekleriz
    expect(orgFromHost('cozum.okulin.com')).toBeNull();
    expect(resolveOrg('cozumetut.vercel.app')).toBe('cozum'); // DEFAULT_ORG
  });
});

describe('_scopedClient — anahtar prefix', () => {
  it('get/set/del/exists/incr anahtarı prefix\'ler', () => {
    const c = fakeClient();
    const r = _scopedClient(c, PREFIX);
    r.get('teacher:x');
    r.set('student:y', { a: 1 }, { ex: 10 });
    r.del('a', 'b');
    r.exists('director');
    r.incr('receipt_counter');
    expect(c.calls).toEqual([
      ['get', PREFIX + 'teacher:x'],
      ['set', PREFIX + 'student:y', { a: 1 }, { ex: 10 }],
      ['del', PREFIX + 'a', PREFIX + 'b'],
      ['exists', PREFIX + 'director'],
      ['incr', PREFIX + 'receipt_counter'],
    ]);
  });

  it('set kombinasyonu (sadd/srem/smembers)', () => {
    const c = fakeClient();
    const r = _scopedClient(c, PREFIX);
    r.sadd('teachers', 'id1');
    r.srem('teachers', 'id1');
    r.smembers('teachers');
    expect(c.calls).toEqual([
      ['sadd', PREFIX + 'teachers', 'id1'],
      ['srem', PREFIX + 'teachers', 'id1'],
      ['smembers', PREFIX + 'teachers'],
    ]);
  });
});

describe('_scopedClient — keys/scan prefix + strip', () => {
  it('keys deseni prefix\'ler, dönüşte soyar', async () => {
    const c = fakeClient({ keys: async () => [PREFIX + 'audit:1', PREFIX + 'audit:2'] });
    const r = _scopedClient(c, PREFIX);
    const out = await r.keys('audit:*');
    expect(c.calls.find(x => x[0] === 'keys')).toEqual(['keys', PREFIX + 'audit:*']);
    expect(out).toEqual(['audit:1', 'audit:2']); // prefix soyuldu
  });

  it('scan match\'i prefix\'ler, bulunan anahtarları soyar', async () => {
    const c = fakeClient({ scan: async () => ['0', [PREFIX + 'guidance:s1:w1']] });
    const r = _scopedClient(c, PREFIX);
    const [next, found] = await r.scan('0', { match: 'guidance:s1:*', count: 100 });
    const scanCall = c.calls.find(x => x[0] === 'scan');
    expect(scanCall[2].match).toBe(PREFIX + 'guidance:s1:*');
    expect(next).toBe('0');
    expect(found).toEqual(['guidance:s1:w1']); // soyuldu → çağıran eski formatı görür
  });
});

describe('_scopedClient — pipeline', () => {
  it('pipeline get/set/del anahtarları prefix\'ler, exec geçirir', async () => {
    const pcalls = [];
    const fakePipe = {
      get: (...a) => pcalls.push(['get', ...a]),
      set: (...a) => pcalls.push(['set', ...a]),
      del: (...a) => pcalls.push(['del', ...a]),
      exec: async () => ['RESULT'],
    };
    const c = fakeClient({ pipeline: () => fakePipe });
    const r = _scopedClient(c, PREFIX);
    const p = r.pipeline();
    p.get('teacher:1');
    p.set('teacher:1', { x: 1 });
    p.del('teacher:1');
    const res = await p.exec();
    expect(pcalls).toEqual([
      ['get', PREFIX + 'teacher:1'],
      ['set', PREFIX + 'teacher:1', { x: 1 }],
      ['del', PREFIX + 'teacher:1'],
    ]);
    expect(res).toEqual(['RESULT']);
  });
});

describe('prefixFor', () => {
  it('org → t:<org>:main:', () => {
    expect(prefixFor('cozum')).toBe('t:cozum:main:');
    expect(prefixFor('kursb')).toBe('t:kursb:main:');
  });
});
