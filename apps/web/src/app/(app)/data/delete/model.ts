// The delete-account page's message keys that the server actions answer and the form tells apart (no 'use server' or
// 'use client', so both sides import it).
export const DELETE_REFUSALS = {
  /** The erase stopped the deletion; the person is still signed in and may finish it. */
  unfinished: 'auth.delete.unfinished',
  notStarted: 'auth.delete.notStarted',
} as const;
