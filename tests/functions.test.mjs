// Exercises both app functions against an in-memory fake of the HubSpot API.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.PRIVATE_APP_ACCESS_TOKEN = 'test-token';

let nextId = 9000;
const prod = (sku, price, family, edition, segment, billing, tier, component = 'base') => ({
  id: String(nextId++),
  properties: { name: sku, hs_sku: sku, hs_price_usd: String(price), qb_family: family, qb_edition: edition, qb_segment: segment, qb_billing: billing, qb_tier: tier == null ? '' : String(tier), qb_component: component },
});
const PRODUCTS = [
  prod('Standard-AE-1000-Agent-Commit-2026', 1050, 'autoelevate', 'standard', 'MSP', 'monthly', 1000),
  prod('Standard-AE-1000-Agent-Commit-Additional-Agents+2026', 1.05, 'autoelevate', 'standard', 'MSP', 'monthly', 1000, 'additional'),
  prod('Timus SASE - Monthly Minimum', 250, 'timus', 'advanced', 'MSP', 'monthly', null, 'minimum'),
];

function fakeHubSpot({ failQuote = false, quotes = [], ownerId = '77' } = {}) {
  const log = [];
  const store = { lineItems: {}, archived: [], deletedQuotes: [], quote: null, dealPatch: null };
  store.lineItems['L-old-builder'] = { qb_source: 'quote_builder', qb_session_id: 'qb-old' };
  store.lineItems['L-manual'] = { qb_source: '', qb_session_id: '' };
  store.quotes = quotes; // [{ id, properties, lineIds }]
  store.ownerId = ownerId;
  store.dealPatches = [];
  store.quotePatches = [];
  store.assocCalls = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method, path: u.pathname, body, auth: init.headers.Authorization });
    const ok = (data, status = 200) => ({ ok: true, status, headers: new Map(), text: async () => JSON.stringify(data) });
    const p = u.pathname;
    if (p === '/crm/v3/objects/products/search') return ok({ results: PRODUCTS });
    if (p === '/crm/v3/properties/deals/batch/read')
      return ok({
        results: [
          { name: 'agreement_length', options: ['12 Months - Month-to-Month', '12 Months', '15 Months'].map((v) => ({ value: v, label: v, hidden: false })) },
          { name: 'payment_terms', options: [{ value: 'Month-to-Month', label: 'Monthly' }, { value: 'One Time', label: 'One Time' }] },
          { name: 'payment_method', options: [{ value: 'ACH', label: 'ACH' }, { value: 'Credit Card', label: 'Credit Card' }] },
          { name: 'invoice_terms', options: [{ value: 'Net-30', label: 'Net-30' }, { value: 'Due Upon Receipt', label: 'Due Upon Receipt' }] },
          { name: 'promo', options: [{ value: 'Old Promo', label: 'Old Promo', hidden: true }] },
          { name: 'sku_type', options: ['Advanced', 'Standard', 'Advanced (GrandFathered)'].map((v) => ({ value: v, label: v })) },
        ],
      });
    if (p === '/crm/v3/objects/quote_templates') return ok({ results: [{ id: '10', properties: { hs_name: 'AutoElevate', hs_type: 'cpq_template' } }, { id: '11', properties: { hs_name: 'Timus SASE', hs_type: 'customizable_quote_template' } }] });
    if (p === '/crm/v3/objects/deals/123' && method === 'GET')
      return ok({ id: '123', properties: { sales_team: 'MSP', deal_currency_code: 'USD', hubspot_owner_id: store.ownerId },  associations: { companies: { results: [{ id: '7' }] }, contacts: { results: [{ id: '501' }] }, quotes: { results: store.quotes.map((q) => ({ id: q.id })) } } });
    if (p.startsWith('/crm/v3/owners/')) return p.endsWith('/77') ? ok({ id: '77', firstName: 'Riley', lastName: 'Rep', email: 'riley.rep@example.com' }) : { ok: false, status: 404, headers: new Map(), text: async () => '{"message":"not found"}' };
    if (p === '/crm/v3/objects/companies/batch/read') return ok({ results: [{ id: '7', properties: { name: 'Example MSP' } }] });
    if (p === '/crm/v3/objects/contacts/batch/read') return ok({ results: [{ id: '501', properties: { firstname: 'Sam', lastname: 'Sample', jobtitle: 'Owner' } }] });
    if (p === '/crm/v3/objects/line_items/batch/create') {
      const results = body.inputs.map((i) => {
        const id = `L${nextId++}`;
        store.lineItems[id] = i.properties;
        return { id, properties: i.properties };
      });
      return ok({ status: 'COMPLETE', results: results.reverse() }); // HubSpot does not promise order
    }
    if (p === '/crm/v3/objects/quotes' && method === 'POST') {
      if (failQuote) return { ok: false, status: 400, headers: new Map(), text: async () => JSON.stringify({ message: 'Template not compatible' }) };
      store.quote = body;
      return ok({ id: 'Q1', properties: body.properties }, 201);
    }
    if (p === '/crm/v3/objects/quotes/Q1' && method === 'DELETE') {
      store.deletedQuotes.push('Q1');
      return ok(null, 204);
    }
    if (p === '/crm/v3/objects/deals/123' && method === 'PATCH') {
      store.dealPatch = body.properties;
      store.dealPatches.push(body.properties);
      return ok({ id: '123' });
    }
    if (p === '/crm/v4/objects/deals/123/associations/line_items') return ok({ results: Object.keys(store.lineItems).map((id) => ({ toObjectId: id })) });
    if (p === '/crm/v3/objects/quotes/batch/read') return ok({ results: store.quotes.map((q) => ({ id: q.id, properties: q.properties })) });
    const qa = p.match(/^\/crm\/v4\/objects\/quotes\/(\w+)\/associations\/(line_items|quote_template|contacts)(?:\/(\w+))?$/);
    if (qa) {
      const q = store.quotes.find((x) => x.id === qa[1]);
      const key = { line_items: 'lineIds', quote_template: 'templateIds', contacts: 'contactIds' }[qa[2]];
      q[key] = q[key] || [];
      if (method === 'GET') return ok({ results: q[key].map((id) => ({ toObjectId: id })) });
      if (method === 'DELETE') q[key] = q[key].filter((id) => id !== qa[3]);
      if (method === 'PUT') q[key].push(qa[3]);
      store.assocCalls.push(`${method} ${qa[2]} ${qa[3]}${body ? ' ' + body.map((t) => t.associationTypeId).join('+') : ''}`);
      return ok({});
    }
    const qq = p.match(/^\/crm\/v3\/objects\/quotes\/(\w+)$/);
    if (qq && method === 'GET') return ok({ id: qq[1], properties: store.quotes.find((x) => x.id === qq[1]).properties });
    if (qq && method === 'PATCH') {
      store.quotePatches.push({ id: qq[1], properties: body.properties });
      if (store.failQuotePatch) return { ok: false, status: 400, headers: new Map(), text: async () => JSON.stringify({ message: 'Quote locked' }) };
      return ok({ id: qq[1] });
    }
    if (p === '/crm/v3/objects/line_items/batch/read') return ok({ results: body.inputs.map((i) => ({ id: i.id, properties: store.lineItems[i.id] || {} })) });
    if (p === '/crm/v3/objects/line_items/batch/archive') {
      store.archived.push(...body.inputs.map((i) => i.id));
      return ok(null, 204);
    }
    throw new Error(`Unexpected request ${method} ${p}`);
  };
  return { log, store };
}

const payload = (over = {}) =>
  Object.assign(
    {
      dealId: '123',
      setup: { templateId: '10', segment: 'MSP', billing: 'monthly', agreementLength: '15 Months', expirationDate: '2026-11-05', acceptance: 'esignature', signerContactId: '501', promo: '', paymentMethod: 'ACH', invoiceTerms: 'Net-30', quoteName: '' },
      products: [{ uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, tier: '', discountPct: 10, ramp: true, unitPrice: 0.01 }],
      ramp: { enabled: true, months: 3, mode: 'free' },
      notes: 'Competitive displacement',
      replaceLines: true,
    },
    over
  );

const catalogFn = () => require('../src/app/functions/quote-builder-catalog.js');
const submitFn = () => require('../src/app/functions/quote-builder-submit.js');

test('catalog function returns tagged products, templates and deal context', async () => {
  fakeHubSpot();
  const res = await catalogFn().main({ parameters: { dealId: '123' }, accountId: 2585282 });
  assert.equal(res.ok, true);
  assert.equal(res.products.length, 3);
  assert.deepEqual(res.templates.map((t) => t.templateType), ['CPQ_QUOTE', 'CUSTOMIZABLE_QUOTE_TEMPLATE']);
  assert.equal(res.deal.company.name, 'Example MSP');
  assert.deepEqual(res.dealOptions.promo, []); // hidden options are dropped
  assert.equal(res.dealOptions.payment_terms[0].label, 'Monthly');
  assert.deepEqual(res.deal.contacts, [{ id: '501', label: 'Sam Sample — Owner' }]);
  assert.deepEqual(res.issues, []);
});

test('submit writes deal lines, quote copies, quote and deal fields; replaces only builder lines', async () => {
  const { log, store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload(), accountId: 2585282 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(res.lineCount, 4);
  assert.equal(res.title, 'Example MSP - AutoElevate + 3 Month Ramp');
  assert.equal(res.quoteUrl, 'https://app.hubspot.com/quotes/2585282/details/Q1');
  assert.equal(res.approval.required, true);
  assert.ok(log.every((l) => l.auth === 'Bearer test-token'));

  const creates = log.filter((l) => l.path === '/crm/v3/objects/line_items/batch/create');
  assert.equal(creates.length, 2);
  assert.ok(creates[0].body.inputs.every((i) => i.associations[0].types[0].associationTypeId === 20 && i.associations[0].to.id === '123'));
  assert.ok(creates[1].body.inputs.every((i) => !i.associations));
  // prices come from the catalog, never the client
  assert.deepEqual(creates[0].body.inputs.map((i) => i.properties.price), ['1050', '1.05', '1050', '1.05']);
  assert.deepEqual(creates[0].body.inputs.map((i) => i.properties.ramp), ['true', 'true', 'false', 'false']);

  const q = store.quote;
  assert.equal(q.properties.hs_template_type, 'CPQ_QUOTE');
  assert.equal(q.properties.hs_acceptance_method, 'esignature');
  assert.equal(q.properties.hs_status, undefined);
  const types = q.associations.map((a) => a.types[0].associationTypeId).sort((a, b) => a - b);
  assert.deepEqual(types, [286, 64, 67, 67, 67, 67, 69, 702].sort((a, b) => a - b));
  const quoteLineIds = q.associations.filter((a) => a.types[0].associationTypeId === 67).map((a) => a.to.id);
  const dealLineIds = Object.keys(store.lineItems).filter((id) => store.lineItems[id].hs_position_on_quote && !quoteLineIds.includes(id));
  assert.equal(dealLineIds.length, 4);

  assert.deepEqual(store.dealPatch, {
    agreement_length: '15 Months',
    payment_terms: 'Month-to-Month',
    payment_method: 'ACH',
    invoice_terms: 'Net-30',
    promo: '',
    sku_type: 'Standard',
    ae_feature_type_details:
      'Elevation. Additional agents over the minimum commitment of this plan will be billed at the same price per agent. Usage of Advanced features Blocker and Just-in-Time Admin Login will result in additional charges. Unlimited User (Technician) & Company licenses included',
  });
  assert.deepEqual(store.archived, ['L-old-builder']);
});

test('submit rolls back everything it created when the quote fails', async () => {
  const { store } = fakeHubSpot({ failQuote: true });
  const res = await submitFn().main({ parameters: payload(), accountId: 1 });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Template not compatible/);
  assert.equal(store.archived.length, 8); // 4 deal lines + 4 quote lines
  assert.ok(!store.archived.includes('L-old-builder'));
  assert.equal(store.dealPatch, null);
});

test('submit rejects bad input before touching HubSpot', async () => {
  const { log } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ products: [{ family: 'autoelevate', quantity: 10, discountPct: 140 }] }) });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /discount/);
  assert.equal(log.length, 0);
});

test('a deal value with no matching property option stops the submit before any write', async () => {
  const { log } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ setup: Object.assign(payload().setup, { agreementLength: '27 Months' }) }), accountId: 1 });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Agreement Length has no "27 Months" option/);
  assert.ok(!log.some((l) => l.method !== 'GET' && !/search|batch\/read/.test(l.path)));
});

test('legacy template: DRAFT status, no acceptance method; Timus writes deal fields', async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({
    parameters: payload({
      setup: Object.assign(payload().setup, { templateId: '11' }),
      products: [{ uid: 2, family: 'timus', quantity: 150, gateways: 2, discountPct: 0, agreement: 'standard', minimum: 1000, userRate: 4.55, gatewayRate: 50, ramp: false }],
      ramp: { enabled: false },
    }),
    accountId: 1,
  });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(store.quote.properties.hs_status, 'DRAFT');
  assert.equal(store.quote.properties.hs_acceptance_method, undefined);
  assert.ok(!store.quote.associations.some((a) => a.types[0].associationTypeId === 702));
  assert.equal(store.dealPatch.timus_price_list, undefined);
  assert.equal(store.dealPatch.new_minimum_commitment_amount, '1000');
  assert.equal(store.dealPatch.timus_price_per_user, '4.55');
  assert.equal(store.dealPatch.timus_price_per_gateway, '50.00');
});

// ---------------------------------------------------------------------------
// Multiple quotes (options) on one deal
// ---------------------------------------------------------------------------
const setPrimaryFn = () => require('../src/app/functions/quote-builder-set-primary.js');
const P = require('../functions-src/lib/pricing.js');

test('alternative option: quote is created with saved inputs, deal line items untouched', async () => {
  const existing = { id: 'Q0', properties: { hs_title: 'Example MSP - AutoElevate (100)', hs_quote_progression_status: 'PUBLISHED', qb_session_id: 'qb-old', qb_builder_state: P.builderState({ setup: {}, products: [], ramp: {} }, {}) } };
  const { log, store } = fakeHubSpot({ quotes: [existing] });
  const res = await submitFn().main({ parameters: payload({ primary: false }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(res.primary, false);
  const creates = log.filter((l) => l.path === '/crm/v3/objects/line_items/batch/create');
  assert.equal(creates.length, 1); // quote copies only
  assert.ok(creates[0].body.inputs.every((i) => !i.associations));
  assert.deepEqual(store.archived, []); // previous primary lines stay on the deal
  const state = P.parseBuilderState(store.quote.properties.qb_builder_state);
  assert.equal(state.products[0].quantity, 1250);
  assert.equal(state.dealProperties.agreement_length, '15 Months');
  assert.match(store.quote.properties.qb_session_id, /^qb-/);
  assert.deepEqual(res.openQuotesAffected, []); // the other quote is published, so it's locked
});

test('first builder quote on a deal is always primary, even if the card says otherwise', async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ primary: false }), accountId: 1 });
  assert.equal(res.primary, true);
  assert.deepEqual(store.archived, ['L-old-builder']);
});

test('submit reports open (unpublished) quotes whose printed values change', async () => {
  const draft = { id: 'Q9', properties: { hs_title: 'Option A', hs_quote_progression_status: 'DRAFT', qb_session_id: 'qb-a' } };
  fakeHubSpot({ quotes: [draft] });
  const res = await submitFn().main({ parameters: payload({ primary: false }), accountId: 1 });
  assert.deepEqual(res.openQuotesAffected, [{ id: 'Q9', title: 'Option A' }]);
});

test('make primary copies the quote lines to the deal, archives the old primary lines, writes its printed fields', async () => {
  const saved = { agreement_length: '24 Months', sku_type: 'Advanced' };
  const quote = { id: 'Q2', lineIds: ['QL1', 'QL2'], properties: { hs_title: 'Option B', hs_quote_progression_status: 'PUBLISHED', qb_session_id: 'qb-b', qb_builder_state: P.builderState({ setup: {}, products: [], ramp: {} }, saved) } };
  const { store, log } = fakeHubSpot({ quotes: [quote] });
  store.lineItems.QL1 = { name: 'AE plan', price: '1050', quantity: '1', qb_source: 'quote_builder', qb_session_id: 'qb-b' };
  store.lineItems.QL2 = { name: 'AE additional', price: '1.05', quantity: '250', qb_source: 'quote_builder', qb_session_id: 'qb-b' };
  const res = await setPrimaryFn().main({ parameters: { dealId: '123', quoteId: 'Q2' } });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(res.lineCount, 2);
  const create = log.find((l) => l.path === '/crm/v3/objects/line_items/batch/create');
  assert.ok(create.body.inputs.every((i) => i.associations[0].to.id === '123' && i.properties.qb_session_id === 'qb-b'));
  assert.deepEqual(store.dealPatch, saved);
  assert.deepEqual(store.archived, ['L-old-builder']); // manual lines untouched
});

test('make primary refuses quotes that were not built with the builder', async () => {
  fakeHubSpot({ quotes: [{ id: 'Q3', properties: { hs_title: 'Manual quote', hs_quote_progression_status: 'DRAFT' } }] });
  const res = await setPrimaryFn().main({ parameters: { dealId: '123', quoteId: 'Q3' } });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /Only quotes made with the Quote Builder/);
});

test('deployed function files are self-contained (HubSpot ships each as a single file)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const dir = new URL('../src/app/functions/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.deepEqual(files.sort(), ['quote-builder-catalog.js', 'quote-builder-set-primary.js', 'quote-builder-submit.js']);
  for (const f of files) assert.doesNotMatch(readFileSync(new URL(f, dir), 'utf8'), /require\(["']\.\.?\//, `${f} still requires a local file`);
});

test('seller contact on the quote is always the deal owner', async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload(), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  const q = store.quote.properties;
  assert.deepEqual([q.hubspot_owner_id, q.hs_sender_firstname, q.hs_sender_lastname, q.hs_sender_email], ['77', 'Riley', 'Rep', 'riley.rep@example.com']);
  assert.equal(q.hs_payment_enabled, 'false'); // like every CyberFOX CPQ quote; payments would block sub-$35 ramp invoices
  const cat = await catalogFn().main({ parameters: { dealId: '123' }, accountId: 1 });
  assert.equal(cat.deal.owner.email, 'riley.rep@example.com');
});

test('no deal owner: quote is not created', async () => {
  const { store } = fakeHubSpot({ ownerId: '' });
  const res = await submitFn().main({ parameters: payload(), accountId: 1 });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /deal owner/);
  assert.equal(store.quote, null);
});

// ---------------------------------------------------------------------------
// Editing an existing builder quote in place
// ---------------------------------------------------------------------------
const draftBuilderQuote = (over = {}) =>
  Object.assign(
    {
      id: 'Q5',
      lineIds: ['QL5a', 'QL5b'],
      templateIds: ['10'],
      contactIds: ['501'],
      properties: {
        hs_title: 'Example MSP - AutoElevate',
        hs_quote_progression_status: 'DRAFT',
        hs_template_type: 'CPQ_QUOTE',
        qb_session_id: 'qb-old',
        qb_builder_state: P.builderState({ setup: {}, products: [], ramp: {} }, {}),
      },
    },
    over
  );

test('edit in place: same quote, new lines replace old ones, primary deal lines swapped', async () => {
  const q = draftBuilderQuote();
  const { store, log } = fakeHubSpot({ quotes: [q] });
  store.lineItems.QL5a = { qb_source: 'quote_builder', qb_session_id: 'qb-old' };
  const res = await submitFn().main({ parameters: payload({ editQuoteId: 'Q5', primary: false }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(res.edited, true);
  assert.equal(res.quoteId, 'Q5');
  assert.equal(res.primary, true); // it was the primary option (its run's lines are on the deal) and stays primary
  assert.equal(store.quote, null); // no new quote
  const creates = log.filter((l) => l.path === '/crm/v3/objects/line_items/batch/create');
  assert.equal(creates.length, 2); // deal lines + quote lines
  const quoteLines = creates.find((c) => c.body.inputs[0].associations[0].types[0].associationTypeId === 68);
  assert.ok(quoteLines.body.inputs.every((i) => i.associations[0].to.id === 'Q5' && i.properties.qb_session_id === 'qb-old'));
  assert.equal(store.quotePatches[0].properties.qb_session_id, 'qb-old');
  assert.equal(store.quotePatches[0].properties.hs_payment_enabled, 'false');
  assert.ok(store.archived.includes('QL5a') && store.archived.includes('QL5b')); // old quote lines
  assert.ok(store.archived.includes('L-old-builder')); // old primary deal lines
  assert.ok(!store.archived.includes('L-manual'));
  assert.deepEqual(store.assocCalls, ['DELETE contacts 501', 'PUT contacts 501 69+702']); // template unchanged
  assert.equal(store.dealPatch.agreement_length, '15 Months');
});

test('edit in place: template swap within CPQ, refused for published or pending approval', async () => {
  const q = draftBuilderQuote({ templateIds: ['12'] });
  const { store } = fakeHubSpot({ quotes: [q] });
  const res = await submitFn().main({ parameters: payload({ editQuoteId: 'Q5' }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.deepEqual(store.assocCalls.slice(0, 2), ['DELETE quote_template 12', 'PUT quote_template 10 286']);

  for (const [status, msg] of [['PUBLISHED', /locked/], ['PENDING_APPROVAL', /Recall the approval/]]) {
    const locked = draftBuilderQuote();
    locked.properties = Object.assign({}, locked.properties, { hs_quote_progression_status: status });
    const env = fakeHubSpot({ quotes: [locked] });
    const r = await submitFn().main({ parameters: payload({ editQuoteId: 'Q5' }), accountId: 1 });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], msg);
    assert.deepEqual(env.store.quotePatches, []);
  }
});

test('edit in place: CPQ quote cannot switch to a legacy template; failures roll back', async () => {
  fakeHubSpot({ quotes: [draftBuilderQuote()] });
  const legacy = await submitFn().main({ parameters: payload({ editQuoteId: 'Q5', setup: Object.assign(payload().setup, { templateId: '11' }) }), accountId: 1 });
  assert.equal(legacy.ok, false);
  assert.match(legacy.errors[0], /CPQ and a legacy template/);

  const { store } = fakeHubSpot({ quotes: [draftBuilderQuote()] });
  store.failQuotePatch = true;
  const res = await submitFn().main({ parameters: payload({ editQuoteId: 'Q5' }), accountId: 1 });
  assert.equal(res.ok, false);
  assert.ok(!store.archived.includes('QL5a')); // the quote's original lines survive
  assert.ok(store.archived.length >= 2); // the new lines were archived again
});

test('HubSpot Quote Notes is never written (reps keep their own verbiage there)', async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ notes: 'should be ignored' }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.ok(!('hubspot_quote_notes' in store.dealPatch));
});
