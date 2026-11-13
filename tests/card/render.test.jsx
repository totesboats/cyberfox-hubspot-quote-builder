import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer } from '@hubspot/ui-extensions/testing';
import { Alert, Button, Checkbox, DescriptionListItem, Input, NumberInput, Select, StepIndicator, Tag, StatisticsItem, Table, TableRow } from '@hubspot/ui-extensions';
import { QuoteBuilderApp, reducer, initialState } from '../../src/app/cards/QuoteBuilderApp.jsx';

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
  deal: { id: '123', properties: { promo: '', invoice_terms: 'Net-30' }, salesTeam: 'MSP', owner: { id: '77', name: 'Riley Rep', email: 'riley.rep@example.com' }, company: { id: '9', name: 'Example MSP' }, contacts: [{ id: '501', label: 'Sample Contact — Owner' }], quoteCount: 0 },
  issues: [],
  dealOptions: {
    agreement_length: ['12 Months - Month-to-Month', '12 Months', '15 Months', '16 Months', '18 Months', '24 Months'].map((v) => ({ value: v, label: v })),
    payment_terms: [{ value: 'Month-to-Month', label: 'Monthly' }, { value: 'Quarterly', label: 'Quarterly' }, { value: 'Annual Payments', label: 'Annual Payments' }, { value: 'One Time', label: 'One Time' }],
    payment_method: [{ value: 'Credit Card', label: 'Credit Card' }, { value: 'ACH', label: 'ACH' }],
    invoice_terms: [{ value: 'Due Upon Receipt', label: 'Due Upon Receipt' }, { value: 'Net-30', label: 'Net-30' }],
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
    return { status: 'SUCCESS', response: { ok: true, quoteId: '777', quoteUrl: 'https://app.hubspot.com/quote/123/editor/777/content', title: 'Example MSP - AutoElevate + 3 Month Ramp', lineCount: 4, replaced: 0, approval: { required: true, manual: false, approver: 'Tina Harvey (MSP Sales Manager)', reasons: [] } } };
  });
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  assert.equal(calls[0].name, 'quote_builder_catalog');
  assert.deepEqual(calls[0].parameters, { dealId: '123' });

  const cont = () => r.find(Button, (n) => /Continue/.test(text(n)));
  // Quote-token fields live on Setup; Contract Term is gone.
  assert.equal(r.maybeFind(Select, { name: 'term' }), null);
  assert.equal(r.find(Select, { name: 'agreementLength' }).props.value, '12 Months');
  assert.equal(r.find(Input, { name: 'seller' }).props.value, 'fake_firstName fake_lastName · fake_email@example.com'); // whoever builds the quote
  assert.equal(r.find(Select, { name: 'segment' }).props.value, 'MSP');
  // Printed fields other than Agreement Length show as one read-only line until Edit.
  // Invoice Terms always starts at Due Upon Receipt, even though the deal holds Net-30.
  assert.equal(r.maybeFind(Select, { name: 'invoiceTerms' }), null);
  assert.equal(r.find(DescriptionListItem, { label: 'Invoice Terms' }).text, 'Due Upon Receipt');
  assert.equal(r.find(DescriptionListItem, { label: 'Payment Frequency' }).text, 'Monthly (matches SKU pricing)');
  assert.equal(r.find(DescriptionListItem, { label: 'Payment Method' }).text, 'Credit Card');
  assert.equal(r.maybeFind(DescriptionListItem, { label: 'Promo' }), null); // Promo was removed from Setup
  r.find(Button, (n) => /"Edit"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'invoiceTerms' })));
  assert.equal(r.find(Select, { name: 'invoiceTerms' }).props.value, 'Due Upon Receipt');
  assert.ok(r.maybeFind(Button, (n) => /"Done"/.test(text(n))));
  // Nothing priced yet: the summary is one compact line, not four $0 figures.
  assert.equal(r.findAll(StatisticsItem).length, 0);
  assert.match(text(r.getRootNode()), /Totals and approval show here once you add products/);
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '15 Months');
  cont().trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));

  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(NumberInput, { name: 'qty-1' })));
  assert.equal(r.find(Select, { name: 'tier-1' }).props.value, '__none__');
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 1250);
  r.find(NumberInput, { name: 'disc-1' }).trigger('onChange', 10);
  assert.equal(r.find(Select, { name: 'feature-1' }).props.value, 'Standard');
  assert.deepEqual(r.find(Select, { name: 'feature-1' }).props.options.map((o) => o.value), ['Standard', 'Advanced']); // Advanced (GrandFathered) retired
  await r.waitFor(() => assert.match(text(r.getRootNode()), /\$1,181\.25\/mo/));
  // auto-suggested CPQ template appears in the summary
  assert.match(text(r.getRootNode()), /CPQ template/);

  // Ramp controls are on the same step as the products.
  // Ramp & schedule only appears once a product's Ramp box is ticked.
  assert.equal(r.maybeFind(Select, { name: 'rampMonths-1-1' }), null);
  assert.equal(r.find(Checkbox, { name: 'ramp-1' }).text, 'Ramp');
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths-1-1' })));
  r.find(Select, { name: 'rampMonths-1-1' }).trigger('onChange', 3);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /Auto-approves/)); // 3 months is under the 4+ month rule
  const stats = r.findAll(StatisticsItem).map((s) => [s.props.label, s.props.number]);
  assert.deepEqual(stats, [['MRR (full plan)', '$1,181.25'], ['First 12 months', '$10,631'], ['Total contract value', '$14,175'], ['Savings vs list', '$5,513']]);

  cont().trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 2));
  assert.match(text(r.getRootNode()), /4 lines · 2 ramp/);
  assert.match(text(r.getRootNode()), /Quote summary/);
  assert.doesNotMatch(text(r.getRootNode()), /What Create quote writes|Approval Discount %|Notes for approvers/);
  assert.equal(r.find(DescriptionListItem, { label: 'Line items' }).text, '4 (2 ramp)');
  const token = (label) => r.find(DescriptionListItem, { label }).text;
  assert.equal(token('Agreement Length'), '15 Months');
  assert.equal(token('Payment Frequency'), 'Monthly (Month-to-Month)');
  assert.equal(token('AE Feature Type'), 'Standard');
  assert.match(token('AE Feature Type Details'), /^Elevation\. Additional agents/);
  r.find(Button, (n) => /Create quote/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: 'Draft quote created' })));
  // The success message says to refresh (the deal's Quotes card only shows the new quote after a reload).
  assert.equal(r.maybeFind(Button, (n) => /Open quote in HubSpot/.test(text(n))), null);
  assert.match(text(r.getRootNode()), /Refresh the page and the quote will appear in the Quotes card/);
  const refresh = r.find(Button, (n) => /Refresh page/.test(text(n)));
  assert.equal(refresh.props.variant, 'primary');
  refresh.trigger('onClick');
  assert.equal(r.mocks.actions.reloadPage.callCount, 1);
  assert.match(text(r.getRootNode()), /rename the quote/); // approval needed → "Saving…" workaround tip
  const submit = calls.find((c) => c.name === 'quote_builder_submit');
  assert.equal(submit.parameters.setup.templateId, '10');
  assert.equal(submit.parameters.products[0].quantity, 1250);
  assert.equal(submit.parameters.products[0].rampStages[0].months, 3);
  assert.equal(submit.parameters.builder.email, 'fake_email@example.com');
  assert.equal(r.mocks.actions.addAlert.callCount, 1);
  assert.equal(r.mocks.actions.addAlert.calls[0][0].type, 'success');
});

test('mixed AE feature types block Continue; payment frequency hides One Time', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: CATALOG_RESPONSE }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /"Edit"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'paymentFrequency' })));
  const freq = r.find(Select, { name: 'paymentFrequency' }).props.options.map((o) => o.value);
  assert.deepEqual(freq, ['__none__', 'Month-to-Month', 'Quarterly', 'Annual Payments']);
  // Blank choices show their label ("None", "Match SKU pricing"), not HubSpot's empty "Select" placeholder.
  assert.equal(r.maybeFind(Select, { name: 'promo' }), null); // Promo was removed from Setup
  assert.equal(r.find(Select, { name: 'paymentFrequency' }).props.value, '__none__');
  assert.deepEqual(r.find(Select, { name: 'agreementLength' }).props.options.map((o) => o.value), ['12 Months - Month-to-Month', '12 Months', '15 Months', '16 Months', '18 Months', '24 Months']);
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'feature-2' })));
  r.find(Select, { name: 'feature-2' }).trigger('onChange', 'Advanced');
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

test('SKU pricing offers Month-to-Month, Annual (billed monthly), Annual (billed yearly) and moves with Agreement Length', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: CATALOG_RESPONSE }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  const billing = () => r.find(Select, { name: 'billing' });
  const agreement = () => r.find(Select, { name: 'agreementLength' });
  assert.deepEqual(billing().props.options.map((o) => [o.value, o.label]), [['m2m', 'Month-to-Month'], ['monthly', 'Annual (billed monthly)'], ['annual', 'Annual (billed yearly)']]);
  assert.equal(billing().props.value, 'monthly');
  assert.equal(billing().props.readOnly, undefined);
  // Month-to-Month pricing sets the Month-to-Month agreement…
  billing().trigger('onChange', 'm2m');
  await r.waitFor(() => assert.equal(agreement().props.value, '12 Months - Month-to-Month'));
  assert.equal(billing().props.value, 'm2m');
  // …and back to Annual (billed yearly) puts the agreement back to 12 Months.
  billing().trigger('onChange', 'annual');
  await r.waitFor(() => assert.equal(agreement().props.value, '12 Months'));
  assert.equal(billing().props.value, 'annual');
  // Picking the Month-to-Month agreement switches SKU pricing to Month-to-Month.
  agreement().trigger('onChange', '12 Months - Month-to-Month');
  await r.waitFor(() => assert.equal(billing().props.value, 'm2m'));
});

test('catalog failure shows an error state with retry', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: { ok: false, errors: ['HubSpot GET /crm/v3/objects/quote_templates failed (403)'] } }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /couldn't load/));
  assert.match(text(r.getRootNode()), /403/);
});

test('Timus: rep enters per-user and per-gateway prices; they print as deal tokens', async () => {
  const r = mk();
  const timusCatalog = Object.assign({}, CATALOG_RESPONSE, {
    products: CATALOG_RESPONSE.products.concat([
      prod('Timus SASE - Monthly Minimum', 250, 'timus', 'advanced', 'MSP', 'monthly', null, 'minimum'),
      prod('Timus SASE - SATGAT', 250, 'timus', 'advanced', 'MSP', 'monthly', 250, 'satgat'),
      prod('Timus SASE - SATGAT II', 500, 'timus', 'advanced', 'MSP', 'monthly', 500, 'satgat'),
    ]),
  });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: timusCatalog }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ Timus SASE/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(NumberInput, { name: 'rate-1' })));
  assert.equal(r.maybeFind(Select, { name: 'pl-1' }), null); // no price list picker
  assert.equal(r.find(NumberInput, { name: 'rate-1' }).props.label, 'Timus Price Per User');
  assert.equal(r.find(NumberInput, { name: 'gwrate-1' }).props.label, 'Timus Price Per Gateway');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: "Can't price this product" })));

  r.find(NumberInput, { name: 'rate-1' }).trigger('onChange', 4.5);
  r.find(NumberInput, { name: 'gwrate-1' }).trigger('onChange', 50);
  r.find(NumberInput, { name: 'min-1' }).trigger('onChange', 500);
  await r.waitFor(() => assert.equal(r.maybeFind(Alert, { title: "Can't price this product" }), null));
  assert.match(text(r.getRootNode()), /\$500\.00\/mo/);

  r.find(Select, { name: 'ag-1' }).trigger('onChange', 'satgat');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'sat-1' })));
  assert.deepEqual(r.find(Select, { name: 'sat-1' }).props.options.map((o) => o.value), ['250', '500']);
  r.find(Select, { name: 'sat-1' }).trigger('onChange', '500');

  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 2));
  const token = (label) => r.find(DescriptionListItem, { label }).text;
  assert.equal(token('Timus Price Per User'), '4.50');
  assert.equal(token('Timus Price Per Gateway'), '50.00');
  assert.equal(token('Timus New Minimum Commitment Amount'), '500');
  assert.equal(r.maybeFind(DescriptionListItem, { label: 'Timus Price List' }), null);
});

test('remove a product, untick Ramp, Remove ramp clears every Ramp box', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: CATALOG_RESPONSE }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  r.find(Button, (n) => /\+ DNS Filtering/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-2' })));
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  r.find(Checkbox, { name: 'ramp-2' }).trigger('onChange', true);
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths-1-1' })));
  r.find(Checkbox, { name: 'ramp-2' }).trigger('onChange', false);
  await r.waitFor(() => assert.equal(r.find(Checkbox, { name: 'ramp-2' }).props.checked, false));
  r.find(Button, (n) => /"Remove all ramps"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.maybeFind(Select, { name: 'rampMonths-1-1' }), null));
  assert.equal(r.find(Checkbox, { name: 'ramp-1' }).props.checked, false);
  const removes = () => r.findAll(Button, (n) => /"Remove"/.test(text(n)));
  assert.equal(removes().length, 2);
  removes()[0].trigger('onClick');
  await r.waitFor(() => assert.equal(removes().length, 1));
  assert.equal(r.maybeFind(Checkbox, { name: 'ramp-1' }), null);
  assert.ok(r.maybeFind(Checkbox, { name: 'ramp-2' }));
});

test('edit an existing draft quote in place; ramp goes up to 12 months', async () => {
  const r = mk();
  const saved = {
    v: 1,
    setup: { segment: 'MSP', billing: 'monthly', agreementLength: '15 Months', templateId: '10', paymentMethod: 'ACH', invoiceTerms: 'Net-30', acceptance: 'esignature', signerContactId: '501', expirationDate: '2026-11-20' },
    products: [{ uid: 4, family: 'autoelevate', edition: 'standard', featureType: 'Standard', quantity: 100, tier: '', discountPct: 0, ramp: true }],
    ramp: { months: 9, mode: 'free', percent: 50 },
    notes: '',
    dealProperties: { agreement_length: '15 Months' },
  };
  const deal = Object.assign({}, CATALOG_RESPONSE.deal, {
    quotes: [
      { id: 'Q5', title: 'Example MSP - AutoElevate + 9 Month Ramp', progressionStatus: 'DRAFT', lock: 'open', amount: 216, builder: true, primary: true, state: saved, expirationDate: '2026-11-20' },
      { id: 'Q6', title: 'Example MSP - Published', progressionStatus: 'PUBLISHED', lock: 'locked', amount: 216, builder: true, primary: false, state: saved },
    ],
  });
  const calls = [];
  r.mocks.runServerlessFunction.willCall(async (params) => {
    calls.push(params);
    if (params.name === 'quote_builder_catalog') return { status: 'SUCCESS', response: Object.assign({}, CATALOG_RESPONSE, { deal }) };
    return { status: 'SUCCESS', response: { ok: true, edited: true, quoteId: 'Q5', quoteUrl: 'u', title: 'Example MSP - AutoElevate + 9 Month Ramp', lineCount: 3, primary: true, approval: { required: true, reasons: [] } } };
  });
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(Button, (n) => /"Edit quote"/.test(text(n)))));
  assert.equal(r.findAll(Button, (n) => /"Edit quote"/.test(text(n))).length, 1); // only the draft
  assert.match(text(r.getRootNode()), /Published quotes are locked/);
  r.find(Button, (n) => /"Edit quote"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, (n) => /Editing Example MSP/.test(n.props.title))));
  assert.equal(r.find(Input, { name: 'quoteName' }).props.value, 'Example MSP - AutoElevate + 9 Month Ramp');
  assert.equal(r.find(Select, { name: 'agreementLength' }).props.value, '15 Months');

  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths-1-1' })));
  assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.options.length, 12);
  assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 9);
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 1250);
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Button, (n) => /"Update quote"/.test(text(n)))));
  assert.equal(r.maybeFind(Checkbox, { name: 'primary' }), null);
  r.find(Button, (n) => /"Update quote"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Alert, { title: 'Quote updated' })));
  const submit = calls.find((c) => c.name === 'quote_builder_submit');
  assert.equal(submit.parameters.editQuoteId, 'Q5');
  assert.equal(submit.parameters.products[0].quantity, 1250);
  assert.equal(submit.parameters.products[0].rampStages[0].months, 9);
});

test('multi-stage ramp: add a 50% stage after 2 free months; schedule shows both stages', async () => {
  const r = mk();
  const calls = [];
  r.mocks.runServerlessFunction.willCall(async (params) => {
    calls.push(params);
    return { status: 'SUCCESS', response: CATALOG_RESPONSE };
  });
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '15 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-1' })));
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths-1-1' })));
  r.find(Select, { name: 'rampMonths-1-1' }).trigger('onChange', 2);
  r.find(Button, (n) => /"\+ Add ramp stage"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths-1-2' })));
  // Setup's printed fields are shown read-only on this step
  const ref = (label) => r.find(DescriptionListItem, { label }).text;
  assert.equal(ref('Agreement Length'), '15 Months');
  assert.equal(ref('Payment Frequency'), 'Monthly');
  assert.equal(r.maybeFind(DescriptionListItem, { label: 'Promo' }), null);
  assert.equal(r.maybeFind(Select, { name: 'paymentMethod' }), null); // not editable here
  assert.equal(r.find(Select, { name: 'rampMode-1-2' }).props.value, 'percent');
  assert.equal(r.find(NumberInput, { name: 'rampPercent-1-2' }).props.value, 50);
  r.find(Select, { name: 'rampMonths-1-2' }).trigger('onChange', 2);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /"Ramp 2"/));
  const root = text(r.getRootNode());
  assert.match(root, /"Ramp 1"/);
  assert.match(root, /"1–2"/);
  assert.match(root, /"3–4"/);
  assert.match(root, /"5–15"/);
  assert.match(root, /Ramp: 4 months \(2 mo free, then 2 mo 50% off\); plan bills months 5–15/);
  // Removing stage 2 goes back to a single stage
  r.findAll(Button, (n) => /"Remove stage"/.test(text(n)))[1].trigger('onClick');
  await r.waitFor(() => assert.equal(r.maybeFind(Select, { name: 'rampMonths-1-2' }), null));
  r.find(Button, (n) => /"Change on Setup"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 0));
});

test('ramp defaults to the months past 12 and follows Agreement Length; Bundles cannot be added', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: CATALOG_RESPONSE }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '16 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  assert.equal(r.maybeFind(Button, (n) => /CyberFOX Bundle/.test(text(n))), null);
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-1' })));
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  await r.waitFor(() => assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 4));
  // Change the agreement to 18 months: an untouched default ramp follows (6 months)
  r.find(Button, (n) => /"Change on Setup"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 0));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '18 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 6));
  // A ramp length the rep picked is left alone
  r.find(Select, { name: 'rampMonths-1-1' }).trigger('onChange', 2);
  r.find(Button, (n) => /"Change on Setup"/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 0));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '24 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 2));
});

test('Optimize365 Ramp box is locked on agreements past 15 months', async () => {
  const r = mk();
  const withOptimize = Object.assign({}, CATALOG_RESPONSE, {
    products: CATALOG_RESPONSE.products.concat([prod('Optimize365-100-User-Commit', 200, 'optimize365', 'standard', 'MSP', 'monthly', 100)]),
  });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: withOptimize }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  const cont = () => r.find(Button, (n) => /Continue/.test(text(n)));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '16 Months');
  cont().trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ Optimize365/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-1' })));
  // 16 months: Optimize can't ramp, so its Ramp box is locked and says why.
  assert.equal(r.find(Checkbox, { name: 'ramp-1' }).props.readOnly, true);
  assert.match(r.find(Checkbox, { name: 'ramp-1' }).props.description, /13, 14 or 15-month agreement paid monthly/);

  r.find(StepIndicator).trigger('onClick', 0);
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 0));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '24 Months');
  cont().trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  assert.equal(r.find(Checkbox, { name: 'ramp-1' }).props.readOnly, true);
});

test('Optimize365 ramp on a 14-month agreement is 2 free months, one stage, locked', async () => {
  const r = mk();
  const withOptimize = Object.assign({}, CATALOG_RESPONSE, {
    products: CATALOG_RESPONSE.products.concat([prod('Optimize365-100-User-Commit', 200, 'optimize365', 'standard', 'MSP', 'monthly', 100)]),
  });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: withOptimize }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '16 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  // AutoElevate ramps 4 months on a 16-month agreement; Optimize can't join that ramp.
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  r.find(Button, (n) => /\+ Optimize365/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-2' })));
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 1250);
  r.find(NumberInput, { name: 'qty-2' }).trigger('onChange', 100);
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  await r.waitFor(() => assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 4));
  assert.equal(r.find(Checkbox, { name: 'ramp-2' }).props.readOnly, true); // Optimize can't join a 16-month ramp

  r.find(StepIndicator).trigger('onClick', 0);
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 0));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '14 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Checkbox, { name: 'ramp-2' }).trigger('onChange', true);
  // Optimize (product 2) has its own ramp, locked at 2 free months; AutoElevate's followed the agreement to 2 months and stays editable.
  await r.waitFor(() => assert.equal(r.find(Select, { name: 'rampMonths-2-1' }).props.value, 2));
  assert.equal(r.find(Select, { name: 'rampMonths-2-1' }).props.readOnly, true);
  assert.equal(r.find(Select, { name: 'rampMode-2-1' }).props.value, 'free');
  assert.equal(r.find(Select, { name: 'rampMode-2-1' }).props.readOnly, true);
  assert.equal(r.findAll(Button, (n) => /\+ Add ramp stage/.test(text(n)))[1].props.disabled, true);
  assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 2);
  assert.equal(r.find(Select, { name: 'rampMode-1-1' }).props.readOnly, false);
  assert.match(text(r.getRootNode()), /fixed at 2 free months/);
  assert.equal(r.maybeFind(Alert, { title: 'Fix before continuing' }), null);
});

test('per-product ramps: AutoElevate 3 months free, DNS Filtering 2 months at 50% off on a 15-month agreement', async () => {
  const r = mk();
  const calls = [];
  r.mocks.runServerlessFunction.willCall(async (params) => {
    calls.push(params);
    if (params.name === 'quote_builder_catalog') return { status: 'SUCCESS', response: CATALOG_RESPONSE };
    return { status: 'SUCCESS', response: { ok: true, quoteId: '9', quoteUrl: 'u', title: 't', lineCount: 6, approval: { required: false, reasons: [] } } };
  });
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Select, { name: 'agreementLength' }).trigger('onChange', '15 Months');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  r.find(Button, (n) => /\+ DNS Filtering/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-2' })));
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 1250);
  r.find(NumberInput, { name: 'qty-2' }).trigger('onChange', 500);
  r.find(Checkbox, { name: 'ramp-1' }).trigger('onChange', true);
  r.find(Checkbox, { name: 'ramp-2' }).trigger('onChange', true);
  // Each product gets its own ramp at the default (15 months → 3 months free).
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'rampMonths-2-1' })));
  assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 3);
  assert.equal(r.find(Select, { name: 'rampMonths-2-1' }).props.value, 3);
  // DNS: 2 months at 50% off. AutoElevate stays 3 months free.
  r.find(Select, { name: 'rampMonths-2-1' }).trigger('onChange', 2);
  r.find(Select, { name: 'rampMode-2-1' }).trigger('onChange', 'percent');
  await r.waitFor(() => assert.equal(r.find(NumberInput, { name: 'rampPercent-2-1' }).props.value, 50));
  assert.equal(r.find(Select, { name: 'rampMode-1-1' }).props.value, 'free');
  assert.equal(r.find(Select, { name: 'rampMonths-1-1' }).props.value, 3);
  // Schedule: months 1–2 both ramping, month 3 only AutoElevate, then the plan.
  const root = text(r.getRootNode());
  assert.match(root, /AutoElevate \(free\), DNS Filtering \(50% off\)/);
  assert.match(root, /AutoElevate \(free\), DNS Filtering"/);
  assert.match(root, /"4–15"/);
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 2));
  r.find(Button, (n) => /Create quote/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(calls.find((c) => c.name === 'quote_builder_submit')));
  const products = calls.find((c) => c.name === 'quote_builder_submit').parameters.products;
  assert.deepEqual(products.map((p) => p.rampStages.map((s) => [s.months, s.mode])), [[[3, 'free']], [[2, 'percent']]]);
});

test('a deal still on Advanced (GrandFathered) starts new AutoElevate rows as Standard', async () => {
  const r = mk();
  const gfDeal = Object.assign({}, CATALOG_RESPONSE, { deal: Object.assign({}, CATALOG_RESPONSE.deal, { properties: { sku_type: 'Advanced (GrandFathered)' } }) });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: gfDeal }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'feature-1' })));
  assert.equal(r.find(Select, { name: 'feature-1' }).props.value, 'Standard');
});

test('one-off SKU: pick a product from the One-Off SKUs folder; it prices at its own price', async () => {
  const r = mk();
  const withOneOff = Object.assign({}, CATALOG_RESPONSE, {
    products: CATALOG_RESPONSE.products.concat([
      { id: '8801', properties: { name: 'Optimize365 4000 User Plan', hs_sku: 'Optimize365-4000-User-Commit', hs_price_usd: '4800', hs_folder: 'One-Off SKUs', recurringbillingfrequency: 'monthly' } },
    ]),
  });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: withOneOff }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ One-off SKU/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'oneoff-1' })));
  assert.deepEqual(r.find(Select, { name: 'oneoff-1' }).props.options.map((o) => o.label), ['Choose a one-off SKU', 'Optimize365 4000 User Plan — $4,800.00/mo']);
  assert.match(text(r.getRootNode()), /Pick a one-off SKU/);
  r.find(Select, { name: 'oneoff-1' }).trigger('onChange', '8801');
  await r.waitFor(() => assert.match(text(r.getRootNode()), /\$4,800\.00\/mo/));
  assert.equal(r.find(NumberInput, { name: 'qty-1' }).props.value, 1);
  assert.match(text(r.getRootNode()), /One-off · Optimize365/);
});

test('MSP Optimize365: Pricing picker switches to per tenant, which adds the Optimize TDR users field', async () => {
  const r = mk();
  const t = (id, name, price, edition, component, tier) => ({ id, properties: { name, hs_sku: name, hs_price_usd: String(price), qb_family: 'optimize365', qb_edition: edition, qb_segment: 'MSP', qb_billing: 'monthly', qb_tier: String(tier), qb_component: component } });
  const withO365 = Object.assign({}, CATALOG_RESPONSE, {
    products: CATALOG_RESPONSE.products.concat([
      t('u1', 'Optimize365 100 User Plan', 240, 'standard', 'base', 100),
      t('u2', 'Optimize 365 100 User Plan Additional Users', 2.4, 'standard', 'additional', 100),
      t('o1', 'Optimize365 5 Tenant Plan', 250, 'tenant', 'base', 5),
      t('o2', 'Optimize365 5 Tenant Plan Additional Tenants', 50, 'tenant', 'additional', 5),
      t('o3', 'Optimize TDR', 0, 'tdr', 'base', 1),
    ]),
  });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: withO365 }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  r.find(Button, (n) => /\+ Optimize365/.test(text(n))).trigger('onClick');
  // Starts per user: 100 users, no TDR field.
  await r.waitFor(() => assert.ok(r.maybeFind(Select, { name: 'edition-1' })));
  const picker = r.find(Select, { name: 'edition-1' });
  assert.equal(picker.props.label, 'Pricing');
  assert.deepEqual(picker.props.options.map((o) => o.label), ['Per user', 'Per tenant']);
  assert.equal(r.find(NumberInput, { name: 'qty-1' }).props.label, 'Total users');
  assert.equal(r.maybeFind(NumberInput, { name: 'tdr-1' }), null);
  await r.waitFor(() => assert.match(text(r.getRootNode()), /\$240\.00\/mo/));
  // Per tenant: 7 tenants = 5-tenant plan + 2 additional; 100 TDR users at $1.00.
  picker.trigger('onChange', 'tenant');
  await r.waitFor(() => assert.ok(r.maybeFind(NumberInput, { name: 'tdr-1' })));
  assert.equal(r.find(NumberInput, { name: 'qty-1' }).props.label, 'Total tenants');
  assert.match(r.find(NumberInput, { name: 'tdr-1' }).props.tooltip, /5,000–7,499: \$0\.85/);
  r.find(NumberInput, { name: 'qty-1' }).trigger('onChange', 7);
  r.find(NumberInput, { name: 'tdr-1' }).trigger('onChange', 100);
  // 250 + 2×50 + 100×1 = 450
  await r.waitFor(() => assert.match(text(r.getRootNode()), /\$450\.00\/mo/));
});

const withCompany = (company, dealProps = {}) =>
  Object.assign({}, CATALOG_RESPONSE, {
    deal: Object.assign({}, CATALOG_RESPONSE.deal, { properties: Object.assign({}, CATALOG_RESPONSE.deal.properties, dealProps), company: Object.assign({ id: '9', name: 'Example MSP' }, company) }),
  });
const toProducts = async (r) => {
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
};

test('co-term: every active product is added automatically from the company commits, with no Co-term box to tick', async () => {
  const r = mk();
  const calls = [];
  // An Optimize deal for a partner Active on AutoElevate and DNS Filtering.
  const res = withCompany({ activeProducts: ['autoelevate', 'dns', 'password'], cotermProducts: ['autoelevate', 'dns'], commits: { ae_agent_commit: '1250', ae_sku_type: 'Standard', dns_device_commit: '600', pb_user_commit: '200', dns_initial_discount____property_: '0.2' } }, { pipeline: '917642399' });
  r.mocks.runServerlessFunction.willCall(async (params) => {
    calls.push(params);
    return { status: 'SUCCESS', response: params.name === 'quote_builder_catalog' ? res : { ok: false, errors: ['stop'] } };
  });
  r.render(<QuoteBuilderApp />);
  await toProducts(r);
  // Both rows are already there, priced from the commits: 1,250 agents = 1,000 plan + 250 additional.
  assert.equal(r.find(NumberInput, { name: 'qty-1' }).props.value, 1250);
  assert.equal(r.find(Select, { name: 'feature-1' }).props.value, 'Standard');
  assert.equal(r.find(NumberInput, { name: 'qty-2' }).props.value, 600);
  assert.equal(r.findAll(Tag).filter((t) => /Co-term/.test(text(t))).length, 2);
  assert.match(text(r.getRootNode()), /From the company record: AE Agent Commit 1,250 · AE Feature Type Standard → Standard SKUs/);
  // No Co-term box, no Ramp box, no Remove button on a co-term row.
  assert.equal(r.maybeFind(Checkbox, { name: 'coterm-1' }), null);
  assert.equal(r.maybeFind(Checkbox, { name: 'ramp-1' }), null);
  assert.equal(r.findAll(Button).filter((b) => /Remove/.test(text(b))).length, 0);
  // Only the discount can change: count, plan and feature type are read-only. DNS starts at the company's Initial Discount.
  assert.ok(['qty-1', 'qty-2'].every((n) => r.find(NumberInput, { name: n }).props.readOnly === true));
  assert.ok(['feature-1', 'tier-1', 'tier-2'].every((n) => r.find(Select, { name: n }).props.readOnly === true));
  assert.equal(r.find(NumberInput, { name: 'disc-1' }).props.readOnly, undefined);
  assert.equal(r.find(NumberInput, { name: 'disc-2' }).props.value, 20);
  assert.match(text(r.getRootNode()), /DNS Device Commit 600 · DNS Initial Discount 20%/);
  r.find(NumberInput, { name: 'disc-1' }).trigger('onChange', 15);
  // Password Manager is Active but not paid Month-to-Month: not co-termed, and added by hand it's an Upsell.
  r.find(Button, (n) => /\+ Password Manager/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(NumberInput, { name: 'qty-3' })));
  assert.ok(r.findAll(Tag).some((t) => /Upsell/.test(text(t))));
  assert.equal(r.findAll(Button).filter((b) => /Remove/.test(text(b))).length, 1); // only the new row
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 2));
  r.find(Button, (n) => /Create quote/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(calls.some((c) => c.name === 'quote_builder_submit')));
  const sent = calls.find((c) => c.name === 'quote_builder_submit').parameters.products;
  assert.deepEqual(sent.map((p) => [p.family, !!p.coterm, p.quantity, p.discountPct]), [['autoelevate', true, 1250, 15], ['dns', true, 600, 20], ['password', false, 100, 0]]);
});

test('Month-to-Month is AutoElevate only: co-term rows leave, only + AutoElevate is offered, and Annual brings them back', async () => {
  const r = mk();
  const res = withCompany({ activeProducts: ['autoelevate', 'dns'], cotermProducts: ['autoelevate', 'dns'], commits: { ae_agent_commit: '1250', ae_sku_type: 'Standard', dns_device_commit: '600' } }, { pipeline: '917642399' });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: res }));
  r.render(<QuoteBuilderApp />);
  await r.waitFor(() => assert.ok(r.maybeFind(StepIndicator)));
  r.find(Select, { name: 'billing' }).trigger('onChange', 'm2m');
  await r.waitFor(() => assert.equal(r.find(Select, { name: 'agreementLength' }).props.value, '12 Months - Month-to-Month'));
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  assert.equal(r.findAll(Tag).filter((t) => /Co-term/.test(text(t))).length, 0);
  const addLabels = r.findAll(Button).map((b) => (text(b).match(/"\+ ([^"]+)"/) || [])[1]).filter(Boolean);
  assert.deepEqual(addLabels, ['AutoElevate']);
  assert.match(text(r.getRootNode()), /Month-to-Month quotes are AutoElevate only/);
  // Back to Annual (billed monthly) on Setup: the co-term rows come back from the company record.
  r.find(Button, (n) => /Back/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 0));
  r.find(Select, { name: 'billing' }).trigger('onChange', 'monthly');
  r.find(Button, (n) => /Continue/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.equal(r.find(StepIndicator).props.currentStep, 1));
  await r.waitFor(() => assert.equal(r.findAll(Tag).filter((t) => /Co-term/.test(text(t))).length, 2));
});

test('co-term: a company with no active products starts empty', async () => {
  const r = mk();
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: withCompany({ activeProducts: [], commits: {} }) }));
  r.render(<QuoteBuilderApp />);
  await toProducts(r);
  assert.equal(r.maybeFind(NumberInput, { name: 'qty-1' }), null);
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-1' })));
  assert.equal(r.maybeFind(Checkbox, { name: 'coterm-1' }), null);
  assert.ok(r.findAll(Tag).some((t) => /"New"/.test(text(t))));
});

test("co-term: not on the deal's own product (AutoElevate Upsell deal): AutoElevate is the upsell, DNS is co-termed", async () => {
  const r = mk();
  const res = withCompany({ activeProducts: ['autoelevate', 'dns'], cotermProducts: ['autoelevate', 'dns'], commits: { ae_agent_commit: '1250', dns_device_commit: '600' } }, { pipeline: '7659799' });
  r.mocks.runServerlessFunction.willCall(async () => ({ status: 'SUCCESS', response: res }));
  r.render(<QuoteBuilderApp />);
  await toProducts(r);
  // Only DNS was added automatically.
  assert.equal(r.find(NumberInput, { name: 'qty-1' }).props.value, 600);
  assert.equal(r.maybeFind(NumberInput, { name: 'qty-2' }), null);
  r.find(Button, (n) => /\+ AutoElevate/.test(text(n))).trigger('onClick');
  await r.waitFor(() => assert.ok(r.maybeFind(Checkbox, { name: 'ramp-2' })));
  const tags = r.findAll(Tag).map((t) => text(t));
  assert.equal(tags.filter((t) => /Co-term/.test(t)).length, 1);
  assert.equal(tags.filter((t) => /Upsell/.test(t)).length, 1);
});

test('co-term: editing or copying an older quote adds the missing co-terms; Stop editing starts from them; co-term rows ignore Remove', () => {
  const coterms = [{ family: 'autoelevate', coterm: true, edition: 'advanced', featureType: 'Advanced', quantity: 150, tier: '', discountPct: 0, ramp: false }];
  const old = { setup: { segment: 'MSP' }, products: [{ uid: 1, family: 'optimize365', edition: 'standard', quantity: 40, discountPct: 0, ramp: false }] };
  const edited = reducer(initialState, { type: 'editQuote', quote: { id: 'Q1', title: 'Old', state: old }, coterms });
  assert.deepEqual(edited.products.map((p) => [p.uid, p.family, !!p.coterm]), [[1, 'optimize365', false], [2, 'autoelevate', true]]);
  assert.equal(edited.nextUid, 3);
  // A quote that already has the product (here as a one-off AutoElevate SKU) gets no second row.
  const withOneOff = { setup: {}, products: [{ uid: 1, family: 'oneoff', baseFamily: 'autoelevate', productId: '5', quantity: 1, discountPct: 0 }] };
  assert.equal(reducer(initialState, { type: 'loadState', state: withOneOff, coterms }).products.length, 1);
  const stopped = reducer(edited, { type: 'stopEditing', coterms });
  assert.deepEqual(stopped.products.map((p) => [p.uid, p.family]), [[1, 'autoelevate']]);
  assert.equal(reducer(stopped, { type: 'removeProduct', uid: 1 }).products.length, 1);
  // A saved co-term on a product that can't co-term any more (now paid annually) becomes a normal row.
  const annual = { setup: {}, products: [{ uid: 1, family: 'dns', coterm: true, edition: 'standard', quantity: 600, discountPct: 0 }] };
  assert.deepEqual(reducer(initialState, { type: 'editQuote', quote: { id: 'Q2', state: annual }, coterms }).products.map((p) => [p.family, !!p.coterm]), [['dns', false], ['autoelevate', true]]);
  // Switching to Enterprise moves a per-tenant Optimize co-term back to the company's user commit.
  const tenant = Object.assign({}, initialState, { products: [{ uid: 1, family: 'optimize365', coterm: true, edition: 'tenant', quantity: 7, cotermCounts: { users: 40, tenants: 7 } }] });
  const ent = reducer(tenant, { type: 'setup', patch: { segment: 'ENT' } });
  assert.deepEqual([ent.products[0].edition, ent.products[0].quantity], ['standard', 40]);
});
