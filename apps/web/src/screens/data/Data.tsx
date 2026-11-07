'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { dataKeys } from '@/queries/keys';
import { phaseAfter, type EraseAnswer, type ErasePhase } from './model';
import { DataView } from './View';

// The Your data island (SF-168; AC-7, D-131): the erase waits for the server's answer, with no optimistic update. The
// dialog asks for DELETE; the erase server action then answers the counts, a refusal, or "may be unfinished", for which
// Finish erasing calls the same action again. After an erase every cached money read is stale, so the other screens
// ask again when they open; the shell's to-review count follows on the next full load.

export type DataProps = { erase: (input: { confirm: 'DELETE' }) => Promise<EraseAnswer> };

export function Data({ erase }: DataProps) {
  const client = useQueryClient();
  const [phase, setPhase] = useState<ErasePhase>({ kind: 'idle' });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    let answer: EraseAnswer | 'threw';
    try {
      answer = await erase({ confirm: 'DELETE' });
    } catch {
      answer = 'threw';
    }
    setBusy(false);
    setAsking(false);
    setPhase(phaseAfter(answer));
    if (answer !== 'threw' && answer.ok) client.removeQueries({ queryKey: dataKeys.all });
  }

  return <DataView phase={phase} busy={busy} asking={asking} onAsk={setAsking} onErase={() => void run()} />;
}
