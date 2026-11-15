// Categories for Mercado Pago purchases from the enrichment columns sync adds (D-15): the payments service's
// four-digit category code first, then the merchant name, else null so the importer falls back to its own rule.
// Kept apart from the Notion label rules (apps/api/src/ingest/categories.mjs), which are tuned for short labels.
// Public shops, apps and services only, never a person. The owner tunes both lists (RK-3).
import { CATEGORIES } from '@smart-finances/contracts/categories';

// Merchant category codes (ISO 18245) to categories, as four-digit text.
const codes = (category, list) => list.map((code) => [code, category]);
export const CODE_CATEGORIES = Object.fromEntries([
  ...codes('Groceries', ['5411', '5422', '5441', '5451', '5462', '5499']),
  ...codes('Dining out', ['5811', '5812', '5813', '5814']),
  ...codes('Transport', ['4111', '4121', '4131', '4784', '5541', '5542', '7523']),
  ...codes('Housing & utilities', ['4814', '4900']),
  ...codes('Health & fitness', ['5912', '7997', '8011', '8021', '8042', '8062', '8071', '8099']),
  ...codes('Personal care', ['5977', '7230', '7298']),
  ...codes('Subscriptions & software', ['4816', '4899', '5734', '5815', '5816', '5817', '5818', '7372']),
  ...codes('Electronics', ['5045', '5732']),
  ...codes('Home', ['5200', '5211', '5251', '5712', '5719', '5722']),
  ...codes('Clothing', ['5611', '5621', '5651', '5661', '5691', '5699']),
  ...codes('Travel', ['3000', '4411', '4511', '4722', '7011']),
  ...codes('Gifts', ['5947', '5992']),
  ...codes('Pets', ['0742', '5995']),
  ...codes('Cash', ['6010', '6011']),
  ...codes('Fees & admin', ['9311', '9399']),
  ...codes('Shopping', ['5311', '5399', '5999']),
]);

// Merchant name patterns, matched on whole words of the lower-cased name. First match wins.
const word = (alternatives) => new RegExp(`(?:^|[^a-z0-9])(?:${alternatives})(?:$|[^a-z0-9])`);
export const NAME_RULES = [
  [word('coto|carrefour|jumbo|disco|changomas|chango mas|la anonima|supermercado|vea'), 'Groceries'],
  [word('mcdonald\'?s|burger king|starbucks|mostaza|pedidos ?ya|rappi|havanna|cafe martinez'), 'Dining out'],
  [word('uber|cabify|didi|ypf|shell|axion|sube|trenes argentinos|subte'), 'Transport'],
  [word('edenor|edesur|metrogas|naturgy|aysa|personal flow|claro|movistar|telecentro|fibertel'), 'Housing & utilities'],
  [word('farmacity|farmacia|smart ?fit|megatlon|osde|swiss medical'), 'Health & fitness'],
  [word('netflix|spotify|disney|hbo|youtube|google|apple\\.com|openai|chatgpt|microsoft|adobe|paramount|crunchyroll|steam'), 'Subscriptions & software'],
  [word('fravega|garbarino|musimundo|compumundo'), 'Electronics'],
  [word('sodimac|easy|blaisten'), 'Home'],
  [word('zara|h&m|nike|adidas|dafiti'), 'Clothing'],
  [word('aerolineas argentinas|flybondi|jetsmart|latam|airbnb|booking\\.com|despegar'), 'Travel'],
  [word('puppis'), 'Pets'],
  [word('mercado ?libre|amazon|aliexpress|shein|temu'), 'Shopping'],
];

/**
 * The category for a purchase from its category code and merchant name, or null when neither is known.
 * code: four digits as text, or empty. merchant: the cleaned name, or empty.
 */
export function merchantCategory({ code, merchant } = {}) {
  const c = String(code ?? '').trim();
  if (/^\d{4}$/.test(c) && CODE_CATEGORIES[c]) return CODE_CATEGORIES[c];
  const name = String(merchant ?? '').toLowerCase();
  if (!name) return null;
  for (const [re, category] of NAME_RULES) if (re.test(name)) return category;
  return null;
}

// A mapping to a category the shared list lacks would reach the web app as an unknown label.
for (const category of [...Object.values(CODE_CATEGORIES), ...NAME_RULES.map(([, c]) => c)]) {
  if (!CATEGORIES.includes(category) || category === 'Uncategorized') throw new Error(`merchants.mjs maps to an unknown category: ${category}`);
}
