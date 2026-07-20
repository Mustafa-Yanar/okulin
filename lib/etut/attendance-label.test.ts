import { describe, it, expect } from 'vitest';
import { pickEtutLabel } from './attendance-label';

describe('pickEtutLabel', () => {
  it('rezervasyon varsa branch + snapshot saati (şablon saatinden farklıysa bile rezervasyon anı kazanır)', () => {
    expect(pickEtutLabel({
      sablon: { legacyId: 'e1', start: '15:00', end: '16:00' },
      reservation: { dersBranch: 'Fizik', startsAt: '14:00', endsAt: '15:00' },
    })).toEqual({ branch: 'Fizik', slotLabel: '14:00–15:00' });
  });
  it('rezervasyon yoksa şablon saati, branch boş', () => {
    expect(pickEtutLabel({ sablon: { legacyId: 'e1', start: '15:00', end: '16:00' }, reservation: null }))
      .toEqual({ branch: '', slotLabel: '15:00–16:00' });
  });
  it('ikisi de yoksa boş etiket', () => {
    expect(pickEtutLabel({ sablon: null, reservation: null })).toEqual({ branch: '', slotLabel: '' });
  });
  it('rezervasyon var ama şablon silinmiş/yok → yine rezervasyon etiketi', () => {
    expect(pickEtutLabel({ sablon: null, reservation: { dersBranch: 'TYT Matematik', startsAt: '10:00', endsAt: '11:00' } }))
      .toEqual({ branch: 'TYT Matematik', slotLabel: '10:00–11:00' });
  });
});
