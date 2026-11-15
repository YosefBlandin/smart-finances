import { describe, expect, it } from 'vitest';
import en from '../../../messages/en.json';
import es from '../../../messages/es.json';

// T-MSG-1 (category-suggestions AC-19): the suggestion words exist in English and Spanish with the same arguments and
// plural forms, exactly as architecture.md Contracts "Messages" gives them, and the category names the review list can
// offer all have a Spanish name.

const SUGGEST = {
  accept: ['Accept {category}', 'Aceptar {category}'],
  use: ['Use {category}', 'Usar {category}'],
  acceptAll: [
    '{n, plural, one {Accept all (# suggestion)} other {Accept all (# suggestions)}}',
    '{n, plural, one {Aceptar todo (# sugerencia)} other {Aceptar todo (# sugerencias)}}',
  ],
  confirmTitle: ['Save these suggestions and approve the rows?', '¿Guardar estas sugerencias y aprobar los movimientos?'],
  confirmLine: ['{n, plural, one {# as {category}} other {# as {category}}}', '{n, plural, one {# como {category}} other {# como {category}}}'],
  save: ['Save and approve', 'Guardar y aprobar'],
  cancel: ['Cancel', 'Cancelar'],
  saving: ['{n, plural, one {Saving # row…} other {Saving # rows…}}', '{n, plural, one {Guardando # movimiento…} other {Guardando # movimientos…}}'],
  waiting: [
    '{s, plural, one {Too many saves at once. Trying again in # second…} other {Too many saves at once. Trying again in # seconds…}}',
    '{s, plural, one {Demasiados cambios a la vez. Reintentando en # segundo…} other {Demasiados cambios a la vez. Reintentando en # segundos…}}',
  ],
  someFailed: [
    "{n, plural, one {# row didn't save. It's back on the list.} other {# rows didn't save. They're back on the list.}}",
    '{n, plural, one {# movimiento no se guardó. Volvió a la lista.} other {# movimientos no se guardaron. Volvieron a la lista.}}',
  ],
  keys: [
    'Enter accepts the suggestion, 1 to 3 pick one, the arrow keys move between rows.',
    'Enter acepta la sugerencia, 1 a 3 eligen una, las flechas pasan de un movimiento a otro.',
  ],
} as const;

const CATEGORY_NAMES = {
  shopping: ['Shopping', 'Compras'],
  pets: ['Pets', 'Mascotas'],
  interest: ['Interest', 'Intereses'],
  refunds: ['Refunds', 'Reembolsos'],
  loans: ['Loans', 'Préstamos'],
} as const;

/** The {arguments} and plural forms of an ICU message, ignoring the words. */
const shape = (message: string) => ({
  args: [...message.matchAll(/\{(\w+)(?:,|\})/g)].map((m) => m[1]).sort(),
  forms: [...message.matchAll(/\b(one|other|=\d+) \{/g)].map((m) => m[1]),
});

describe('T-MSG-1: suggestion messages', () => {
  const enSuggest = (en.review as Record<string, unknown>).suggest as Record<string, string> | undefined;
  const esSuggest = (es.review as Record<string, unknown>).suggest as Record<string, string> | undefined;

  it('T-MSG-1 every review.suggest key exists in en and es with the contract text', () => {
    expect(Object.keys(enSuggest ?? {}).sort()).toEqual(Object.keys(SUGGEST).sort());
    expect(Object.keys(esSuggest ?? {}).sort()).toEqual(Object.keys(SUGGEST).sort());
    for (const [key, [english, spanish]] of Object.entries(SUGGEST)) {
      expect(enSuggest?.[key], key).toBe(english);
      expect(esSuggest?.[key], key).toBe(spanish);
    }
  });

  it('T-MSG-1 English and Spanish use the same arguments and plural forms', () => {
    for (const key of Object.keys(SUGGEST)) expect(shape(esSuggest?.[key] ?? ''), key).toEqual(shape(enSuggest?.[key] ?? ''));
  });

  it('T-MSG-1 Shopping, Pets, Interest, Refunds and Loans have names in both languages', () => {
    for (const [key, [english, spanish]] of Object.entries(CATEGORY_NAMES)) {
      expect((en.categories as Record<string, string>)[key], key).toBe(english);
      expect((es.categories as Record<string, string>)[key], key).toBe(spanish);
    }
  });
});
