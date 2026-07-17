import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWithTimeout } from './http';

// Asla çözülmeyen ama abort'u dinleyen sahte fetch.
const hangingFetch = ((_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  })) as unknown as typeof fetch;

afterEach(() => vi.useRealTimers());

describe('fetchWithTimeout', () => {
  it('süre dolunca abort ile reddeder', async () => {
    vi.useFakeTimers();
    const p = fetchWithTimeout(hangingFetch, 'https://x.okulin.com/api', {}, 5000);
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
  });

  it('zamanında yanıt gelirse timer temizlenir ve yanıt döner', async () => {
    const ok = ((_u: unknown) => Promise.resolve(new Response('{}', { status: 200 }))) as unknown as typeof fetch;
    const r = await fetchWithTimeout(ok, 'https://x.okulin.com/api', {}, 5000);
    expect(r.status).toBe(200);
  });

  it('init alanlarını (method/headers/body) korur', async () => {
    let seen: RequestInit | undefined;
    const spy = ((_u: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response('{}', { status: 200 }));
    }) as unknown as typeof fetch;
    await fetchWithTimeout(spy, 'https://x.okulin.com/api', { method: 'POST', body: '{"a":1}' }, 5000);
    expect(seen?.method).toBe('POST');
    expect(seen?.body).toBe('{"a":1}');
    expect(seen?.signal).toBeDefined();
  });
});
