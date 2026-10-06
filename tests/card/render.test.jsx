import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '@hubspot/ui-extensions/testing';
import { Alert, Button, Checkbox, DescriptionListItem, NumberInput, Select, StepIndicator, Tag, StatisticsItem, Table, TableRow } from '@hubspot/ui-extensions';
import { QuoteBuilderApp } from '../../src/app/cards/QuoteBuilderApp.jsx';

// The platform exposes hubspot.serverless via a worker global; route it to the renderer's mock.
let current;
globalThis.self = globalThis;
globalThis.serverless = (name, options) => current.mocks.runServerlessFunction(Object.assign({ name }, options));
const mk = () => (current = createRenderer('crm.record.tab'));
let id = 1;
const prod = (sku, price, family, edition, segment, billing, tier, component = 'base') => ({ id: String(id++), properties: { name: sku, hs_sku: sku, hs_price_usd: String(price), qb_family: family, qb_edition: edition, qb_segment: segment, qb_billing: billing, qb_tier: tier == null ? '' : String(tier), qb_component: component } });
const CATALOG_RESPONSE = {
  ok: true,
  products: [
    prod('Standard-AE-1000-Agent-Commit-2026', 1050, 'autoelevate', 'standard', 'MSP', 'monthly', 1000),
    prod('Standard-AE-1000-Agent-Commit-Additional-Agents+2026', 1.05, 'autoelevate', 'standard', 'MSP', 'monthly', 1000, 'additional'),
    prod('Standard-AE-1500-Agent-Commit-2026', 1470, 'autoelevate', 'standard', 'MSP', 'monthly', 1500),
    prod('Standard-AE-1500-Agent-Commit-Additional-Agents+2026', 0.98, 'autoelevate', 'standard', 'MSP', 'monthly', 1500, 'additional'),
    prod('DNS-500-Device-Commit-2026', 300, 'dns', 'standard', 'MSP', 'monthly', 500),
    prod('DNS-500-Device-Commit-Additional-Devices+2026', 0.6, 'dns', 'standard', 'MSP', 'monthly', 500, 'additional'),
  ],
  templates: [{ id: '10', name: 'AutoElevate', templateType: 'CPQ_QUOTE', families: ['autoelevate'] }, { id: '11', name: 'PB / DNS', templateType: 'CUSTOMIZABLE_QUOTE_TEMPLATE', families: ['password', 'dns'] }],
  timusLists: [],
  deal: { id: '123', properties: { promo: '' }, salesTeam: 'MSP', company: { id: '9', name: 'Example MSP' }, contacts: [{ id: '501', label: 'Sample Contact — Owner' }], quoteCount: 0 },
  issues: [],
  dealOptions: {
    agreement_length: ['12 Months - Month-to-Month', '12 Months', '15 Months'].map((v) => ({ value: v, label: v })),
    payment_terms: [{ value: 'Month-to-Month', label: 'Monthly' }, { value: 'Quarterly', label: 'Quarterly' }, { value: 'Annual Payments', label: 'Annual Payments' }, { value: 'One Time', label: 'One Time' }],
    payment_method: [{ value: 'Credit Card', label: 'Credit Card' }, { value: 'ACH', label: 'ACH' }],
    invoice_terms: [{ value: 'Net-30', label: 'Net-30' }],
    promo: [],
    sku_type: ['Advanced', 'Standard', 'Advanced (GrandFathered)'].map((v) => ({ value: v, label: v })),
  },
};

const text = (node) => node.toString();

test('card renders, prices AutoElevate, ramps, and submits', async () => {
  const r = mk();
  const calls = [];
  r.mocks.runServerlessFunction.willCall(async (params) => {
    calls.push(params);
    if (params.name === 'quote_builder_catalog') return { status: 'SUCCESS', response: CATALOG_RESPONSE };
    return { status: 'SUCCESS', response: { ok: true, quoteId: '777', quoteUrl: 'https://app.hubspot.com/quotes/123/details/777', title: 'Example MSP - AutoElevate + 3 Month Ramp', lineCount: 4, replaced: 0, approval: { required: true, manual: false, approver: 'Tina Kalke (MSP Sales Manager)', reasons: [] } } };
  });
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  assert.equal(calls[0].name, 'quote_builder_catalog');
  assert.deepEqual(calls[0].parameters, { dealId: '123' });

  const cont = () => r.find(Button, (n) => /Continue/.test(text(n)));
  // Quote-token fields live on Setup; Contract Term is gone.
  assert.equal(r.maybeFind(Select, { name: 'term' }), null);
  assert.equal(r.find(Select, { name: 'agreementLength' }).props.value, '12 Months');
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '15 Months');
  cont().trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));

  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(NumberInput, { name: 'qty-1' })));
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 1250);
  r.find(NumberInput, { name: 'disc-1' }).trigger('onChange', 10);
  assert.equal(r.find(Select, { name: 'feature-1' }).props.value, 'Standard');
  assert.deepEqual(r.find(Select, { name: 'feature-1' }).props.options.map((o) => o.value), ['Standard', 'Advanced', 'Advanced (GrandFathered)']);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /\$1,181\.25\/mo/));
  // auto-suggested CPQ template appears in the summary
  assert.match(text(r.getRootNode()), /CPQ template/);

  // Ramp controls are on the same step as the products.
  // Ramp & schedule only appears once a product's Ramp box is ticked.
  assert.equal(r.maybeFind(Select, { name: 'rampMonths' }), null);
  assert.equal(r.find(Checkbox, { name: 'ramp-1' }).text, 'Ramp');
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths' })));
  r.find(Select, { name: 'rampMonths' }).trigger('onChange', 3);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /Needs approval/));
  const stats = r.findAll(StatisticsItem).map((s) => [s.props.label, s.props.number]);
  assert.deepEqual(stats, [['MRR (full plan)', '$1,181.25'], ['First 12 months', '$10,631'], ['Total contract value', '$14,175'], ['Savings vs list', '$5,513']]);

  cont().trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 2));
  assert.match(text(r.getRootNode()), /4 lines · 2 ramp/);
  const token = (label) => r.find(DescriptionListItem, { label }).text;
  assert.equal(token('Agreement Length'), '15 Months');
  assert.equal(token('Payment Frequency'), 'Monthly (Month-to-Month)');
  assert.equal(token('AE Feature Type'), 'Standard');
  assert.match(token('AE Feature Type Details'), /^Elevation\. Additional agents/);
  r.find(Button, (n) => /Create quote/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: 'Draft quote created' })));
  const submit = calls.find((c) => c.name === 'quote_builder_submit');
  assert.equal(submit.parameters.setup.templateId, '10');
  assert.equal(submit.parameters.products[0].quantity, 1250);
  assert.equal(submit.parameters.ramp.months, 3);
  assert.equal(r.mocks.actions.addAlert.callCount, 1);
  assert.equal(r.mocks.actions.addAlert.calls[0][0].type, 'success');
});

test('mixed AE feature types block Continue; payment frequency hides One Time', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: CATALOG_RESPONSE }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  const freq = r.find(Select, { name: 'paymentFrequency' }).props.options.map((o) => o.value);
  assert.deepEqual(freq, ['', 'Month-to-Month', 'Quarterly', 'Annual Payments']);
  assert.deepEqual(r.find(Select, { name: 'agreementLength' }).props.options.map((o) => o.value), ['12 Months - Month-to-Month', '12 Months', '15 Months']);
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'feature-2' })));
  r.find(Select, { name: 'feature-2' }).trigger('onChange', 'Advanced (GrandFathered)');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: 'Fix before continuing' })));
  assert.equal(r.find(Button, (n) => /Continue/.test(text(n))).props.disabled, true);
});

test('quotes on the deal: start a new option from one; it defaults to not primary', async () => {
  const r = mk();
  const saved = {
    v: 1,
    setup: { segment: 'MSP', billing: 'monthly', agreementLength: '12 Months', templateId: '10', paymentMethod: 'ACH', invoiceTerms: 'Net-30', acceptance: 'esignature', signerContactId: '501' },
    products: [{ uid: 7, family: 'autoelevate', edition: 'standard', featureType: 'Standard', quantity: 100, tier: '', discountPct: 0, ramp: false }],
    ramp: { months: 3, mode: 'free', percent: 50 },
    notes: '',
    dealProperties: { agreement_length: '12 Months' },
  };
  const deal = Object.assign({}, CATALOG_RESPONSE.deal, {
    quotes: [{ id: 'Q1', title: 'Example MSP - AutoElevate (100)', progressionStatus: 'PUBLISHED', lock: 'locked', amount: 216, builder: true, primary: true, state: saved }],
  });
  const calls = [];
  r.mocks.runServerlessFunction.willCall(async (params) => {
    calls.push(params);
    if (params.name === 'quote_builder_catalog') return { status: 'SUCCESS', response: Object.assign({}, CATALOG_RESPONSE, { deal }) };
    return { status: 'SUCCESS', response: { ok: true, quoteId: 'Q2', quoteUrl: 'u', title: 't', lineCount: 2, primary: false, approval: { required: false, reasons: [] } } };
  });
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(Button, (n) => /New option from this/.test(text(n)))));
  assert.match(text(r.getRootNode()), /Primary/);
  r.find(Button, (n) => /New option from this/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  assert.equal(r.find(NumberInput, { name: 'qty-1' }).props.value, 100);
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 250);
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 2));
  assert.equal(r.find(Checkbox, { name: 'primary' }).props.checked, false);
  r.find(Button, (n) => /Create quote/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: 'Draft quote created' })));
  const submit = calls.find((c) => c.name === 'quote_builder_submit');
  assert.equal(submit.parameters.primary, false);
  assert.equal(submit.parameters.products[0].quantity, 250);
  assert.ok(r.maybeFind(Button, (n) => /Build another option/.test(text(n))));
});

test('wrong billing for a product blocks Continue', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: CATALOG_RESPONSE }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Select, { name: 'billing' }).trigger('onChange', 'annual');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ DNS Filtering/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: "Can't price this product" })));
  assert.equal(r.find(Button, (n) => /Continue/.test(text(n))).props.disabled, true);
});

test('catalog failure shows an error state with retry', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: { ok: false, errors: ['HubSpot GET /crm/v3/objects/quote_templates failed (403)'] } }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /couldn't load/));
  assert.match(text(r.getRootNode()), /403/);
});
