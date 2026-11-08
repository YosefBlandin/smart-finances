// Every category the importers' rules can assign, in rule order, then the fallback. The rules
// themselves stay with the importer (apps/api/src/ingest/categories.mjs); this is the list the
// web app shows and the review route accepts.
export const CATEGORIES = [
  'Partner',
  'Dining out',
  'Groceries',
  'Transport',
  'Housing & utilities',
  'Health & fitness',
  'Personal care',
  'Subscriptions & software',
  'Electronics',
  'Home',
  'Clothing',
  'Travel',
  'Family',
  'Gifts',
  'Debt payments',
  'Fees & admin',
  'Cash',
  // Set by the importers themselves rather than by a rule (D-44).
  'Shopping',
  'Pets',
  'Income',
  'Interest',
  'Refunds',
  'Loans',
  'Transfers',
  'Uncategorized',
];
