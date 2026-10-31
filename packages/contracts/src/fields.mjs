// The columns of the one transaction table every importer writes into, and the kinds a row can have.
// Browser-safe: no Node imports, so the web app can use it too (D-133).

export const FIELDS = [
  'id', // stable hash of the source identity, so re-importing never double-counts
  'date', // YYYY-MM-DD; for month-precision rows it is the 1st of the month
  'date_precision', // 'day' | 'month'
  'kind', // see KINDS
  'amount', // signed, money out is negative
  'currency', // ISO code as recorded at the source (ARS, USD)
  'category',
  'merchant', // cleaned name when the source has one, else empty
  'description_raw', // source text, kept for audit
  'source', // 'mercadopago' | 'notion'
  'source_ref', // where in the source the row came from
  'country', // where the money was spent (VE, AR)
  'flags', // '|'-separated notes for review, e.g. bcv_rate, summed, needs_review
  'import_batch', // hash of the source file, so one bad import can be rolled back
];

// Only `expense` counts as spending and only `income` as earnings. The rest move money
// between pockets or people and are kept so balances still add up.
export const KINDS = ['expense', 'income', 'inflow', 'refund', 'interest', 'transfer_out', 'loan_out'];
