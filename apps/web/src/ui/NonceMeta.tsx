'use client';

import { useState } from 'react';

// React Aria adds small <style> elements in the browser (press and scroll handling) and stamps them with the nonce of the
// csp-nonce meta, so the content policy's style-src (no 'unsafe-inline') lets them through. The page keeps the policy,
// and so the nonce, of its first load; a server-action redirect re-renders the root layout with a new request's nonce.
// This keeps the first one, so a style added after such a redirect still carries the nonce the page allows (SF-155).
export function NonceMeta({ nonce }: { nonce?: string }) {
  const [first] = useState(nonce);
  return first ? <meta name="csp-nonce" nonce={first} /> : null;
}
