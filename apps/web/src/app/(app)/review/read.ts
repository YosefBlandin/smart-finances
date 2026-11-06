import { cache } from 'react';
import { getContainer } from '@/adapters/container';
import { createDataReads } from '@/application/data/reads';

// The rows to review, read once per server render (React cache): the shell's to-review count (D-44), the overview's
// waiting line and the review screen share this one read, so a first view of the overview stays at five data reads and
// the review screen at one (owner note, 2026-11-05: the count shares the overview's review read). Keyed by the access
// token, so one request never sees another person's answer.
export const readReview = cache((accessToken: string) => createDataReads(getContainer()).getReview({ accessToken }));
