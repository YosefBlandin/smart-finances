/* eslint-disable import/no-restricted-paths -- T-ENR-21 drives the label use case over the memory adapters (the
   STAGE=test container); no production application code imports adapters. */
import { describe, expect, it } from 'vitest';
import { memoryContainer, type Container } from '@/adapters/container';
import { MemoryClock } from '@/adapters/memory/clock';
import type { MemoryDataApi } from '@/adapters/memory/data-api';
import type { MemoryLogger } from '@/adapters/memory/logger';
import type { DataApi } from '@/ports/data-api';
import { createLabel } from './label';

// T-ENR-20, T-ENR-21 (AC-6, AC-10; mercadopago-enrichment Components "Web screens", Logs): labeling a recipient for the
// signed-in person, and one log line per save with the outcome only, never the name. Synthetic people and names.

const WHO = { sub: 'label-person-sub', accessToken: 'label-person-token' };
const KEY = 'b'.repeat(32);
const NAME = 'Made-up Secret Landlord';
const REQ = { requestId: 'req-label' };

function setup(dataApi?: Partial<DataApi>) {
  const c: Container = memoryContainer(undefined, new MemoryClock(Date.UTC(2026, 10, 5, 12, 0, 0)));
  (c.dataApi as MemoryDataApi).allowToken(WHO.accessToken);
  if (dataApi) Object.assign(c.dataApi, dataApi);
  return { c, label: createLabel(c), events: () => (c.logger as MemoryLogger).events };
}

describe('T-ENR-20: labeling a recipient', () => {
  it('T-ENR-20: saves through the data API for the session person and logs the outcome', async () => {
    const s = setup();
    const saved = await s.label.label(WHO, { key: KEY, name: NAME, category: 'Housing & utilities' }, REQ);
    expect(saved).toMatchObject({ ok: true, data: { label: { recipient_key: KEY, name: NAME, category: 'Housing & utilities' } } });
    expect(s.events()).toEqual([{ name: 'recipient_label', outcome: 'saved', sub: WHO.sub, requestId: REQ.requestId }]);
  });
});

describe('T-ENR-21: a label save logs no name (AC-10)', () => {
  it('T-ENR-21: a refused save logs its code only; the name and the key are nowhere in the log', async () => {
    for (const answer of [
      { ok: false as const, kind: 'conflict' as const, code: 'conflict' },
      { ok: false as const, kind: 'failed' as const, code: 'timeout' },
      { ok: false as const, kind: 'not_found' as const, code: 'not_found' },
      { ok: false as const, kind: 'failed' as const, code: `<b>${NAME}</b>` }, // an odd code never reaches the log
    ]) {
      const s = setup({ putLabel: async () => answer });
      const saved = await s.label.label(WHO, { key: KEY, name: NAME, category: 'Housing & utilities' }, REQ);
      expect(saved.ok).toBe(false);
      const logged = JSON.stringify(s.events());
      expect(logged).not.toContain('Landlord');
      expect(logged).not.toContain(KEY);
      expect(s.events()).toEqual([
        { name: 'recipient_label', outcome: answer.code.startsWith('<') ? 'failed' : answer.code, sub: WHO.sub, requestId: REQ.requestId },
      ]);
    }
  });
});
