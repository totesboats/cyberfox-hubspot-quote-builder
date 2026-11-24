// Tests for the "Line items by product" quote module's grouping and formatting (quote-modules/).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  productKeyFor,
  groupLineItems,
  rowCells,
  termText,
  discountText,
  SAMPLE_LINE_ITEMS,
  isCotermLine,
  quoteLayout,
  COTERM_TEXT,
  priceCell,
} from '../quote-modules/src/cms-assets/cyberfox-quote-modules/components/modules/ProductLineItems/productGroups.js';

const line = (name, extra = {}) => ({ name, quantity: 1, price: 100, amount: 100, recurringbillingfrequency: 'monthly', hs_recurring_billing_period: 'P12M', ...extra });

test('each product family is recognised from the line name or SKU', () => {
  assert.equal(productKeyFor(line('AutoElevate 500 Agent Plan 2026')), 'autoelevate');
  assert.equal(productKeyFor(line('Agent Plan', { hs_sku: 'Standard-AE-500-Agent-Commit-2026' })), 'autoelevate');
  assert.equal(productKeyFor(line('Password Manager 50 User Plan')), 'password');
  assert.equal(productKeyFor(line('DNS Filtering 500 Device Plan 2026')), 'dns');
  assert.equal(productKeyFor(line('Timus SASE 25 User Plan')), 'timus');
  assert.equal(productKeyFor(line('Optimize365 – Tenant Base')), 'optimize365');
  assert.equal(productKeyFor(line('TDR – Additional User')), 'optimize365');
  // No Bundle table: CyberFOX Bundles aren't quoted, so an old Bundle line falls into Other.
  assert.equal(productKeyFor(line('CyberFOX Bundle 500 MSP 2026', { hs_sku: 'Bundle-500-Monthly-2026' })), 'other');
  assert.equal(productKeyFor(line('Professional Services Onboarding')), 'other');
});

test('ramp lines stay with their product', () => {
  assert.equal(productKeyFor(line('RAMP 1 DNS Filtering 500 Device Plan 2026')), 'dns');
  assert.equal(productKeyFor(line('RAMP 2 AutoElevate 500 Agent Plan 2026')), 'autoelevate');
});

test('tables follow product order (AutoElevate first) and products not on the quote get no table', () => {
  const groups = groupLineItems([
    line('DNS Filtering 500 Device Plan', { hs_position_on_quote: 1 }),
    line('Onboarding fee', { hs_position_on_quote: 2 }),
    line('AutoElevate 500 Agent Plan', { hs_position_on_quote: 3 }),
    line('RAMP 1 AutoElevate 500 Agent Plan', { hs_position_on_quote: 0 }),
  ]);
  assert.deepEqual(groups.map((g) => g.key), ['autoelevate', 'dns', 'other']);
  assert.deepEqual(groups[0].items.map((i) => i.name), ['RAMP 1 AutoElevate 500 Agent Plan', 'AutoElevate 500 Agent Plan']);
});

test('a quote with only AutoElevate shows one table', () => {
  const groups = groupLineItems([line('AutoElevate 1000 Agent Plan')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, 'AutoElevate');
});

test('heading overrides replace the default label, blanks keep it', () => {
  const groups = groupLineItems([line('AutoElevate Plan'), line('DNS Filtering Plan')], { autoelevate: 'AutoElevate PAM', dns: '  ' });
  assert.deepEqual(groups.map((g) => g.label), ['AutoElevate PAM', 'DNS Filtering']);
});

test('no line items means no tables', () => {
  assert.deepEqual(groupLineItems([]), []);
  assert.deepEqual(groupLineItems(undefined), []);
});

test('cells are formatted like the standard table', () => {
  const c = rowCells(line('AutoElevate Plan', { quantity: 1200, price: 1050, hs_discount_percentage: 10, amount: 945 }), 'USD');
  assert.equal(c.quantity, '1,200');
  assert.equal(c.unitPrice, '$1,050.00');
  assert.equal(c.discount, '10%');
  assert.equal(c.term, '12 months');
  assert.equal(c.amount, '$945.00');
  assert.equal(c.ramp, false);
  assert.equal(c.netPrice, '$945.00 / month');
  assert.equal(rowCells(line('RAMP 1 AutoElevate Plan')).ramp, true);
});

test('term and discount text', () => {
  assert.equal(termText(line('x', { recurringbillingfrequency: 'one_time' })), 'One-time');
  assert.equal(termText(line('x', { hs_recurring_billing_terms: 'AUTOMATICALLY_RENEW' })), 'Month-to-month');
  assert.equal(termText(line('x', { hs_recurring_billing_period: 'P14M' })), '14 months');
  assert.equal(termText(line('x', { recurringbillingfrequency: 'annually', hs_recurring_billing_period: 'P1Y' })), '1 year');
  assert.equal(discountText(line('x', { hs_discount_percentage: 100 })), '100%');
  assert.equal(discountText(line('x', { discount: 25 }), 'USD'), '$25.00');
  assert.equal(discountText(line('x')), '');
});

test('template editor sample shows AutoElevate and DNS tables', () => {
  assert.deepEqual(groupLineItems(SAMPLE_LINE_ITEMS).map((g) => g.key), ['autoelevate', 'dns']);
});

test('co-term lines are recognised from qb_line_type, any case', () => {
  assert.equal(isCotermLine(line('DNS', { qb_line_type: 'coterm' })), true);
  assert.equal(isCotermLine(line('DNS', { qb_line_type: 'Co-term' })), true);
  assert.equal(isCotermLine(line('DNS', { qb_line_type: ' COTERM ' })), true);
  for (const t of ['New', 'Upsell', 'Downgrade', '', undefined, null]) {
    assert.equal(isCotermLine(line('DNS', { qb_line_type: t })), false, String(t));
  }
  assert.equal(isCotermLine(null), false);
});

test('a quote without co-term lines keeps the normal layout', () => {
  const items = [line('DNS Filtering 500 Device Plan', { qb_line_type: 'New' }), line('AutoElevate 500 Agent Plan', { qb_line_type: 'Upsell' })];
  const layout = quoteLayout(items);
  assert.equal(layout.coterm, false);
  assert.deepEqual(layout.newGroups, groupLineItems(items));
  assert.deepEqual(layout.existingGroups, []);
});

test('a co-term quote puts new products first and existing ones in their own section', () => {
  const items = [
    line('AutoElevate 500 Agent Plan', { qb_line_type: 'coterm', hs_position_on_quote: 1 }),
    line('DNS Filtering 500 Device Plan', { qb_line_type: 'New', hs_position_on_quote: 2 }),
    line('Password Manager 50 User Plan', { qb_line_type: 'coterm', hs_position_on_quote: 3 }),
    line('Timus SASE 25 User Plan', { qb_line_type: 'Upsell', hs_position_on_quote: 4 }),
  ];
  const layout = quoteLayout(items, { dns: 'DNS' });
  assert.equal(layout.coterm, true);
  assert.deepEqual(layout.newGroups.map((g) => g.key), ['dns', 'timus']);
  assert.equal(layout.newGroups[0].label, 'DNS');
  assert.deepEqual(layout.existingGroups.map((g) => g.key), ['autoelevate', 'password']);
  const names = (gs) => gs.flatMap((g) => g.items.map((i) => i.name));
  assert.deepEqual(names(layout.newGroups), ['DNS Filtering 500 Device Plan', 'Timus SASE 25 User Plan']);
  assert.deepEqual(names(layout.existingGroups), ['AutoElevate 500 Agent Plan', 'Password Manager 50 User Plan']);
});

test('the same product can be both new (ramp or extra seats) and existing', () => {
  const items = [line('AutoElevate 500 Agent Plan', { qb_line_type: 'coterm' }), line('AutoElevate 100 Agent Add-on', { qb_line_type: 'Upsell' })];
  const layout = quoteLayout(items);
  assert.deepEqual(layout.newGroups.map((g) => g.key), ['autoelevate']);
  assert.deepEqual(layout.existingGroups.map((g) => g.key), ['autoelevate']);
});

test('co-term section headings, and no note by default', () => {
  assert.equal(COTERM_TEXT.newHeading, 'Your new subscriptions');
  assert.equal(COTERM_TEXT.existingHeading, 'Your current subscriptions');
  assert.equal(COTERM_TEXT.existingNote, '');
});

test('Net Price shows the price before discount struck out, like the legacy quote', () => {
  const c = priceCell(line('AutoElevate', { quantity: 1, price: 1040, hs_discount_percentage: 68, amount: 332.8 }), 'USD');
  assert.deepEqual(c, { listPrice: '$1,040.00 / month', discountLabel: 'after 68% discount', netPrice: '$332.80 / month' });
  // The struck-out price is for the whole quantity, so it compares with the net price.
  const q = priceCell(line('DNS', { quantity: 3, price: 100, hs_discount_percentage: 10, amount: 270 }), 'USD');
  assert.equal(q.listPrice, '$300.00 / month');
  assert.equal(priceCell(line('DNS', { quantity: 3, price: 100, hs_pre_discount_amount: 300, discount: 25, amount: 225 })).discountLabel, 'after $25.00 discount');
  assert.equal(priceCell(line('DNS', { recurringbillingfrequency: 'annually', price: 1200, amount: 1200 })).netPrice, '$1,200.00 / year');
});

test('no discount: just the net price', () => {
  assert.deepEqual(priceCell(line('DNS')), { listPrice: '', discountLabel: '', netPrice: '$100.00 / month' });
  assert.equal(priceCell(line('Onboarding', { recurringbillingfrequency: undefined, price: 500, amount: 500 })).netPrice, '$500.00');
});
