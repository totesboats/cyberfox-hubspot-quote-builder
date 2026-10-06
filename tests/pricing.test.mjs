import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as P from '../shared/pricing.mjs';

const require = createRequire(import.meta.url);

// Fixture: a slice of the 2026 product library, tagged the way scripts/tag-products.mjs tags it.
let nextId = 1000;
const prod = (sku, price, family, edition, segment, billing, tier, component = 'base') => ({
  id: String(nextId++),
  properties: { name: sku.replace(/-/g, ' '), hs_sku: sku, hs_price_usd: String(price), qb_family: family, qb_edition: edition, qb_segment: segment, qb_billing: billing, qb_tier: tier == null ? '' : String(tier), qb_component: component },
});
const RECORDS = [
  prod('Standard-AE-250-Agent-Commit-2026', 337.5, 'autoelevate', 'standard', 'MSP', 'monthly', 250),
  prod('Standard-AE-250-Agent-Commit-Additional-Agents+2026', 1.35, 'autoelevate', 'standard', 'MSP', 'monthly', 250, 'additional'),
  prod('Standard-AE-1000-Agent-Commit-2026', 1050, 'autoelevate', 'standard', 'MSP', 'monthly', 1000),
  prod('Standard-AE-1000-Agent-Commit-Additional-Agents+2026', 1.05, 'autoelevate', 'standard', 'MSP', 'monthly', 1000, 'additional'),
  prod('Standard-AE-1500-Agent-Commit-2026', 1470, 'autoelevate', 'standard', 'MSP', 'monthly', 1500),
  prod('Standard-AE-1500-Agent-Commit-Additional-Agents+2026', 0.98, 'autoelevate', 'standard', 'MSP', 'monthly', 1500, 'additional'),
  prod('Standard-AE-500-Agent-Annual-Commit-E-2026', 10320, 'autoelevate', 'standard', 'ENT', 'annual', 500),
  prod('Standard-AE-500-Agent-Annual-Commit-Additional-Agents-E+2026', 20.64, 'autoelevate', 'standard', 'ENT', 'annual', 500, 'additional'),
  prod('PB-25-User-Pack-2026', 99, 'password', 'pack', 'MSP', 'monthly', 25),
  prod('PB-100-User-Pack-2026', 150, 'password', 'pack', 'MSP', 'monthly', 100),
  prod('PB-500-User-Pack-2026', 379, 'password', 'pack', 'MSP', 'monthly', 500),
  prod('DNS-500-Device-Commit-2026', 300, 'dns', 'standard', 'MSP', 'monthly', 500),
  prod('DNS-500-Device-Commit-Additional-Devices+2026', 0.6, 'dns', 'standard', 'MSP', 'monthly', 500, 'additional'),
  prod('Timus SASE - Monthly Minimum', 250, 'timus', 'advanced', 'MSP', 'monthly', null, 'minimum'),
  prod('Timus SASE - SATGAT', 250, 'timus', 'advanced', 'MSP', 'monthly', 250, 'satgat'),
  prod('Timus SASE - SATGAT III', 1000, 'timus', 'advanced', 'MSP', 'monthly', 1000, 'satgat'),
];
const CATALOG = P.indexCatalog(RECORDS);
const TIMUS_LISTS = [
  P.normalizeTimusList({ values: { price_list_value: 'pl-1000', label: 'Tier 3 - $1000 (GW 50)', min_mrr: 1000, gateway_rate: 50, advanced_user_rate: 4.55 } }),
  P.normalizeTimusList({ values: { price_list_value: 'pl-750', label: 'Tier 2 - $750 (GW 50)', min_mrr: 750, gateway_rate: 50, advanced_user_rate: null } }),
];
const MSP = { segment: 'MSP', billing: 'monthly', agreementLength: '15 Months', salesTeam: 'MSP', templateType: 'CPQ_QUOTE' };
const ae = (over = {}) => Object.assign({ uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, discountPct: 10, ramp: true }, over);

test('catalog indexes tiers and Timus SKUs with no issues', () => {
  assert.deepEqual(CATALOG.issues, []);
  assert.ok(CATALOG.tiers['autoelevate|standard|MSP|monthly'][1000].additional);
  assert.equal(CATALOG.timus.minimum.sku, 'Timus SASE - Monthly Minimum');
  assert.equal(CATALOG.timus.satgat[1000].sku, 'Timus SASE - SATGAT III');
});

test('catalog reports duplicate SKUs for the same slot', () => {
  const dup = P.indexCatalog(RECORDS.concat([prod('PB-500-User-Pack', 239, 'password', 'pack', 'MSP', 'monthly', 500)]));
  assert.equal(dup.issues.length, 1);
  assert.match(dup.issues[0], /Two base SKUs/);
});

test('picks the cheapest tier: 1,250 agents = 1,000 commit + 250 additional', () => {
  const r = P.priceProduct(ae(), MSP, CATALOG, TIMUS_LISTS);
  assert.equal(r.error, '');
  assert.equal(r.chosenTier, 1000);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[1].quantity, 250);
  assert.equal(r.lines[0].gross + r.lines[1].gross, 1312.5);
  assert.equal(r.lines[0].net + r.lines[1].net, 1181.25);
});

test('warns when the rep forces a pricier tier', () => {
  const r = P.priceProduct(ae({ tier: 1500 }), MSP, CATALOG, TIMUS_LISTS);
  assert.equal(r.chosenTier, 1500);
  assert.equal(r.lines.length, 1);
  assert.equal(r.hintLevel, 'warning');
  assert.match(r.hint, /\$157\.50\/mo less/);
});

test('pack SKUs buy enough packs: 300 users = one 500-user pack', () => {
  const r = P.priceProduct({ uid: 2, family: 'password', edition: 'pack', quantity: 300, discountPct: 0 }, MSP, CATALOG, TIMUS_LISTS);
  assert.equal(r.chosenTier, 500);
  assert.equal(r.lines[0].quantity, 1);
  assert.equal(r.lines[0].net, 379);
});

test('missing segment/billing combination is a blocking error', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { billing: 'annual' }), [ae()], {}, CATALOG, TIMUS_LISTS);
  assert.equal(q.lines.length, 0);
  assert.equal(q.blocking.length, 1);
  assert.match(q.blocking[0].error, /No MSP annual/);
});

test('enterprise annual SKUs are valued per month', () => {
  const r = P.priceProduct(ae({ quantity: 500, discountPct: 0 }), Object.assign({}, MSP, { segment: 'ENT', billing: 'annual' }), CATALOG, TIMUS_LISTS);
  assert.equal(r.annual, true);
  assert.equal(r.lines[0].mrr, 860);
});

test('3-month free ramp: RAMP lines, totals and approval', () => {
  const q = P.buildQuote(MSP, [ae()], { enabled: true, months: 3, mode: 'free' }, CATALOG, TIMUS_LISTS);
  assert.equal(q.lines.length, 4);
  const rampLines = q.lines.filter((l) => l.ramp);
  assert.equal(rampLines.length, 2);
  assert.ok(rampLines.every((l) => l.discountPct === 100 && l.net === 0 && l.termMonths === 3 && l.name.startsWith('RAMP ')));
  assert.ok(q.lines.filter((l) => !l.ramp).every((l) => l.startMonth === 4 && l.termMonths === 12));
  assert.deepEqual(q.lines.map((l) => l.position), [1, 2, 3, 4]);
  assert.equal(q.totals.mrr, 1181.25);
  assert.equal(q.totals.firstYear, 10631.25);
  assert.equal(q.totals.tcv, 14175);
  assert.equal(q.totals.contractMonths, 15);
  assert.equal(q.approval.required, true);
  assert.equal(q.approval.reasons.length, 1);
  assert.match(q.approval.approver, /Tina Kalke/);
});

test('percent ramp uses the ramp discount, not the plan discount', () => {
  const q = P.buildQuote(MSP, [ae()], { enabled: true, months: 2, mode: 'percent', percent: 50 }, CATALOG, TIMUS_LISTS);
  const r = q.lines.find((l) => l.ramp && l.kind === 'base');
  assert.equal(r.discountPct, 50);
  assert.equal(r.net, 525);
  assert.equal(q.approval.required, false); // 2 months and 10% discount
});

test('discount threshold is inclusive at 30%', () => {
  assert.equal(P.buildQuote(MSP, [ae({ discountPct: 29.99, ramp: false })], {}, CATALOG, TIMUS_LISTS).approval.required, false);
  const q = P.buildQuote(MSP, [ae({ discountPct: 30, ramp: false })], {}, CATALOG, TIMUS_LISTS);
  assert.equal(q.approval.required, true);
  assert.match(q.approval.reasons[0], /30% discount on AutoElevate/);
});

test('legacy templates flag approvals as manual', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { templateType: 'CUSTOMIZABLE_QUOTE_TEMPLATE' }), [ae({ discountPct: 40 })], {}, CATALOG, TIMUS_LISTS);
  assert.equal(q.approval.manual, true);
});

test('approver falls back to Operations for unknown teams', () => {
  assert.equal(P.evaluateApproval({ maxDiscountPct: 50, rampMonths: 0, salesTeam: 'Events' }).approver, 'Operations team');
});

test('Timus: minimum line at the price list minimum, usage check', () => {
  const r = P.priceProduct({ uid: 3, family: 'timus', quantity: 150, gateways: 2, discountPct: 0, priceListValue: 'pl-1000', agreement: 'standard' }, MSP, CATALOG, TIMUS_LISTS);
  assert.equal(r.error, '');
  assert.equal(r.lines[0].unitPrice, 1000);
  assert.equal(r.lines[0].sku, 'Timus SASE - Monthly Minimum');
  assert.equal(r.timus.usage, 782.5);
  assert.equal(r.hintLevel, 'info');
});

test('Timus: SATGAT only for tiers with a SATGAT SKU; rate falls back to rep entry', () => {
  const sat = P.priceProduct({ uid: 3, family: 'timus', quantity: 10, discountPct: 0, priceListValue: 'pl-1000', agreement: 'satgat' }, MSP, CATALOG, TIMUS_LISTS);
  assert.equal(sat.lines[0].sku, 'Timus SASE - SATGAT III');
  const bad = P.priceProduct({ uid: 3, family: 'timus', quantity: 10, discountPct: 0, priceListValue: 'pl-750', agreement: 'satgat', userRateOverride: 5 }, MSP, CATALOG, TIMUS_LISTS);
  assert.match(bad.error, /Satisfaction-guarantee/);
  assert.equal(bad.timus.rateSource, 'entered by rep');
});

test('line item properties for ramp, plan and month-to-month lines', () => {
  const q = P.buildQuote(MSP, [ae()], { enabled: true, months: 3 }, CATALOG, TIMUS_LISTS);
  const ramp = P.lineItemProperties(q.lines[0], { billing: 'monthly', rampMonths: 3, sessionId: 's1' });
  assert.equal(ramp.ramp, 'true');
  assert.equal(ramp.hs_recurring_billing_period, 'P3M');
  assert.equal(ramp.approval_discount, '0');
  assert.equal(ramp.approval_ramp_months, '3');
  assert.equal(ramp.qb_source, 'quote_builder');
  const plan = P.lineItemProperties(q.lines[2], { billing: 'monthly', rampMonths: 3, sessionId: 's1' });
  assert.equal(plan.approval_discount, '10');
  assert.equal(plan.hs_recurring_billing_period, 'P12M');
  assert.equal(plan.hs_billing_start_delay_months, undefined);
  const m2m = P.lineItemProperties(Object.assign({}, q.lines[2]), { billing: 'm2m', rampMonths: 0, sessionId: 's1' });
  assert.equal(m2m.hs_recurring_billing_terms, 'AUTOMATICALLY_RENEW');
  assert.equal(m2m.hs_recurring_billing_period, undefined);
});

test('auto quote name', () => {
  assert.equal(P.autoQuoteName('Northwind', [{ family: 'autoelevate' }, { family: 'dns' }, { family: 'autoelevate' }], 3), 'Northwind - AutoElevate + DNS Filtering + 3 Month Ramp');
});

test('server-side validation rejects bad payloads', () => {
  const errs = P.validateSubmission({ setup: { segment: 'X', billing: 'weekly', templateId: '', expirationDate: '10/1/2026' }, products: [{ family: 'nope', discountPct: 120, quantity: -1 }], ramp: { enabled: true, months: 9 } });
  assert.ok(errs.length >= 7, errs.join('; '));
  assert.deepEqual(P.validateSubmission({ setup: { segment: 'MSP', billing: 'monthly', agreementLength: '15 Months', templateId: '1', expirationDate: '2026-11-05' }, products: [ae()], ramp: { enabled: true, months: 3 } }), []);
  assert.match(P.validateSubmission({ setup: { segment: 'MSP', billing: 'monthly', agreementLength: 'soon', templateId: '1', expirationDate: '2026-11-05' }, products: [ae()] }).join(), /agreementLength/);
});

test('generated CommonJS copy behaves identically to the ESM source', async () => {
  const { toCjs } = await import('../scripts/sync-shared.mjs');
  const { readFileSync, mkdtempSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'qb-'));
  for (const f of ['config', 'pricing']) writeFileSync(join(dir, `${f}.js`), toCjs(readFileSync(new URL(`../shared/${f}.mjs`, import.meta.url), 'utf8')));
  writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}');
  const C = require(join(dir, 'pricing.js'));
  const args = [MSP, [ae(), { uid: 2, family: 'password', edition: 'pack', quantity: 300, discountPct: 35 }], { enabled: true, months: 3 }];
  const a = P.buildQuote(...args, P.indexCatalog(RECORDS), TIMUS_LISTS);
  const b = C.buildQuote(...args, C.indexCatalog(RECORDS), TIMUS_LISTS);
  assert.deepEqual(JSON.parse(JSON.stringify(b.totals)), JSON.parse(JSON.stringify(a.totals)));
  assert.deepEqual(b.approval, a.approval);
  assert.equal(b.lines.length, a.lines.length);
});

// ---------------------------------------------------------------------------
// Quote-token deal properties
// ---------------------------------------------------------------------------
const OPTIONS = {
  agreement_length: ['12 Months - Month-to-Month', '12 Months', '13 Months', '15 Months', '24 Months'].map((v) => ({ value: v, label: v === '12 Months - Month-to-Month' ? 'Month-to-Month' : v })),
  payment_terms: [{ value: 'Month-to-Month', label: 'Monthly' }, { value: 'Quarterly', label: 'Quarterly' }, { value: 'Annual Payments', label: 'Annual Payments' }],
  payment_method: [{ value: 'Credit Card', label: 'Credit Card' }, { value: 'ACH', label: 'ACH' }],
  invoice_terms: [{ value: 'Net-30', label: 'Net-30' }],
  promo: [{ value: 'ENT 13 for 12', label: 'ENT 13 for 12' }],
  sku_type: ['Advanced', 'Standard', 'Advanced (GrandFathered)'].map((v) => ({ value: v, label: v })),
};
const W = (setup, products, ramp, notes = '') => {
  const s = Object.assign({}, MSP, { paymentMethod: 'ACH', invoiceTerms: 'Net-30' }, setup);
  const q = P.buildQuote(s, products, ramp, CATALOG, TIMUS_LISTS);
  return { q, w: P.dealWrites(q, { setup: s, notes }, OPTIONS) };
};

test('agreement length is the rep choice; contract term is not written; payment frequency follows billing', () => {
  const { w } = W({}, [ae()], { enabled: true, months: 3 });
  assert.deepEqual(w.errors, []);
  assert.equal(w.properties.agreement_length, '15 Months');
  assert.equal('contract_term' in w.properties, false);
  assert.equal(w.properties.payment_terms, 'Month-to-Month');
  assert.equal(w.properties.payment_method, 'ACH');
  assert.equal(w.properties.invoice_terms, 'Net-30');
});

test('month-to-month uses the Month-to-Month agreement length option', () => {
  const s = { agreementLength: '12 Months - Month-to-Month' };
  const q = P.buildQuote(Object.assign({}, MSP, s), [ae({ ramp: false })], {}, CATALOG, TIMUS_LISTS);
  const w = P.dealWrites(q, { setup: Object.assign({}, MSP, s) }, OPTIONS);
  assert.equal(w.properties.agreement_length, '12 Months - Month-to-Month');
  assert.equal(q.billing, 'm2m');
  assert.match(q.blocking[0].error, /month-to-month SKUs/); // fixture has no M2M SKUs
});

test('a value the property does not offer is an error, not a write', () => {
  const { w } = W({ agreementLength: '41 Months' }, [ae()], { enabled: true, months: 5 });
  assert.equal(w.properties.agreement_length, undefined);
  assert.match(w.errors[0], /Agreement Length has no "41 Months" option/);
});

test('rep override of payment frequency, and a warning when annual SKUs are paid monthly', () => {
  assert.equal(W({ paymentFrequency: 'Quarterly' }, [ae()], {}).w.properties.payment_terms, 'Quarterly');
  const ent = W({ segment: 'ENT', billing: 'annual', paymentFrequency: 'Month-to-Month' }, [ae({ quantity: 500 })], {});
  assert.equal(ent.w.warnings.length, 1);
  assert.match(ent.w.warnings[0], /annual but Payment Frequency is Monthly/);
  assert.equal(W({ segment: 'ENT', billing: 'annual' }, [ae({ quantity: 500 })], {}).w.properties.payment_terms, 'Annual Payments');
});

test('AE feature type sets AE Feature Type and its details text', () => {
  const std = W({}, [ae({ featureType: 'Standard' })], {}).w.properties;
  assert.equal(std.sku_type, 'Standard');
  assert.match(std.ae_feature_type_details, /^Elevation\. Additional agents .* Usage of Advanced features Blocker/);
  const gf = W({}, [ae({ featureType: 'Advanced (GrandFathered)' })], {});
  assert.equal(gf.w.properties.sku_type, 'Advanced (GrandFathered)');
  assert.equal(gf.w.properties.ae_feature_type_details.slice(0, 63), '1,000 agents include advanced features Just-In-Time Admin Login');
  assert.equal(gf.q.lines[0].sku, 'Standard-AE-1000-Agent-Commit-2026'); // grandfathered prices on standard SKUs
});

test('Advanced feature type prices on advanced SKUs (none in this fixture → blocking error)', () => {
  const { q } = W({}, [ae({ featureType: 'Advanced' })], {});
  assert.match(q.blocking[0].error, /AutoElevate advanced/);
});

test('different AE feature types on one quote are a conflict; non-AE quotes leave AE fields alone', () => {
  const { q, w } = W({}, [ae({ featureType: 'Standard' }), ae({ uid: 2, featureType: 'Advanced (GrandFathered)' })], {});
  assert.equal(q.conflicts.length, 1);
  assert.equal(w.properties.sku_type, undefined);
  const dns = W({}, [{ uid: 3, family: 'dns', edition: 'standard', quantity: 600, discountPct: 0 }], {}).w.properties;
  assert.ok(!('sku_type' in dns) && !('ae_feature_type_details' in dns));
});

test('Timus deal fields are written with two decimals', () => {
  const { w } = W({}, [{ uid: 4, family: 'timus', quantity: 10, gateways: 1, discountPct: 0, priceListValue: 'pl-1000', agreement: 'standard' }], {});
  assert.equal(w.properties.timus_price_per_user, '4.55');
  assert.equal(w.properties.timus_price_per_gateway, '50.00');
});

test('agreement length splits into ramp + plan; products off the ramp run the whole agreement', () => {
  const dns = { uid: 3, family: 'dns', edition: 'standard', quantity: 600, discountPct: 0, ramp: false };
  const q = P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [ae(), dns], { enabled: true, months: 4 }, CATALOG, TIMUS_LISTS);
  const aePlan = q.lines.find((l) => !l.ramp && l.family === 'autoelevate');
  const dnsPlan = q.lines.find((l) => l.family === 'dns');
  assert.equal(aePlan.termMonths, 12);
  assert.equal(aePlan.startMonth, 5);
  assert.equal(dnsPlan.termMonths, 16);
  assert.equal(dnsPlan.startMonth, 1);
  assert.equal(q.totals.contractMonths, 16);
  assert.equal(q.totals.tcv, 12 * 1181.25 + 16 * 360);
});

test('a ramp as long as the agreement is a conflict; missing agreement length is a conflict', () => {
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '3 Months' }), [ae()], { enabled: true, months: 3 }, CATALOG, TIMUS_LISTS).conflicts[0], /as long as the 3-month Agreement Length/);
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '' }), [ae()], {}, CATALOG, TIMUS_LISTS).conflicts[0], /Pick an Agreement Length/);
});

test('quote lock state follows HubSpot progression status', () => {
  assert.equal(P.quoteLockState('DRAFT'), 'open');
  assert.equal(P.quoteLockState('PENDING_APPROVAL'), 'open');
  assert.equal(P.quoteLockState('CHANGES_REQUESTED'), 'open');
  for (const s of ['PUBLISHED', 'PENDING_SIGNATURE', 'SENT', 'VIEWED', 'VIEWED_PENDING_SIGNATURE', 'ACCEPTED']) assert.equal(P.quoteLockState(s), 'locked');
  assert.equal(P.quoteLockState('VOID'), 'void');
});

test('open-quote conflicts only when a printed value actually changes', () => {
  const quotes = [{ id: 'a', title: 'A', progressionStatus: 'DRAFT' }, { id: 'b', title: 'B', progressionStatus: 'PUBLISHED' }];
  const deal = { agreement_length: '12 Months', sku_type: 'Standard' };
  assert.deepEqual(P.openQuoteConflicts(quotes, deal, { agreement_length: '12 Months', hubspot_quote_notes: 'x' }).quotes, []);
  const c = P.openQuoteConflicts(quotes, deal, { agreement_length: '24 Months' });
  assert.deepEqual(c.changed, ['agreement_length']);
  assert.deepEqual(c.quotes.map((q) => q.id), ['a']);
});

test('builder state round-trips; junk is ignored', () => {
  const s = P.parseBuilderState(P.builderState({ setup: { segment: 'MSP' }, products: [{ family: 'dns' }], ramp: { months: 2 }, notes: 'n' }, { promo: '' }));
  assert.equal(s.setup.segment, 'MSP');
  assert.deepEqual(s.dealProperties, { promo: '' });
  assert.equal(P.parseBuilderState('not json'), null);
  assert.equal(P.parseBuilderState(''), null);
});
