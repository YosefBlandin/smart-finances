// Categories for Mercado Pago purchases (mercadopago-enrichment D-15). The rules moved to the shared contracts package
// so the importer and the browser's category suggestions use one copy (category-suggestions D-15); this module
// re-exports them unchanged, so the importer and its tests keep their import path.
export { CODE_CATEGORIES, NAME_RULES, merchantCategory } from '@smart-finances/contracts/rules';
