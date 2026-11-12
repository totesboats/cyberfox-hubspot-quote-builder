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

test('default tier: 1,250 agents = 1,000 commit + 250 additional', () => {
  const r = P.priceProduct(ae(), MSP, CATALOG);
  assert.equal(r.error, '');
  assert.equal(r.chosenTier, 1000);
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[1].quantity, 250);
  assert.equal(r.lines[0].gross + r.lines[1].gross, 1312.5);
  assert.equal(r.lines[0].net + r.lines[1].net, 1181.25);
});

test('warns when the rep forces a pricier tier', () => {
  const r = P.priceProduct(ae({ tier: 1500 }), MSP, CATALOG);
  assert.equal(r.chosenTier, 1500);
  assert.equal(r.lines.length, 1);
  assert.equal(r.hintLevel, 'warning');
  assert.match(r.hint, /\$157\.50\/mo less/);
});

test('default is the highest tier at or below the count, even when the next tier lists less (900 agents)', () => {
  // Live 2026 MSP prices: 750 tier $877.50 + $1.17/agent; 1,000 tier $1,050.
  const cat = P.indexCatalog([
    prod('Standard-AE-750-Agent-Commit-2026', 877.5, 'autoelevate', 'standard', 'MSP', 'monthly', 750),
    prod('Standard-AE-750-Agent-Commit-Additional-Agents+2026', 1.17, 'autoelevate', 'standard', 'MSP', 'monthly', 750, 'additional'),
    prod('Standard-AE-1000-Agent-Commit-2026', 1050, 'autoelevate', 'standard', 'MSP', 'monthly', 1000),
    prod('Standard-AE-1000-Agent-Commit-Additional-Agents+2026', 1.05, 'autoelevate', 'standard', 'MSP', 'monthly', 1000, 'additional'),
  ]);
  const r = P.priceProduct(ae({ quantity: 900, discountPct: 0 }), MSP, cat);
  assert.equal(r.chosenTier, 750);
  assert.equal(r.cheapestTier, 1000);
  assert.deepEqual(r.lines.map((l) => [l.sku, l.quantity]), [['Standard-AE-750-Agent-Commit-2026', 1], ['Standard-AE-750-Agent-Commit-Additional-Agents+2026', 150]]);
  assert.equal(r.hintLevel, 'info');
  assert.match(r.hint, /1,000 tier lists \$3\.00\/mo less/);
  assert.match(r.tierOptions.find((o) => o.value === '1000').label, /lowest price/);
  // The rep can still round up to 1,000; that's cheaper, so it's an info note, not a warning.
  const up = P.priceProduct(ae({ quantity: 900, discountPct: 0, tier: 1000 }), MSP, cat);
  assert.equal(up.chosenTier, 1000);
  assert.equal(up.lines.length, 1);
  assert.equal(up.hintLevel, 'info');
  assert.match(up.hint, /rounded up from the default 750 tier/);
  // Below the smallest tier: the smallest tier, no overage.
  const small = P.priceProduct(ae({ quantity: 600, discountPct: 0 }), MSP, cat);
  assert.equal(small.chosenTier, 750);
  assert.equal(small.lines.length, 1);
  // Exactly on a tier: that tier.
  assert.equal(P.priceProduct(ae({ quantity: 1000, discountPct: 0 }), MSP, cat).chosenTier, 1000);
});

test('pack SKUs buy enough packs: 300 users = one 500-user pack', () => {
  const r = P.priceProduct({ uid: 2, family: 'password', edition: 'pack', quantity: 300, discountPct: 0 }, MSP, CATALOG);
  assert.equal(r.chosenTier, 500);
  assert.equal(r.lines[0].quantity, 1);
  assert.equal(r.lines[0].net, 379);
});

test('missing segment/billing combination is a blocking error', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { billing: 'annual' }), [ae()], {}, CATALOG);
  assert.equal(q.lines.length, 0);
  assert.equal(q.blocking.length, 1);
  assert.match(q.blocking[0].error, /No MSP annual/);
});

test('enterprise annual SKUs are valued per month', () => {
  const r = P.priceProduct(ae({ quantity: 500, discountPct: 0 }), Object.assign({}, MSP, { segment: 'ENT', billing: 'annual' }), CATALOG);
  assert.equal(r.annual, true);
  assert.equal(r.lines[0].mrr, 860);
});

test('3-month free ramp: RAMP lines, totals and approval', () => {
  const q = P.buildQuote(MSP, [ae()], { enabled: true, months: 3, mode: 'free' }, CATALOG);
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
  // 3 months is under the 4+ month rule; 4 months needs approval (routes to the MSP manager).
  assert.equal(q.approval.required, false);
  const q4 = P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [ae()], { enabled: true, months: 4, mode: 'free' }, CATALOG);
  assert.equal(q4.approval.required, true);
  assert.deepEqual(q4.approval.reasons, ['4-month ramp (4+ months needs approval)']);
  assert.match(q4.approval.approver, /Tina Harvey/);
});

test('percent ramp uses the ramp discount, not the plan discount', () => {
  const q = P.buildQuote(MSP, [ae()], { enabled: true, months: 2, mode: 'percent', percent: 50 }, CATALOG);
  const r = q.lines.find((l) => l.ramp && l.kind === 'base');
  assert.equal(r.discountPct, 50);
  assert.equal(r.net, 525);
  assert.equal(q.approval.required, false); // 2 months and 10% discount
});

test('discount threshold is inclusive at 30%', () => {
  assert.equal(P.buildQuote(MSP, [ae({ discountPct: 29.99, ramp: false })], {}, CATALOG).approval.required, false);
  const q = P.buildQuote(MSP, [ae({ discountPct: 30, ramp: false })], {}, CATALOG);
  assert.equal(q.approval.required, true);
  assert.match(q.approval.reasons[0], /30% discount on AutoElevate/);
});

test('legacy templates flag approvals as manual', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { templateType: 'CUSTOMIZABLE_QUOTE_TEMPLATE' }), [ae({ discountPct: 40 })], {}, CATALOG);
  assert.equal(q.approval.manual, true);
});

test('approver falls back to Operations for unknown teams', () => {
  assert.equal(P.evaluateApproval({ maxDiscountPct: 50, rampMonths: 0, salesTeam: 'Events' }).approver, 'Operations team');
});

const timus = (o = {}) => Object.assign({ uid: 3, family: 'timus', quantity: 150, gateways: 2, discountPct: 0, agreement: 'standard', minimum: 1000, userRate: 4.55, gatewayRate: 50 }, o);

test('Timus: Monthly Minimum line at the minimum the rep sets, usage check', () => {
  const r = P.priceProduct(timus(), MSP, CATALOG);
  assert.equal(r.error, '');
  assert.equal(r.lines[0].unitPrice, 1000);
  assert.equal(r.lines[0].sku, 'Timus SASE - Monthly Minimum');
  assert.equal(r.lines[0].name, `${CATALOG.timus.minimum.name} - $1,000`);
  assert.equal(r.timus.usage, 782.5);
  assert.equal(r.hintLevel, 'info');
  const dflt = P.priceProduct(timus({ minimum: '' }), MSP, CATALOG);
  assert.equal(dflt.lines[0].unitPrice, 250); // SKU price when left blank
  assert.equal(dflt.lines[0].name, CATALOG.timus.minimum.name);
  assert.equal(dflt.hintLevel, 'warning'); // usage over the minimum
});

test('Timus: SATGAT tiers come from the tagged SATGAT SKUs', () => {
  const sat = P.priceProduct(timus({ agreement: 'satgat', satgatTier: 1000 }), MSP, CATALOG);
  assert.equal(sat.lines[0].sku, 'Timus SASE - SATGAT III');
  assert.equal(sat.timus.minimum, 1000);
  assert.deepEqual(sat.timus.satgatTiers, [250, 1000]);
  assert.equal(P.priceProduct(timus({ agreement: 'satgat', satgatTier: '' }), MSP, CATALOG).lines[0].sku, 'Timus SASE - SATGAT');
  assert.match(P.priceProduct(timus({ agreement: 'satgat', satgatTier: 500 }), MSP, CATALOG).error, /Pick a SATGAT tier/);
});

test('Timus: rep must enter the per-user and per-gateway prices', () => {
  assert.match(P.priceProduct(timus({ userRate: '' }), MSP, CATALOG).error, /Timus Price Per User/);
  assert.match(P.priceProduct(timus({ gatewayRate: '' }), MSP, CATALOG).error, /Timus Price Per Gateway/);
  assert.match(P.priceProduct(timus({ userRate: 0, gatewayRate: undefined }), MSP, CATALOG).error, /Per User and Timus Price Per Gateway/);
  assert.equal(P.priceProduct(timus({ gatewayRate: 0 }), MSP, CATALOG).error, ''); // free gateways are allowed
});

test('line item properties for ramp, plan and month-to-month lines', () => {
  const q = P.buildQuote(MSP, [ae()], { enabled: true, months: 3 }, CATALOG);
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
  const a = P.buildQuote(...args, P.indexCatalog(RECORDS));
  const b = C.buildQuote(...args, C.indexCatalog(RECORDS));
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
const W = (setup, products, ramp) => {
  const s = Object.assign({}, MSP, { paymentMethod: 'ACH', invoiceTerms: 'Net-30' }, setup);
  const q = P.buildQuote(s, products, ramp, CATALOG);
  return { q, w: P.dealWrites(q, { setup: s }, OPTIONS) };
};

test('agreement length is the rep choice; contract term is not written; payment frequency follows billing', () => {
  const { w } = W({}, [ae()], { enabled: true, months: 3 });
  assert.deepEqual(w.errors, []);
  assert.equal(w.properties.agreement_length, '15 Months');
  assert.equal('contract_term' in w.properties, false);
  assert.equal(w.properties.payment_terms, 'Month-to-Month');
  assert.equal(w.properties.payment_method, 'ACH');
  assert.equal(w.properties.invoice_terms, 'Net-30');
  assert.equal('promo' in w.properties, false); // the deal's Promo is left as it is
});

test('month-to-month uses the Month-to-Month agreement length option', () => {
  const s = { agreementLength: '12 Months - Month-to-Month' };
  const q = P.buildQuote(Object.assign({}, MSP, s), [ae({ ramp: false })], {}, CATALOG);
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
  // Advanced (GrandFathered) is retired: not offered, and the server rejects it.
  const { AE_FEATURE_TYPES } = require('../functions-src/lib/config.js');
  assert.deepEqual(AE_FEATURE_TYPES.map((f) => f.value), ['Standard', 'Advanced']);
  const base = { setup: { segment: 'MSP', billing: 'monthly', agreementLength: '12 Months', templateId: '1', expirationDate: '2026-11-30' } };
  assert.match(P.validateSubmission(Object.assign({}, base, { products: [ae({ featureType: 'Advanced (GrandFathered)' })] })).join(' '), /unknown AE feature type/);
});

test('Advanced feature type prices on advanced SKUs (none in this fixture → blocking error)', () => {
  const { q } = W({}, [ae({ featureType: 'Advanced' })], {});
  assert.match(q.blocking[0].error, /AutoElevate advanced/);
});

test('different AE feature types on one quote are a conflict; non-AE quotes leave AE fields alone', () => {
  const { q, w } = W({}, [ae({ featureType: 'Standard' }), ae({ uid: 2, featureType: 'Advanced' })], {});
  assert.equal(q.conflicts.length, 1);
  assert.equal(w.properties.sku_type, undefined);
  const dns = W({}, [{ uid: 3, family: 'dns', edition: 'standard', quantity: 600, discountPct: 0 }], {}).w.properties;
  assert.ok(!('sku_type' in dns) && !('ae_feature_type_details' in dns));
});

test('Timus deal fields are written with two decimals', () => {
  const { w } = W({}, [timus({ uid: 4, quantity: 10, gateways: 1, userRate: 4.5, gatewayRate: 50 })], {});
  assert.equal(w.properties.timus_price_per_user, '4.50');
  assert.equal(w.properties.timus_price_per_gateway, '50.00');
  assert.equal(w.properties.new_minimum_commitment_amount, '1000');
  assert.ok(!('timus_price_list' in w.properties)); // retired property is left alone
});

test('agreement length splits into ramp + plan; products off the ramp run the whole agreement', () => {
  const dns = { uid: 3, family: 'dns', edition: 'standard', quantity: 600, discountPct: 0, ramp: false };
  const q = P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [ae(), dns], { enabled: true, months: 4 }, CATALOG);
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
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '3 Months' }), [ae()], { enabled: true, months: 3 }, CATALOG).conflicts[0], /as long as the 3-month Agreement Length/);
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '' }), [ae()], {}, CATALOG).conflicts[0], /Pick an Agreement Length/);
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

test('multi-stage ramp: 2 months free then 2 at 50% off on a 16-month agreement', () => {
  const setup = Object.assign({}, MSP, { agreementLength: '16 Months' });
  const ramp = { enabled: true, stages: [{ months: 2, mode: 'free' }, { months: 2, mode: 'percent', percent: 50 }] };
  const q = P.buildQuote(setup, [ae({ discountPct: 10 })], ramp, CATALOG);
  assert.deepEqual(q.conflicts, []);
  assert.equal(q.ramp.months, 4);
  const r1 = q.lines.filter((l) => l.stage === 1);
  const r2 = q.lines.filter((l) => l.stage === 2);
  const plan = q.lines.filter((l) => !l.ramp);
  assert.equal(r1.length, 2);
  assert.ok(r1.every((l) => l.name.startsWith('RAMP 1 ') && l.discountPct === 100 && l.termMonths === 2 && l.startMonth === 1));
  assert.ok(r2.every((l) => l.name.startsWith('RAMP 2 ') && l.discountPct === 50 && l.termMonths === 2 && l.startMonth === 3));
  assert.ok(plan.every((l) => l.termMonths === 12 && l.startMonth === 5 && l.discountPct === 10));
  // Order on the quote: stage 1, stage 2, then the plan.
  assert.deepEqual(q.lines.map((l) => l.stage || 0), [1, 1, 2, 2, 0, 0]);
  // Values: full list per month = 1050 + 250 × 1.05 = 1312.50
  const list = 1312.5;
  assert.equal(q.totals.tcv, Math.round((2 * 0 + 2 * list * 0.5 + 12 * list * 0.9) * 100) / 100);
  assert.equal(q.totals.firstYear, Math.round((2 * list * 0.5 + 8 * list * 0.9) * 100) / 100);
  // Approval sees the total ramp (4 months), and every RAMP line carries it.
  assert.ok(q.approval.reasons.some((x) => /4-month ramp/.test(x)));
  const props = P.lineItemProperties(r2[0], { billing: 'monthly', rampMonths: q.ramp.months, sessionId: 's' });
  assert.equal(props.approval_ramp_months, '4');
  assert.equal(props.hs_recurring_billing_period, 'P2M');
  assert.equal(props.approval_discount, '0');
});

test('ramp stages: old single-stage saved ramps still work; limits are enforced', () => {
  const legacy = P.normalizeRamp({ enabled: true, months: 3, mode: 'percent', percent: 40 });
  assert.deepEqual(legacy.stages.map((s) => [s.months, s.mode, s.percent]), [[3, 'percent', 40]]);
  const single = P.buildQuote(MSP, [ae()], { enabled: true, months: 3, mode: 'free' }, CATALOG);
  assert.ok(single.lines.filter((l) => l.ramp).every((l) => l.name.startsWith('RAMP ') && !l.name.startsWith('RAMP 1')));
  const long = P.buildQuote(Object.assign({}, MSP, { agreementLength: '24 Months' }), [ae()], { enabled: true, stages: [{ months: 8 }, { months: 6, mode: 'percent', percent: 50 }] }, CATALOG);
  assert.match(long.conflicts.join(' '), /add up to 14 months/);
  const base = { setup: { segment: 'MSP', billing: 'monthly', agreementLength: '24 Months', templateId: '1', expirationDate: '2026-11-05' }, products: [ae()] };
  assert.match(P.validateSubmission(Object.assign({}, base, { ramp: { enabled: true, stages: [{ months: 8 }, { months: 6 }] } })).join(), /add up to 14/);
  assert.match(P.validateSubmission(Object.assign({}, base, { ramp: { enabled: true, stages: [{ months: 1 }, { months: 1 }, { months: 1 }, { months: 1 }, { months: 1 }] } })).join(), /at most 4 ramp stages/);
  assert.deepEqual(P.validateSubmission(Object.assign({}, base, { ramp: { enabled: true, stages: [{ months: 2, mode: 'free' }, { months: 2, mode: 'percent', percent: 50 }] } })), []);
});

test('default ramp length = months past 12 on the agreement', () => {
  assert.deepEqual(['16 Months', '18 Months', '13 Months', '24 Months', '36 Months', '12 Months', '6 Months', '12 Months - Month-to-Month'].map(P.defaultRampMonths), [4, 6, 1, 12, 12, 3, 3, 3]);
});

test('Open quote links: CPQ quotes open in the quote editor; legacy drafts in the edit wizard, published on details', () => {
  assert.equal(P.quoteUrl(2585282, '44013419580', 'CPQ_QUOTE', 'DRAFT'), 'https://app.hubspot.com/quote/2585282/editor/44013419580/content');
  assert.equal(P.quoteUrl(2585282, '1', 'CPQ_QUOTE', 'APPROVAL_NOT_NEEDED'), 'https://app.hubspot.com/quote/2585282/editor/1/content');
  assert.equal(P.quoteUrl(2585282, '2', 'CUSTOMIZABLE_QUOTE_TEMPLATE', 'DRAFT'), 'https://app.hubspot.com/quotes/2585282/edit/2');
  assert.equal(P.quoteUrl(2585282, '3', 'CUSTOMIZABLE_QUOTE_TEMPLATE', 'APPROVAL_NOT_NEEDED'), 'https://app.hubspot.com/quotes/2585282/details/3');
});

// ---------------------------------------------------------------------------
// Optimize365 ramps: only 1–3 free months on top of 12, paid monthly (MSP and Enterprise)
const OPT_CATALOG = P.indexCatalog(RECORDS.concat([
  prod('Optimize365-100-User-Commit', 200, 'optimize365', 'standard', 'MSP', 'monthly', 100),
  prod('Optimize365-100-User-Annual-Commit', 2280, 'optimize365', 'standard', 'MSP', 'annual', 100),
]));
const opt = (over = {}) => Object.assign({ uid: 2, family: 'optimize365', edition: 'standard', quantity: 100, discountPct: 0, ramp: true }, over);
const free = (months) => ({ enabled: true, stages: [{ months, mode: 'free' }] });

test('Optimize365 ramp rule: 13 → 1 free month, 14 → 2, 15 → 3, everything else no ramp', () => {
  const rule = (agreementLength, extra = {}) => P.optimizeRampRule(Object.assign({}, MSP, { agreementLength }, extra));
  assert.deepEqual([rule('13 Months').allowed, rule('13 Months').months], [true, 1]);
  assert.deepEqual([rule('14 Months').allowed, rule('14 Months').months], [true, 2]);
  for (const len of ['12 Months', '16 Months', '24 Months']) assert.equal(rule(len).allowed, false, len);
  assert.deepEqual([rule('15 Months').allowed, rule('15 Months').months], [true, 3]);
  assert.deepEqual([rule('15 Months', { segment: 'ENT' }).allowed, rule('15 Months', { segment: 'ENT' }).months], [true, 3]);
  assert.equal(rule('16 Months').allowed, false);
  assert.match(rule('16 Months').reason, /13, 14 or 15-month agreement paid monthly \(1, 2 or 3 free months on top of 12\)/);
  assert.equal(rule('14 Months', { billing: 'annual' }).allowed, false); // annual SKUs, paid upfront
  assert.equal(rule('14 Months', { paymentFrequency: 'Annual Payments' }).allowed, false); // monthly SKUs paid annually upfront
  assert.match(rule('14 Months', { billing: 'annual' }).reason, /annually upfront/);
  assert.equal(rule('12 Months - Month-to-Month').allowed, false);
});

test('Optimize365 on a 14-month monthly agreement: 2 free months then the 12-month plan', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { agreementLength: '14 Months' }), [opt()], free(2), OPT_CATALOG);
  assert.deepEqual(q.conflicts, []);
  const rampLine = q.lines.find((l) => l.ramp);
  assert.deepEqual([rampLine.termMonths, rampLine.discountPct], [2, 100]);
  assert.equal(q.lines.find((l) => !l.ramp).termMonths, 12);
});

test('Optimize365 on a 15-month monthly agreement: 3 free months then the 12-month plan, MSP and Enterprise', () => {
  const ENT_OPT = P.indexCatalog([prod('Optimize365-100-User-Commit-Monthly-E', 336, 'optimize365', 'standard', 'ENT', 'monthly', 100)]);
  for (const [segment, catalog] of [['MSP', OPT_CATALOG], ['ENT', ENT_OPT]]) {
    const q = P.buildQuote(Object.assign({}, MSP, { segment, agreementLength: '15 Months' }), [opt()], free(3), catalog);
    assert.deepEqual(q.conflicts, [], segment);
    const rampLine = q.lines.find((l) => l.ramp);
    assert.deepEqual([rampLine.termMonths, rampLine.discountPct], [3, 100], segment);
    assert.equal(q.lines.find((l) => !l.ramp).termMonths, 12, segment);
  }
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '15 Months' }), [opt()], free(2), OPT_CATALOG).conflicts[0], /must be 3 free months/);
});

test('Optimize365 ramp is blocked past 15 months, on annual payment, and when the ramp has the wrong shape', () => {
  const build = (setup, ramp) => P.buildQuote(Object.assign({}, MSP, setup), [opt()], ramp, OPT_CATALOG).conflicts;
  assert.match(build({ agreementLength: '16 Months' }, free(4))[0], /Optimize365 can only ramp on a 13, 14 or 15-month/);
  assert.match(build({ agreementLength: '14 Months', paymentFrequency: 'Annual Payments' }, free(2))[0], /annually upfront/);
  assert.match(build({ agreementLength: '14 Months' }, free(1))[0], /must be 2 free months/); // ramp shorter than the extra months
  assert.match(build({ agreementLength: '14 Months' }, { enabled: true, stages: [{ months: 2, mode: 'percent', percent: 50 }] })[0], /100% off/);
  assert.match(build({ agreementLength: '14 Months' }, { enabled: true, stages: [{ months: 1, mode: 'free' }, { months: 1, mode: 'percent', percent: 50 }] })[0], /one stage/);
  // Optimize without its Ramp box ticked is fine at any length; AutoElevate can still ramp longer.
  const q = P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [opt({ ramp: false }), ae()], free(4), OPT_CATALOG);
  assert.deepEqual(q.conflicts, []);
  assert.equal(q.lines.filter((l) => l.ramp).length, 2); // AE lines only
});

// ---------------------------------------------------------------------------
// Per-product ramps
const dnsRow = (over = {}) => Object.assign({ uid: 3, family: 'dns', edition: 'standard', quantity: 500, discountPct: 0, ramp: true }, over);

test('each product has its own ramp: AutoElevate 2 months free, DNS 2 months at 50% off', () => {
  const s = Object.assign({}, MSP, { agreementLength: '14 Months' });
  const q = P.buildQuote(s, [ae({ rampStages: [{ months: 2, mode: 'free' }] }), dnsRow({ rampStages: [{ months: 2, mode: 'percent', percent: 50 }] })], { enabled: true }, CATALOG);
  assert.deepEqual(q.conflicts, []);
  const ramps = q.lines.filter((l) => l.ramp);
  assert.deepEqual(ramps.filter((l) => /AE/.test(l.sku)).map((l) => l.discountPct), [100, 100]);
  assert.deepEqual(ramps.filter((l) => /DNS/.test(l.sku)).map((l) => l.discountPct), [50]);
  assert.ok(q.lines.filter((l) => !l.ramp).every((l) => l.termMonths === 12));
});

test('products can ramp for different lengths; approval uses the longest; each RAMP line carries its own total', () => {
  const s = Object.assign({}, MSP, { agreementLength: '16 Months' });
  const q = P.buildQuote(s, [ae({ rampStages: [{ months: 4, mode: 'free' }] }), dnsRow({ rampStages: [{ months: 2, mode: 'percent', percent: 50 }] })], { enabled: true }, CATALOG);
  assert.deepEqual(q.conflicts, []);
  assert.equal(q.ramp.months, 4);
  assert.equal(q.approval.required, true); // 4-month AE ramp
  const aePlan = q.lines.find((l) => !l.ramp && /AE/.test(l.sku));
  const dnsPlan = q.lines.find((l) => !l.ramp && /DNS/.test(l.sku));
  assert.deepEqual([aePlan.termMonths, aePlan.startMonth, dnsPlan.termMonths, dnsPlan.startMonth], [12, 5, 14, 3]);
  const props = (l) => P.lineItemProperties(l, { billing: 'monthly', sessionId: 's' });
  assert.equal(props(q.lines.find((l) => l.ramp && /AE/.test(l.sku))).approval_ramp_months, '4');
  assert.equal(props(q.lines.find((l) => l.ramp && /DNS/.test(l.sku))).approval_ramp_months, '2');
  // DNS only: a 2-month ramp alone auto-approves.
  assert.equal(P.buildQuote(s, [dnsRow({ rampStages: [{ months: 2, mode: 'free' }] })], { enabled: true }, CATALOG).approval.required, false);
});

test('a product ramp that is too long is reported against that product', () => {
  const s = Object.assign({}, MSP, { agreementLength: '12 Months' });
  const q = P.buildQuote(s, [ae({ rampStages: [{ months: 2, mode: 'free' }] }), dnsRow({ rampStages: [{ months: 12, mode: 'free' }] })], { enabled: true }, CATALOG);
  assert.equal(q.conflicts.length, 1);
  assert.match(q.conflicts[0], /^DNS Filtering: the 12-month ramp is as long as the 12-month Agreement Length/);
});

test('Optimize365 keeps its own 2 free months while AutoElevate ramps 4 on a 14-month agreement', () => {
  const s = Object.assign({}, MSP, { agreementLength: '14 Months' });
  const q = P.buildQuote(s, [ae({ rampStages: [{ months: 4, mode: 'free' }] }), opt({ rampStages: [{ months: 2, mode: 'free' }] })], { enabled: true }, OPT_CATALOG);
  assert.deepEqual(q.conflicts, []);
  const bad = P.buildQuote(s, [opt({ rampStages: [{ months: 2, mode: 'percent', percent: 50 }] })], { enabled: true }, OPT_CATALOG);
  assert.match(bad.conflicts[0], /Optimize365's ramp must be 2 free months/);
});

test('submission checks each product ramp', () => {
  const base = { setup: { segment: 'MSP', billing: 'monthly', agreementLength: '14 Months', templateId: '1', expirationDate: '2026-11-30' } };
  const ok = P.validateSubmission(Object.assign({}, base, { products: [ae({ rampStages: [{ months: 2, mode: 'percent', percent: 50 }] })] }));
  assert.deepEqual(ok, []);
  const bad = P.validateSubmission(Object.assign({}, base, { products: [dnsRow({ rampStages: [{ months: 2, mode: 'percent', percent: 150 }] })] }));
  assert.match(bad.join(' '), /dns: ramp stage percent must be 1–99/);
});

// ---------------------------------------------------------------------------
// One-off SKUs
const oneOffRec = (id, name, sku, price, frequency = 'monthly') => ({ id, properties: { name, hs_sku: sku, hs_price_usd: String(price), hs_folder: 'One-Off SKUs', recurringbillingfrequency: frequency } });
const ONE_OFF_CATALOG = P.indexCatalog(RECORDS.concat([
  oneOffRec('7001', 'Advanced-AE-35000-Agent-Commit-2026', 'AutoElevate 35000 Agent Plan Advanced 2026', 17500),
  oneOffRec('7002', 'Optimize365 4000 User Plan', 'Optimize365-4000-User-Commit', 4800),
  oneOffRec('7003', 'Custom DNS Annual', 'DNS-Custom-Annual', 12000, 'annually'),
  oneOffRec('7004', 'Onboarding Fee', 'ONBOARD-1', 500, ''),
]));
const one = (productId, over = {}) => Object.assign({ uid: 9, family: 'oneoff', productId, quantity: 1, discountPct: 0, ramp: false }, over);

test('one-off SKUs come from their folder, untagged, with the family read from the name/SKU', () => {
  assert.deepEqual(ONE_OFF_CATALOG.issues, []);
  const byId = Object.fromEntries(ONE_OFF_CATALOG.oneOffs.map((o) => [o.id, o]));
  assert.deepEqual([byId['7001'].baseFamily, byId['7001'].baseEdition], ['autoelevate', 'advanced']);
  assert.deepEqual([byId['7002'].baseFamily, byId['7002'].baseEdition], ['optimize365', 'standard']);
  assert.equal(byId['7003'].baseFamily, 'dns');
  assert.equal(byId['7004'].baseFamily, null);
});

test('a one-off SKU prices at its own price × quantity, runs the agreement, and sets AE wording', () => {
  const s = Object.assign({}, MSP, { agreementLength: '12 Months' });
  const q = P.buildQuote(s, [one('7001', { discountPct: 10 })], {}, ONE_OFF_CATALOG);
  assert.deepEqual(q.conflicts, []);
  assert.equal(q.lines.length, 1);
  assert.deepEqual([q.lines[0].productId, q.lines[0].unitPrice, q.lines[0].net, q.lines[0].termMonths], ['7001', 17500, 15750, 12]);
  assert.equal(q.rows[0].label, 'Advanced-AE-35000-Agent-Commit-2026');
  const w = P.dealWrites(q, { setup: s }, OPTIONS).properties;
  assert.equal(w.sku_type, 'Advanced');
  assert.match(w.ae_feature_type_details, /^Elevation, Blocker, and Just-In-Time Admin Login/);
  assert.equal(P.autoQuoteName('Northwind', [one('7001')], 0, ONE_OFF_CATALOG), 'Northwind - AutoElevate');
  // An AE one-off (Advanced) next to a Standard AE row is the same feature-type conflict as two AE rows.
  assert.equal(P.buildQuote(s, [ae({ ramp: false }), one('7001')], {}, ONE_OFF_CATALOG).conflicts.length, 1);
});

test('one-off SKUs: annual products bill annually; unsupported or missing products are blocking errors', () => {
  const s = Object.assign({}, MSP, { agreementLength: '12 Months' });
  const annual = P.buildQuote(s, [one('7003')], {}, ONE_OFF_CATALOG);
  assert.equal(annual.lines[0].annual, true);
  assert.equal(P.lineItemProperties(annual.lines[0], { billing: 'monthly', sessionId: 's' }).recurringbillingfrequency, 'annually');
  assert.match(P.buildQuote(s, [one('7004')], {}, ONE_OFF_CATALOG).blocking[0].error, /one-time charges aren't supported yet/);
  assert.match(P.buildQuote(s, [one('')], {}, ONE_OFF_CATALOG).blocking[0].error, /Pick a one-off SKU/);
  assert.match(P.buildQuote(s, [one('9999')], {}, ONE_OFF_CATALOG).blocking[0].error, /no longer active in the One-Off SKUs folder/);
});

test('one-off SKUs ramp like other products, and an Optimize365 one-off follows the Optimize ramp rule', () => {
  const free2 = { ramp: true, rampStages: [{ months: 2, mode: 'free' }] };
  assert.deepEqual(P.buildQuote(Object.assign({}, MSP, { agreementLength: '14 Months' }), [one('7002', free2)], {}, ONE_OFF_CATALOG).conflicts, []);
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [one('7002', { ramp: true, rampStages: [{ months: 4, mode: 'free' }] })], {}, ONE_OFF_CATALOG).conflicts[0], /Optimize365 can only ramp/);
  const ae4 = P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [one('7001', { ramp: true, rampStages: [{ months: 4, mode: 'free' }] })], {}, ONE_OFF_CATALOG);
  assert.deepEqual(ae4.conflicts, []);
  assert.deepEqual(ae4.lines.map((l) => [l.ramp, l.termMonths, l.discountPct]), [[true, 4, 100], [false, 12, 0]]);
});

// ---------------------------------------------------------------------------
// MSP Optimize365 (Nov 2026): per user or per tenant (5–500 tenant plans), with the volume-priced Optimize TDR
// add-on on per-tenant rows. Enterprise stays per user.
const tagged = (id, name, price, edition, component, tier, segment = 'MSP') => ({ id, properties: { name, hs_sku: name, hs_price_usd: String(price), qb_family: 'optimize365', qb_edition: edition, qb_segment: segment, qb_billing: 'monthly', qb_tier: String(tier), qb_component: component } });
const O365_CATALOG = P.indexCatalog([
  tagged('t5', 'Optimize365 5 Tenant Plan', 250, 'tenant', 'base', 5),
  tagged('t5a', 'Optimize365 5 Tenant Plan Additional Tenants', 50, 'tenant', 'additional', 5),
  tagged('t25', 'Optimize365 25 Tenant Plan', 1125, 'tenant', 'base', 25),
  tagged('t25a', 'Optimize365 25 Tenant Plan Additional Tenants', 45, 'tenant', 'additional', 25),
  tagged('tdr', 'Optimize TDR', 0, 'tdr', 'base', 1),
  tagged('u100', 'Optimize365 100 User Plan', 240, 'standard', 'base', 100),
  tagged('u100a', 'Optimize 365 100 User Plan Additional Users', 2.4, 'standard', 'additional', 100),
  tagged('e1', 'Optimize365 100 User Plan Enterprise Monthly', 336, 'standard', 'base', 100, 'ENT'),
  tagged('e2', 'Optimize 365 100 User Plan Additional Users Enterprise Monthly', 3.36, 'standard', 'additional', 100, 'ENT'),
]);
const o365 = (over = {}) => Object.assign({ uid: 4, family: 'optimize365', edition: 'tenant', quantity: 30, tdrUsers: 6000, discountPct: 10, ramp: false }, over);

test('MSP Optimize365 per tenant: 30 tenants = 25-tenant plan + 5 additional; TDR 6,000 users = one line at $0.85', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { agreementLength: '12 Months' }), [o365()], {}, O365_CATALOG);
  assert.deepEqual(q.conflicts, []);
  assert.deepEqual(q.blocking, []);
  assert.deepEqual(q.lines.map((l) => [l.name, l.quantity, l.unitPrice, l.discountPct]), [
    ['Optimize365 25 Tenant Plan', 1, 1125, 10],
    ['Optimize365 25 Tenant Plan Additional Tenants', 5, 45, 10],
    ['Optimize TDR', 6000, 0.85, 10],
  ]);
  assert.equal(q.totals.mrr, 5805); // (1125 + 225 + 5100) × 0.9
  assert.match(q.rows[0].priced.hint, /25-tenant commit \+ 5 additional tenants for 30 tenants\. TDR: 6,000 users at \$0\.85 \(5,000–7,499 tier\)/);
  // No TDR: tenant lines only.
  assert.equal(P.buildQuote(MSP, [o365({ tdrUsers: 0 })], {}, O365_CATALOG).lines.length, 2);
});

test('Optimize TDR volume tiers: every user at the rate of the tier the total falls into', () => {
  const rate = (n) => (P.tdrTier(n) || {}).price;
  assert.deepEqual([1, 4999, 5000, 7499, 7500, 14999, 15000, 49999, 50000, 250000].map(rate), [1, 1, 0.85, 0.85, 0.7, 0.7, 0.5, 0.5, 0.5, 0.5]);
  assert.equal(P.tdrTier(0), null);
  const line = (n) => P.buildQuote(MSP, [o365({ quantity: 5, tdrUsers: n, discountPct: 0 })], {}, O365_CATALOG).lines.find((l) => l.kind === 'tdr');
  assert.equal(line(4999).gross, 4999);
  assert.equal(line(7500).gross, 5250);
});

test('MSP Optimize365 per user still prices the per-user SKUs and never adds TDR', () => {
  const q = P.buildQuote(MSP, [o365({ edition: 'standard', quantity: 120, tdrUsers: 500 })], {}, O365_CATALOG);
  assert.deepEqual(q.lines.map((l) => [l.name, l.quantity]), [['Optimize365 100 User Plan', 1], ['Optimize 365 100 User Plan Additional Users', 20]]);
  assert.match(q.rows[0].priced.hint, /100-user commit \+ 20 additional users/);
});

test('Optimize TDR missing from the catalog is a clear blocking error (until tag-products runs)', () => {
  const noTdr = P.indexCatalog([tagged('t5', 'Optimize365 5 Tenant Plan', 250, 'tenant', 'base', 5)]);
  assert.match(P.buildQuote(MSP, [o365({ quantity: 5, tdrUsers: 10 })], {}, noTdr).blocking[0].error, /Optimize TDR product isn't available/);
  assert.deepEqual(P.buildQuote(MSP, [o365({ quantity: 5, tdrUsers: 0 })], {}, noTdr).blocking, []);
});

test('MSP Optimize365 ramp (Optimize rule) covers the TDR line too; per tenant is MSP only; Enterprise stays per user', () => {
  const q = P.buildQuote(Object.assign({}, MSP, { agreementLength: '14 Months' }), [o365({ ramp: true, rampStages: [{ months: 2, mode: 'free' }] })], {}, O365_CATALOG);
  assert.deepEqual(q.conflicts, []);
  assert.deepEqual(q.lines.filter((l) => l.ramp).map((l) => [l.name.replace(/^RAMP /, ''), l.termMonths, l.discountPct]), [
    ['Optimize365 25 Tenant Plan', 2, 100],
    ['Optimize365 25 Tenant Plan Additional Tenants', 2, 100],
    ['Optimize TDR', 2, 100],
  ]);
  assert.match(P.buildQuote(Object.assign({}, MSP, { agreementLength: '16 Months' }), [o365({ ramp: true, rampStages: [{ months: 4, mode: 'free' }] })], {}, O365_CATALOG).conflicts[0], /Optimize365 can only ramp/);
  const ENT = Object.assign({}, MSP, { segment: 'ENT' });
  assert.match(P.buildQuote(ENT, [o365()], {}, O365_CATALOG).blocking[0].error, /per tenant is MSP only/);
  const ent = P.buildQuote(ENT, [o365({ edition: 'standard', quantity: 120 })], {}, O365_CATALOG);
  assert.deepEqual(ent.lines.map((l) => [l.name, l.quantity]), [['Optimize365 100 User Plan Enterprise Monthly', 1], ['Optimize 365 100 User Plan Additional Users Enterprise Monthly', 20]]);
  assert.deepEqual(P.editionsFor('optimize365', 'ENT').map((e) => e.value), ['standard']);
  assert.deepEqual(P.editionsFor('optimize365', 'MSP').map((e) => e.label), ['Per user', 'Per tenant']);
});

// ---------------------------------------------------------------------------
// Currency: quotes are priced in the deal's currency from hs_price_<currency>.
const cadProd = (sku, usd, cad, tier, component = 'base', family = 'autoelevate', edition = 'standard') => ({
  id: sku,
  properties: Object.assign({ name: sku, hs_sku: sku, hs_price_usd: String(usd), qb_family: family, qb_edition: edition, qb_segment: 'MSP', qb_billing: 'monthly', qb_tier: String(tier), qb_component: component }, cad == null ? {} : { hs_price_cad: String(cad) }),
});
const CAD_RECORDS = [
  cadProd('AE-1000', 1050, 1390, 1000),
  cadProd('AE-1000-Add', 1.05, 1.39, 1000, 'additional'),
  cadProd('DNS-500', 300, null, 500, 'base', 'dns'),
  cadProd('Optimize365 5 Tenant Plan', 250, 340, 5, 'base', 'optimize365', 'tenant'),
  cadProd('Optimize TDR', '', null, 1, 'base', 'optimize365', 'tdr'),
  { id: 'tm', properties: { name: 'Timus SASE - Monthly Minimum', hs_sku: 'Timus SASE - Monthly Minimum', hs_price_usd: '250', qb_family: 'timus', qb_edition: 'advanced', qb_segment: 'MSP', qb_billing: 'monthly', qb_component: 'minimum' } },
  { id: '7009', properties: { name: 'One-off AE', hs_sku: 'AE-1OFF', hs_price_usd: '100', hs_folder: 'One-Off SKUs', recurringbillingfrequency: 'monthly' } },
];
const S12 = Object.assign({}, MSP, { agreementLength: '12 Months' });

test('currency: a CAD catalog prices from hs_price_cad; USD is unchanged', () => {
  const cad = P.indexCatalog(CAD_RECORDS, 'cad');
  assert.equal(cad.currency, 'CAD');
  const q = P.buildQuote(S12, [ae({ quantity: 1250, discountPct: 0, ramp: false })], {}, cad);
  assert.deepEqual(q.blocking, []);
  assert.deepEqual(q.lines.map((l) => [l.sku, l.quantity, l.unitPrice]), [['AE-1000', 1, 1390], ['AE-1000-Add', 250, 1.39]]);
  assert.equal(q.currency, 'CAD');
  const usd = P.buildQuote(S12, [ae({ quantity: 1250, discountPct: 0, ramp: false })], {}, P.indexCatalog(CAD_RECORDS));
  assert.deepEqual(usd.lines.map((l) => l.unitPrice), [1050, 1.05]);
  assert.equal(usd.currency, 'USD');
  assert.equal(P.lineItemProperties(q.lines[0], { billing: 'monthly', sessionId: 's', currency: 'cad' }).hs_line_item_currency_code, 'CAD');
  assert.equal(P.lineItemProperties(q.lines[0], { billing: 'monthly', sessionId: 's' }).hs_line_item_currency_code, 'USD');
});

test('currency: SKUs without a price in the deal currency are blocking errors, never USD', () => {
  const cad = P.indexCatalog(CAD_RECORDS, 'CAD');
  const dns = P.buildQuote(S12, [{ uid: 3, family: 'dns', edition: 'standard', quantity: 500, discountPct: 0, ramp: false }], {}, cad);
  assert.match(dns.blocking[0].error, /No CAD price on DNS-500 in the product library/);
  const oneOff = P.buildQuote(S12, [{ uid: 5, family: 'oneoff', productId: '7009', quantity: 1, discountPct: 0, ramp: false }], {}, cad);
  assert.match(oneOff.blocking[0].error, /No CAD price on AE-1OFF/);
  // Timus: the SKU default needs a CAD price, but a minimum the rep enters (in CAD) is fine.
  const timus = (minimum) => P.buildQuote(S12, [{ uid: 6, family: 'timus', edition: 'advanced', agreement: 'standard', minimum, gateways: 1, userRate: 5, gatewayRate: 10, quantity: 50, discountPct: 0, ramp: false }], {}, cad);
  assert.match(timus('').blocking[0].error, /No CAD price on Timus SASE - Monthly Minimum.*Or enter the monthly minimum in CAD/);
  assert.deepEqual(timus(400).blocking, []);
  assert.equal(timus(400).lines[0].unitPrice, 400);
  // Optimize TDR tiers are USD only.
  const tdr = (n) => P.buildQuote(S12, [{ uid: 7, family: 'optimize365', edition: 'tenant', quantity: 5, tdrUsers: n, discountPct: 0, ramp: false }], {}, cad);
  assert.match(tdr(100).blocking[0].error, /Optimize TDR tiers are only set in USD/);
  assert.deepEqual(tdr(0).blocking, []);
  assert.equal(tdr(0).lines[0].unitPrice, 340);
});

test('NetSuite auto-split fields: qb_family and qb_line_type (New / Upsell / Co-term) on every line', () => {
  assert.deepEqual(P.activeProducts({ ae_product: 'AE Active', pb_product: 'PB Terminated', dns_product: 'DNS Active', optimize_product: '' }), ['autoelevate', 'dns']);
  assert.deepEqual(P.activeProducts(null), []);
  assert.equal(P.lineTypeFor('autoelevate', false, ['autoelevate']), 'Upsell');
  assert.equal(P.lineTypeFor('autoelevate', true, ['autoelevate']), 'coterm');
  assert.equal(P.lineTypeFor('dns', false, ['autoelevate']), 'New');
  assert.equal(P.lineTypeFor('dns', true, ['autoelevate']), 'New'); // co-term only on a product the company has
  assert.equal(P.lineTypeFor('dns', true, null), 'New'); // company unknown
  assert.equal(P.lineTypeLabel('coterm'), 'Co-term');
  // The deal's own product is never a co-term: on an AutoElevate Upsell deal the AutoElevate line is the upsell.
  assert.equal(P.pipelineFamily('7659799'), 'autoelevate');
  assert.equal(P.pipelineFamily('917642399'), 'optimize365');
  assert.equal(P.pipelineFamily('123'), null);
  assert.equal(P.canCoterm('autoelevate', ['autoelevate'], 'autoelevate'), false);
  assert.equal(P.canCoterm('autoelevate', ['autoelevate'], 'optimize365'), true);
  assert.equal(P.lineTypeFor('autoelevate', true, ['autoelevate'], 'autoelevate'), 'Upsell');
  assert.equal(P.lineTypeFor('autoelevate', true, ['autoelevate'], 'optimize365'), 'coterm');

  const setup = Object.assign({}, MSP, { activeProducts: ['autoelevate'] });
  const dnsRow = { uid: 9, family: 'dns', edition: 'standard', quantity: 600, tier: '', discountPct: 0, ramp: false };
  const q = P.buildQuote(setup, [ae({ coterm: true, ramp: true }), Object.assign({}, dnsRow, { coterm: true })], { enabled: true, months: 3 }, CATALOG);
  const byFamily = (f) => q.lines.filter((l) => l.qbFamily === f);
  assert.ok(byFamily('autoelevate').length > 0 && byFamily('autoelevate').every((l) => l.lineType === 'coterm'));
  assert.ok(byFamily('autoelevate').every((l) => !l.ramp)); // co-term rows never ramp
  assert.ok(byFamily('dns').length > 0 && byFamily('dns').every((l) => l.lineType === 'New'));
  assert.deepEqual(q.rows.map((r) => r.cotermAllowed), [true, false]); // the card shows Co-term on AutoElevate only
  const props = q.lines.map((l) => P.lineItemProperties(l, { billing: 'monthly', rampMonths: 3, sessionId: 's' }));
  assert.ok(props.every((p) => p.qb_family && p.qb_line_type));

  // Upsell without co-term.
  const up = P.buildQuote(setup, [ae()], {}, CATALOG);
  assert.ok(up.lines.every((l) => l.lineType === 'Upsell' && l.qbFamily === 'autoelevate'));
  // No company or no active products: every row is New and none offers Co-term.
  const none = P.buildQuote(MSP, [ae()], {}, CATALOG);
  assert.ok(none.lines.every((l) => l.lineType === 'New') && none.rows.every((r) => !r.cotermAllowed));
});

// ---------------------------------------------------------------------------
// Automatic co-term (Nov 2026)

const COTERM_CATALOG = P.indexCatalog(RECORDS.concat([
  prod('Advanced-AE-100-Agent-Commit-2026', 200, 'autoelevate', 'advanced', 'MSP', 'monthly', 100),
  prod('Advanced-AE-100-Agent-Commit-Additional-Agents+2026', 2, 'autoelevate', 'advanced', 'MSP', 'monthly', 100, 'additional'),
  prod('Advanced-AE-250-Agent-Commit-2026', 450, 'autoelevate', 'advanced', 'MSP', 'monthly', 250),
  prod('Advanced-AE-250-Agent-Commit-Additional-Agents+2026', 1.8, 'autoelevate', 'advanced', 'MSP', 'monthly', 250, 'additional'),
]));
const M2M = { ae_payment_terms: 'Month-to-Month', pb_payment_terms: 'Month-to-Month', dns_payment_terms: 'Month-to-Month', timus_payment_terms: 'Month-to-Month', optimize_payment_terms: 'Month-to-Month' };
const company = (active, commits) => ({ activeProducts: active, commits: Object.assign({}, M2M, commits) });

test('co-term: one row per active product except the deal\'s own, in product order', () => {
  const rows = P.cotermRows(company(['optimize365', 'autoelevate', 'dns'], { ae_agent_commit: '150', ae_sku_type: 'Advanced', dns_device_commit: '600', optimize_user_commit: '40' }), { dealFamily: 'optimize365', segment: 'MSP' });
  assert.deepEqual(rows.map((r) => r.family), ['autoelevate', 'dns']);
  assert.ok(rows.every((r) => r.coterm === true && r.discountPct === 0 && r.ramp === false && r.uid === undefined));
  assert.deepEqual(P.cotermRows(null), []);
  assert.deepEqual(P.cotermRows(company([], {})), []);
});

test('co-term: AutoElevate from AE Agent Commit and AE Feature Type; Grandfathered uses Advanced SKUs', () => {
  for (const [type, want] of [['Standard', 'Standard'], ['Advanced', 'Advanced'], ['Advanced (GrandFathered)', 'Advanced'], ['', 'Standard']]) {
    const [row] = P.cotermRows(company(['autoelevate'], { ae_agent_commit: '150', ae_sku_type: type }), { dealFamily: 'optimize365' });
    assert.equal(row.featureType, want, type);
    assert.equal(row.edition, want === 'Advanced' ? 'advanced' : 'standard');
    assert.equal(row.quantity, 150);
  }
  // 150 agents = the 100-agent plan + 50 additional agents.
  const [row] = P.cotermRows(company(['autoelevate'], { ae_agent_commit: '150', ae_sku_type: 'Advanced (GrandFathered)' }), { dealFamily: 'optimize365' });
  assert.match(row.cotermNote, /AE Agent Commit 150 · AE Feature Type Advanced \(GrandFathered\) → Advanced SKUs/);
  const q = P.buildQuote(Object.assign({}, MSP, { activeProducts: ['autoelevate'], dealFamily: 'optimize365' }), [Object.assign({ uid: 1 }, row)], {}, COTERM_CATALOG);
  assert.deepEqual(q.lines.map((l) => [l.sku, l.quantity, l.lineType]), [['Advanced-AE-100-Agent-Commit-2026', 1, 'coterm'], ['Advanced-AE-100-Agent-Commit-Additional-Agents+2026', 50, 'coterm']]);
  assert.equal(q.aeFeature.type, 'Advanced');
});

test('co-term: the rep can still discount it, and the discount counts toward approval', () => {
  const [row] = P.cotermRows(company(['autoelevate'], { ae_agent_commit: '1250', ae_sku_type: 'Standard' }), { dealFamily: 'dns' });
  const q = P.buildQuote(Object.assign({}, MSP, { activeProducts: ['autoelevate'], dealFamily: 'dns' }), [Object.assign({ uid: 1 }, row, { discountPct: 30 })], {}, CATALOG);
  assert.ok(q.lines.every((l) => l.discountPct === 30 && l.lineType === 'coterm'));
  assert.equal(q.approval.required, true);
});

test('co-term: Password Manager rounds up to whole 2026 User Packs; DNS adds additional devices', () => {
  const rows = P.cotermRows(company(['password', 'dns'], { pb_user_commit: '200', dns_device_commit: '600' }), { dealFamily: 'autoelevate' });
  const q = P.buildQuote(Object.assign({}, MSP, { activeProducts: ['password', 'dns'], dealFamily: 'autoelevate' }), rows.map((r, i) => Object.assign({ uid: i + 1 }, r)), {}, CATALOG);
  const lines = q.lines.map((l) => [l.sku, l.quantity]);
  assert.deepEqual(lines, [['PB-100-User-Pack-2026', 2], ['DNS-500-Device-Commit-2026', 1], ['DNS-500-Device-Commit-Additional-Devices+2026', 100]]);
  assert.equal(rows[0].edition, 'pack');
});

test('co-term: a blank commit asks the rep for the count instead of guessing', () => {
  const [row] = P.cotermRows(company(['password'], { pb_user_commit: null }), { dealFamily: 'autoelevate' });
  assert.equal(row.quantity, 0);
  assert.match(row.cotermNote, /PM User Commit blank/);
  const r = P.priceProduct(Object.assign({ uid: 1 }, row), MSP, CATALOG);
  assert.match(r.error, /no users commit for Password Manager.*ask Ops/);
});

test('co-term: Timus re-signs the Timus Committed MRR as the monthly minimum; rates are optional and not written', () => {
  const [row] = P.cotermRows(company(['timus'], { timus_committed_mrr: '612.5', timus_user_commit: '90' }), { dealFamily: 'autoelevate' });
  assert.equal(row.minimum, 612.5);
  const setup = Object.assign({}, MSP, { activeProducts: ['timus'], dealFamily: 'autoelevate' });
  const q = P.buildQuote(setup, [Object.assign({ uid: 1 }, row)], {}, CATALOG);
  assert.deepEqual(q.blocking, []);
  assert.deepEqual(q.lines.map((l) => [l.sku, l.unitPrice, l.lineType]), [['Timus SASE - Monthly Minimum', 612.5, 'coterm']]);
  assert.match(q.rows[0].priced.hint, /Co-term at a \$612\.50\/mo monthly minimum/);
  const w = P.dealWrites(q, { setup });
  assert.equal(w.properties.timus_price_per_user, undefined); // the Timus deal fields are left alone
  assert.equal(w.properties.new_minimum_commitment_amount, undefined);
  // No Committed MRR on the company: the rep enters the minimum (the SKU price is never assumed).
  const [blank] = P.cotermRows(company(['timus'], { timus_committed_mrr: '' }), { dealFamily: 'autoelevate' });
  assert.match(P.priceProduct(Object.assign({ uid: 1 }, blank), MSP, CATALOG).error, /Timus Committed MRR is blank/);
  assert.equal(P.priceProduct(Object.assign({ uid: 1 }, blank, { minimum: 300 }), MSP, CATALOG).error, '');
});

test('co-term: Optimize365 per tenant when the company has a tenant commit (MSP), else per user', () => {
  const opt = (commits, segment = 'MSP') => P.cotermRows(company(['optimize365'], commits), { dealFamily: 'autoelevate', segment })[0];
  assert.deepEqual([opt({ optimize_user_commit: '40' }).edition, opt({ optimize_user_commit: '40' }).quantity], ['standard', 40]);
  const t = opt({ optimize_user_commit: '40', optimize_tenant_commit: '7' });
  assert.deepEqual([t.edition, t.quantity, t.cotermCounts], ['tenant', 7, { users: 40, tenants: 7 }]);
  assert.match(t.cotermNote, /Optimize Tenant Commit 7 \(Optimize User Commit 40 not used\)/);
  assert.deepEqual([opt({ optimize_tenant_commit: '7' }, 'ENT').edition, opt({ optimize_tenant_commit: '7' }, 'ENT').quantity], ['standard', 0]); // per tenant is MSP only
});

test('co-term: the company properties it reads', () => {
  assert.deepEqual(P.cotermCompanyProperties(), ['ae_agent_commit', 'ae_sku_type', 'ae_payment_terms', 'pb_user_commit', 'pb_payment_terms', 'dns_device_commit', 'dns_payment_terms', 'timus_committed_mrr', 'timus_user_commit', 'timus_payment_terms', 'optimize_user_commit', 'optimize_tenant_commit', 'optimize_payment_terms']);
});

test('co-term: only products paid Month-to-Month; Annual Payments, Quarterly, One Time or blank terms are an Upsell', () => {
  const props = { ae_product: 'AE Active', ae_payment_terms: 'Annual Payments', pb_product: 'PB Active', pb_payment_terms: 'Month-to-Month', dns_product: 'DNS Active', dns_payment_terms: 'Quarterly', timus_product: 'Timus Active', optimize_product: 'Optimize Active', optimize_payment_terms: 'One Time' };
  assert.deepEqual(P.cotermProducts(props), ['password']);
  assert.deepEqual(P.cotermProducts(null), []);
  // Rows: only Password Manager is added (from loadDeal's list, or worked out from the commits).
  const fromList = P.cotermRows({ activeProducts: ['autoelevate', 'password', 'dns', 'timus', 'optimize365'], cotermProducts: ['password'], commits: {} }, { dealFamily: 'autoelevate' });
  assert.deepEqual(fromList.map((r) => r.family), ['password']);
  const worked = P.cotermRows({ activeProducts: ['autoelevate', 'password', 'dns', 'timus', 'optimize365'], commits: props }, { dealFamily: 'timus' });
  assert.deepEqual(worked.map((r) => r.family), ['password']);
  // An annual AutoElevate partner on an Optimize deal: a co-term row (an older saved quote) counts as an Upsell.
  const setup = Object.assign({}, MSP, { activeProducts: ['autoelevate'], cotermProducts: [], dealFamily: 'optimize365' });
  const q = P.buildQuote(setup, [ae({ coterm: true, ramp: false })], {}, CATALOG);
  assert.ok(q.lines.every((l) => l.lineType === 'Upsell') && !q.rows[0].cotermAllowed);
  // Month-to-Month: co-term.
  const ok = P.buildQuote(Object.assign({}, setup, { cotermProducts: ['autoelevate'] }), [ae({ coterm: true, ramp: false })], {}, CATALOG);
  assert.ok(ok.lines.every((l) => l.lineType === 'coterm'));
  assert.equal(P.lineTypeFor('autoelevate', true, ['autoelevate'], null, []), 'Upsell');
});
