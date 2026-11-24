// Groups a quote's line items into one table per CyberFOX product, AutoElevate first.
// Plain JavaScript (no React) so the root test suite can exercise it directly.
//
// HubSpot's quoteTemplateContext only carries standard line item properties, so the product is
// read from the line's name and SKU. That covers Quote Builder lines and lines added by hand.
// To add a product: add a row here, with the label printed above its table.

/** @typedef {{ key: string, label: string, match: RegExp }} ProductGroup */

/** Table order on the quote. AutoElevate is the first table. */
export const PRODUCT_GROUPS = [
  { key: 'autoelevate', label: 'AutoElevate', match: /autoelevate|(^|[^a-z])ae([^a-z]|$)/i },
  { key: 'password', label: 'Password Manager', match: /password|(^|[^a-z])pb([^a-z0-9]|\d|$)/i },
  { key: 'dns', label: 'DNS Filtering', match: /dns/i },
  { key: 'timus', label: 'Timus SASE', match: /timus|satgat/i },
  { key: 'optimize365', label: 'Optimize365', match: /optimi[sz]e\s*365|optimize|(^|[^a-z])tdr([^a-z]|$)/i },
];

/** Lines that match no product go in a last table. */
export const OTHER_GROUP = { key: 'other', label: 'Other' };

// Most specific first: the AutoElevate pattern ("-AE-") is the loosest, so it is tried last.
const MATCH_ORDER = ['timus', 'optimize365', 'dns', 'password', 'autoelevate'];

/** Which product a line item belongs to (its group key). */
export function productKeyFor(item) {
  const text = `${(item && item.name) || ''} ${(item && item.hs_sku) || ''}`.replace(/\bRAMP\s*\d*\s+/gi, '');
  for (const key of MATCH_ORDER) {
    const group = PRODUCT_GROUPS.find((g) => g.key === key);
    if (group && group.match.test(text)) return key;
  }
  return OTHER_GROUP.key;
}

/**
 * [{ key, label, items }] for the products on the quote, in PRODUCT_GROUPS order (then Other).
 * Products with no lines are left out, so their tables don't appear.
 * @param {Array<Record<string, any>>} lineItems
 * @param {Record<string, string>} [labels] optional heading overrides by key
 */
export function groupLineItems(lineItems, labels = {}) {
  const sorted = (lineItems || []).slice().sort((a, b) => (Number(a.hs_position_on_quote) || 0) - (Number(b.hs_position_on_quote) || 0));
  const groups = PRODUCT_GROUPS.concat([OTHER_GROUP]).map((g) => ({ key: g.key, label: (labels[g.key] || '').trim() || g.label, items: [] }));
  for (const item of sorted) {
    const key = productKeyFor(item);
    groups.find((g) => g.key === key).items.push(item);
  }
  return groups.filter((g) => g.items.length > 0);
}

// ---------------------------------------------------------------------------
// Co-term quotes (Nov 2026)
//
// The Quote Builder tags each line item with qb_line_type: New, Upsell, coterm or Downgrade (custom
// properties are in quoteTemplateContext.lineItems). A co-term line is a product the customer already
// has, added only so its term lines up with the new products. On a quote with co-term lines, the new
// products print first under "Your new subscriptions", then the co-term lines under "Your current
// subscriptions" (same level, no indent). Quotes without co-term lines are unchanged.

/** True for a co-term line (qb_line_type = coterm, any case; "co-term" also accepted). */
export function isCotermLine(item) {
  return String((item && item.qb_line_type) || '').trim().toLowerCase().replace(/[^a-z]/g, '') === 'coterm';
}

/**
 * The quote's layout: { coterm, newGroups, existingGroups }. coterm is true when any line is a co-term
 * line; then newGroups holds the other lines and existingGroups the co-term lines. On a normal quote
 * newGroups holds every line and existingGroups is empty. Each list is groupLineItems() output (one
 * table per product, AutoElevate first).
 * @param {Array<Record<string, any>>} lineItems
 * @param {Record<string, string>} [labels]
 */
export function quoteLayout(lineItems, labels = {}) {
  const items = lineItems || [];
  const existing = items.filter(isCotermLine);
  if (!existing.length) return { coterm: false, newGroups: groupLineItems(items, labels), existingGroups: [] };
  return {
    coterm: true,
    newGroups: groupLineItems(items.filter((i) => !isCotermLine(i)), labels),
    existingGroups: groupLineItems(existing, labels),
  };
}

/** Default wording for the co-term sections (editable in the module's settings). No note by default. */
export const COTERM_TEXT = {
  newHeading: 'Your new subscriptions',
  existingHeading: 'Your current subscriptions',
  existingNote: '',
};

// ---------------------------------------------------------------------------
// Cell formatting

export function money(value, currency = 'USD') {
  const n = Number(value) || 0;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

/** "12 months", "Month-to-month", "One-time". */
export function termText(item) {
  if (!item.recurringbillingfrequency || item.recurringbillingfrequency === 'one_time') return 'One-time';
  if (item.hs_recurring_billing_terms === 'AUTOMATICALLY_RENEW') return 'Month-to-month';
  const m = String(item.hs_recurring_billing_period || '').match(/^P(\d+)M$/i);
  if (m) return `${Number(m[1])} month${Number(m[1]) === 1 ? '' : 's'}`;
  const y = String(item.hs_recurring_billing_period || '').match(/^P(\d+)Y$/i);
  if (y) return `${Number(y[1])} year${Number(y[1]) === 1 ? '' : 's'}`;
  if (item.hs_term_in_months) return `${Number(item.hs_term_in_months)} months`;
  return '';
}

/** "10%", "$25.00", or blank when there's no discount (like HubSpot's own table). */
export function discountText(item, currency) {
  const pct = Number(item.hs_discount_percentage) || 0;
  if (pct > 0) return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
  const amount = Number(item.discount) || 0;
  return amount > 0 ? money(amount, currency) : '';
}

const PER = { weekly: 'week', biweekly: '2 weeks', monthly: 'month', quarterly: 'quarter', per_six_months: '6 months', annually: 'year', per_two_years: '2 years', per_three_years: '3 years', per_four_years: '4 years', per_five_years: '5 years' };

/** " / month", " / year" ... for a recurring line; blank for one-time. */
export function perText(item) {
  const per = PER[String(item.recurringbillingfrequency || '').toLowerCase()];
  return per ? ` / ${per}` : '';
}

/**
 * The stacked Net Price cell (like the legacy quote): the price before discount struck out, then
 * "after 68% discount" (green) and the net price. listPrice and discountLabel are blank when the line
 * has no discount, so only the net price shows.
 *   ~~$1,040.00 / month~~
 *   after 68% discount
 *   $332.80 / month
 */
export function priceCell(item, currency) {
  const per = perText(item);
  const amount = Number(item.amount) || 0;
  const pre = Number(item.hs_pre_discount_amount) || (Number(item.price) || 0) * (Number(item.quantity) || 0);
  const discount = discountText(item, currency);
  const discounted = Boolean(discount) && pre > amount + 0.004;
  return {
    listPrice: discounted ? `${money(pre, currency)}${per}` : '',
    discountLabel: discounted ? `after ${discount} discount` : '',
    netPrice: `${money(amount, currency)}${per}`,
  };
}

/** One table row's cells, already formatted. */
export function rowCells(item, currency) {
  const quantity = Number(item.quantity) || 0;
  return {
    ...priceCell(item, currency),
    name: item.name || item.hs_sku || 'Line item',
    ramp: /^RAMP\b/i.test(item.name || ''),
    quantity: quantity.toLocaleString('en-US'),
    unitPrice: money(item.price, currency),
    discount: discountText(item, currency),
    term: termText(item),
    amount: money(item.amount, currency), // HubSpot's Net Price: no /mo suffix
  };
}

/** Placeholder lines for the template editor (a template has no real line items). */
export const SAMPLE_LINE_ITEMS = [
  { name: 'AutoElevate 1000 Agent Plan 2026', hs_sku: 'Standard-AE-1000-Agent-Commit-2026', quantity: 1, price: 1050, hs_discount_percentage: 10, amount: 945, recurringbillingfrequency: 'monthly', hs_recurring_billing_period: 'P12M', hs_position_on_quote: 1 },
  { name: 'DNS Filtering 500 Device Plan 2026', hs_sku: 'DNS-500-Device-Commit-2026', quantity: 1, price: 300, amount: 300, recurringbillingfrequency: 'monthly', hs_recurring_billing_period: 'P12M', hs_position_on_quote: 2 },
];
