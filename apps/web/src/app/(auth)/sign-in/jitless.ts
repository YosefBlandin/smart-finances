import { z } from 'zod';

// Zod's object schemas probe for eval with new Function("") when they are built, which the content policy (no
// 'unsafe-eval', D-151) blocks and reports as a script-src violation. PowField builds its challenge schema when its module
// loads, so the forms import this module first: jitless mode skips the probe (parsing is the same, only not compiled).
z.config({ jitless: true });
