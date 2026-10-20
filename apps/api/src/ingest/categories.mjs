// Rules for the short labels in the Notion log (and later the Excel budgets). First match
// wins, so the narrow rules sit above the broad ones. Anything unmatched is 'Uncategorized'
// for the assistant to fill in later.
const RULES = [
  [/girl/, 'Partner'],
  [/^food out$|^delivery$/, 'Dining out'],
  [/^food$|^food articles$|^food and care$|^fruits$|^sweeties$|^desserts$/, 'Groceries'],
  [/uber|taxi|ridery/, 'Transport'],
  [/^rent|^services$|electricity|^house$|^phone$/, 'Housing & utilities'],
  [/medic|pharmacy|farmatodo|health|exam|supplements|gym/, 'Health & fitness'],
  [/personal items|nails|hair|skincare|shampoo|pedicure|^care$/, 'Personal care'],
  [/chatgpt|cursor|microsoft|capcut|hbo|disney|upwork|chess/, 'Subscriptions & software'],
  [/iphone|camera|psu|sata|pendrive|macintosh/, 'Electronics'],
  [/articles|items|lamps|chair|bed|pillows|air fryer|blender|light panel|fans|tools|home|clean/, 'Home'],
  [/clothes|sun glasses/, 'Clothing'],
  [/suitcases|tickets/, 'Travel'],
  [/mother/, 'Family'],
  [/gift/, 'Gifts'],
  [/^debt$/, 'Debt payments'],
  [/management|requeriments|changing usd to bs/, 'Fees & admin'],
  [/^cash$/, 'Cash'],
];

export function categoryFor(label) {
  const l = label.trim().toLowerCase();
  for (const [re, category] of RULES) if (re.test(l)) return category;
  return 'Uncategorized';
}
