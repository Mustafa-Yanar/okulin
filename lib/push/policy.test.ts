import { describe, it, expect } from 'vitest';
import { backoffMinutes, renderPush, applyResult, MAX_ATTEMPTS } from './policy';

describe('backoffMinutes', () => {
  it('artan gecikme verir, sınırda null (dead) döner', () => {
    expect(backoffMinutes(1)).toBe(5);
    expect(backoffMinutes(2)).toBe(30);
    expect(backoffMinutes(3)).toBe(120);
    expect(backoffMinutes(4)).toBe(720);
    expect(backoffMinutes(MAX_ATTEMPTS)).toBeNull();
    expect(backoffMinutes(99)).toBeNull();
  });
});

describe('renderPush', () => {
  it('hassas içerikte jenerik metin döner (kilit ekranı mahremiyeti)', () => {
    const out = renderPush({ title: 'Devamsızlık Bildirimi', body: 'Ali Yılmaz bugün derse katılmadı.', sensitive: true });
    expect(out.title).toBe('Yeni bildiriminiz var');
    expect(out.body).toBe('Detayları görmek için okulin uygulamasını açın.');
    expect(out.body).not.toContain('Ali');
  });
  it('normal içeriği aynen geçirir', () => {
    const out = renderPush({ title: 'Duyuru', body: 'Yarın etüt var.' });
    expect(out).toEqual({ title: 'Duyuru', body: 'Yarın etüt var.' });
  });
});

describe('applyResult', () => {
  const now = new Date('2026-07-14T12:00:00Z');
  it('başarı → sent', () => {
    expect(applyResult(1, { ok: true, permanent: false }, now)).toEqual({ status: 'sent' });
  });
  it('kalıcı hata → dead (retry yok)', () => {
    expect(applyResult(1, { ok: false, permanent: true }, now)).toEqual({ status: 'dead' });
  });
  it('geçici hata → pending + backoff kadar ileri nextAttemptAt', () => {
    const r = applyResult(1, { ok: false, permanent: false }, now);
    expect(r.status).toBe('pending');
    expect(r.nextAttemptAt!.getTime()).toBe(now.getTime() + 5 * 60_000);
  });
  it('deneme sınırı aşılınca → dead', () => {
    expect(applyResult(MAX_ATTEMPTS, { ok: false, permanent: false }, now)).toEqual({ status: 'dead' });
  });
});
