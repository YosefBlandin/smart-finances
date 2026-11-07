import { describe, expect, it } from 'vitest';
import { parseChallenge } from './PowField';

// T-WAUTH-6 (D-120, D-124): the proof-of-work route's reply is checked at the boundary, by hand so the forms carry no
// schema library (T-WEB-17 budget).
const HEX = 'a'.repeat(64);
const good = { salt: 's1', challenge: HEX, max: 100_000, expires: 1_800_000_000, sig: 'b'.repeat(64) };

describe('T-WAUTH-6: the challenge reply is checked before it is solved', () => {
  it('T-WAUTH-6: a well-formed reply passes unchanged', () => {
    expect(parseChallenge(good)).toEqual(good);
  });

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an empty salt', { ...good, salt: '' }],
    ['a salt over 64 characters', { ...good, salt: 's'.repeat(65) }],
    ['a challenge that is not 64 lowercase hex', { ...good, challenge: 'A'.repeat(64) }],
    ['a fractional max', { ...good, max: 1.5 }],
    ['a max over 10 million', { ...good, max: 10_000_001 }],
    ['a negative max', { ...good, max: -1 }],
    ['an expires that is not a number', { ...good, expires: '1' }],
    ['a short signature', { ...good, sig: 'b'.repeat(63) }],
  ])('T-WAUTH-6: %s is refused', (_name, value) => {
    expect(() => parseChallenge(value)).toThrow('invalid proof-of-work challenge');
  });
});
