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
  assert.equal(c.amount, '$945.00/mo');
  assert.equal(c.ramp, false);
  assert.equal(rowCells(line('RAMP 1 AutoElevate Plan')).ramp, true);
});

test('term and discount text', () => {
  assert.equal(termText(line('x', { recurringbillingfrequency: 'one_time' })), 'One-time');
  assert.equal(termText(line('x', { hs_recurring_billing_terms: 'AUTOMATICALLY_RENEW' })), 'Month-to-month');
  assert.equal(termText(line('x', { hs_recurring_billing_period: 'P14M' })), '14 months');
  assert.equal(termText(line('x', { recurringbillingfrequency: 'annually', hs_recurring_billing_period: 'P1Y' })), '1 year');
  assert.equal(discountText(line('x', { hs_discount_percentage: 100 })), '100%');
  assert.equal(discountText(line('x', { discount: 25 }), 'USD'), '$25.00');
  assert.equal(discountText(line('x')), '—');
});

test('template editor sample shows AutoElevate and DNS tables', () => {
  assert.deepEqual(groupLineItems(SAMPLE_LINE_ITEMS).map((g) => g.key), ['autoelevate', 'dns']);
});
