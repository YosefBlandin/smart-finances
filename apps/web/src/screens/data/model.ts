// Your data's plain logic (SF-168; AC-7): the messages the erase server action answers with, and the states of the erase
// section. No 'use client': the server action words its refusals with ERASE_MESSAGES too.

/** The erase action's refusals; only `unfinished` offers Finish erasing (the same action again). */
export const ERASE_MESSAGES = {
  unfinished: 'data.eraseUnfinished',
  running: 'data.eraseRunning',
  failed: 'data.eraseFailed',
} as const;

export type Erased = { items: number; files: number };

/** What the erase section shows: the offer, the counts erased, the unfinished note, or a plain refusal. */
export type ErasePhase = { kind: 'idle' } | { kind: 'done'; erased: Erased } | { kind: 'unfinished' } | { kind: 'refused'; messageKey: string };

export type EraseAnswer = { ok: true; data: Erased } | { ok: false; messageKey: string };

/** The section's state after the action answers (a thrown action reads as unfinished: it may have reached the API). */
export function phaseAfter(answer: EraseAnswer | 'threw'): ErasePhase {
  if (answer === 'threw') return { kind: 'unfinished' };
  if (answer.ok) return { kind: 'done', erased: answer.data };
  if (answer.messageKey === ERASE_MESSAGES.unfinished) return { kind: 'unfinished' };
  return { kind: 'refused', messageKey: answer.messageKey };
}
