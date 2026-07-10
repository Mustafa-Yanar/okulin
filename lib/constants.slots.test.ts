import { describe, it, expect } from 'vitest';
import { slotId, slotIdsForDay, migrateSlotId, daySlots, DEFAULT_SLOTS_PER_DAY } from './constants';

describe('7-gün slot modeli', () => {
  it('slotId güne özgü id üretir', () => {
    expect(slotId(0, 1)).toBe('d0s1');
    expect(slotId(5, 3)).toBe('d5s3');
    expect(slotId(6, 12)).toBe('d6s12');
  });

  it('slotIdsForDay count kadar id üretir', () => {
    expect(slotIdsForDay(0, 6)).toEqual(['d0s1', 'd0s2', 'd0s3', 'd0s4', 'd0s5', 'd0s6']);
    expect(slotIdsForDay(2, 3)).toEqual(['d2s1', 'd2s2', 'd2s3']);
    expect(slotIdsForDay(1)).toHaveLength(DEFAULT_SLOTS_PER_DAY); // varsayılan
  });

  it('migrateSlotId eski w/e id → yeni id (dayIndex ile)', () => {
    expect(migrateSlotId('w1', 0)).toBe('d0s1');   // Pzt 1. slot
    expect(migrateSlotId('w6', 2)).toBe('d2s6');    // Çar 6. slot
    expect(migrateSlotId('e3', 5)).toBe('d5s3');    // Cmt 3. slot
    expect(migrateSlotId('e12', 6)).toBe('d6s12');  // Paz 12. slot
    expect(migrateSlotId('d0s1', 0)).toBe('d0s1');  // zaten yeni → dokunma
    expect(migrateSlotId('bogus', 0)).toBe('bogus'); // bilinmeyen → dokunma
  });

  it('daySlots count + times ile slot listesi üretir', () => {
    const cfg = { count: 3, times: [{ start: '09:00', end: '09:40' }, { start: '09:50', end: '10:30' }, { start: '10:40', end: '11:20' }] };
    const slots = daySlots(0, cfg);
    expect(slots).toHaveLength(3);
    expect(slots[0]).toMatchObject({ id: 'd0s1', start: '09:00', end: '09:40' });
    expect(slots[2].id).toBe('d0s3');
  });

  it('daySlots eksik config → varsayılan sayı, boş saatler', () => {
    const slots = daySlots(4, undefined);
    expect(slots).toHaveLength(DEFAULT_SLOTS_PER_DAY);
    expect(slots[0].id).toBe('d4s1');
  });

  it('daySlots times count\'tan kısaysa kalan slotlar 00:00 ile dolar', () => {
    const cfg = { count: 3, times: [{ start: '09:00', end: '09:40' }] };
    const slots = daySlots(1, cfg);
    expect(slots).toHaveLength(3);
    expect(slots[1].start).toBe('00:00'); // makeSlots doldurması
  });
});
