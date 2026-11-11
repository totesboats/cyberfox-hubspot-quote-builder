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
  // A one-off SKU: untagged, lives in the One-Off SKUs folder.
  { id: '9900', properties: { name: 'Optimize365 4000 User Plan', hs_sku: 'Optimize365-4000-User-Commit', hs_price_usd: '4800', hs_folder: 'One-Off SKUs', recurringbillingfrequency: 'monthly' } },
];

function fakeHubSpot({ failQuote = false, quotes = [], ownerId = '77', currency = 'USD', products = PRODUCTS, companyProps = {} } = {}) {
  const log = [];
  const store = { lineItems: {}, archived: [], deletedQuotes: [], quote: null, dealPatch: null };
  store.lineItems['L-old-builder'] = { qb_source: 'quote_builder', qb_session_id: 'qb-old' };
  store.lineItems['L-manual'] = { qb_source: '', qb_session_id: '' };
  store.quotes = quotes; // [{ id, properties, lineIds }]
  store.ownerId = ownerId;
  store.dealPatches = [];
  store.quotePatches = [];
  store.assocCalls = [];
  store.assocReads = [];
  global.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    log.push({ method, path: u.pathname, body, auth: init.headers.Authorization });
    if (/\/v[34]\//.test(u.pathname) && !store.allowLegacy) throw new Error(`Legacy API path called: ${method} ${u.pathname}`);
    const ok = (data, status = 200) => ({ ok: true, status, headers: new Map(), text: async () => JSON.stringify(data) });
    const p = u.pathname;
    if (p === '/crm/objects/2026-09/products/search') return ok({ results: products });
    if (p === '/crm/properties/2026-09/deals/batch/read')
      return ok({
        results: [
          { name: 'agreement_length', options: ['12 Months - Month-to-Month', '12 Months', '15 Months'].map((v) => ({ value: v, label: v, hidden: false })) },
          { name: 'payment_terms', options: [{ value: 'Month-to-Month', label: 'Monthly' }, { value: 'One Time', label: 'One Time' }] },
          { name: 'payment_method', options: [{ value: 'ACH', label: 'ACH' }, { value: 'Credit Card', label: 'Credit Card' }, { value: 'Wire', label: 'Wire', hidden: true }] },
          { name: 'invoice_terms', options: [{ value: 'Net-30', label: 'Net-30' }, { value: 'Due Upon Receipt', label: 'Due Upon Receipt' }] },
          { name: 'sku_type', options: ['Advanced', 'Standard', 'Advanced (GrandFathered)'].map((v) => ({ value: v, label: v })) },
        ],
      });
    if (p === '/crm/objects/2026-09/quote_templates' && store.templates404) return { ok: false, status: 404, headers: new Map(), text: async () => '{"message":"Unknown object type"}' };
    if (p === '/crm/v3/objects/quote_templates' && store.allowLegacy) return ok({ results: [{ id: '10', properties: { hs_name: 'AutoElevate', hs_type: 'cpq_template' } }] });
    if (p === '/crm/objects/2026-09/quote_templates') return ok({ results: [{ id: '10', properties: { hs_name: 'AutoElevate', hs_type: 'cpq_template' } }, { id: '11', properties: { hs_name: 'Timus SASE', hs_type: 'customizable_quote_template' } }] });
    if (p === '/crm/objects/2026-09/deals/123' && method === 'GET')
      return ok({ id: '123', properties: { sales_team: 'MSP', deal_currency_code: currency, hubspot_owner_id: store.ownerId } });
    if (p === '/crm/owners/2026-09') {
      const users = { 'riley.rep@example.com': { id: '77', firstName: 'Riley', lastName: 'Rep', email: 'riley.rep@example.com' }, 'pat.ops@example.com': { id: '88', firstName: 'Pat', lastName: 'Ops', email: 'pat.ops@example.com' } };
      const found = users[u.searchParams.get('email')];
      return ok({ results: found ? [found] : [] });
    }
    if (p.startsWith('/crm/owners/2026-09/')) return p.endsWith('/77') ? ok({ id: '77', firstName: 'Riley', lastName: 'Rep', email: 'riley.rep@example.com' }) : { ok: false, status: 404, headers: new Map(), text: async () => '{"message":"not found"}' };
    if (p === '/crm/objects/2026-09/companies/batch/read') {
      store.companyRead = body;
      return ok({ results: [{ id: '7', properties: Object.assign({ name: 'Example MSP' }, companyProps) }] });
    }
    if (p === '/crm/objects/2026-09/contacts/batch/read') return ok({ results: [{ id: '501', properties: { firstname: 'Sam', lastname: 'Sample', jobtitle: 'Owner' } }] });
    if (p === '/crm/objects/2026-09/line_items/batch/create') {
      const results = body.inputs.map((i) => {
        const id = `L${nextId++}`;
        store.lineItems[id] = i.properties;
        return { id, properties: i.properties };
      });
      return ok({ status: 'COMPLETE', results: results.reverse() }); // HubSpot does not promise order
    }
    if (p === '/crm/objects/2026-09/quotes' && method === 'POST') {
      if (failQuote) return { ok: false, status: 400, headers: new Map(), text: async () => JSON.stringify({ message: 'Template not compatible' }) };
      store.quote = body;
      return ok({ id: 'Q1', properties: body.properties }, 201);
    }
    if (p === '/crm/objects/2026-09/quotes/Q1' && method === 'DELETE') {
      store.deletedQuotes.push('Q1');
      return ok(null, 204);
    }
    if (p === '/crm/objects/2026-09/deals/123' && method === 'PATCH') {
      store.dealPatch = body.properties;
      store.dealPatches.push(body.properties);
      return ok({ id: '123' });
    }
    // Associations batch read (the date-based API's only way to list a record's associations).
    const ab = p.match(/^\/crm\/associations\/2026-09\/(deals|quotes)\/(\w+)\/batch\/read$/);
    if (ab) {
      store.assocReads.push(`${ab[1]}->${ab[2]}`);
      const id = body.inputs[0].id;
      let to = [];
      if (ab[1] === 'deals') {
        if (ab[2] === 'line_items') {
          to = Object.keys(store.lineItems).map((x) => ({ toObjectId: x, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 19 }] }));
          // Paging: one association per page, cursor = index of the next one.
          if (store.pageAssociations) {
            const at = Number(body.inputs[0].after || 0);
            const page = { from: { id }, to: to.slice(at, at + 1) };
            if (at + 1 < to.length) page.paging = { next: { after: String(at + 1) } };
            return ok({ status: 'COMPLETE', results: [page] });
          }
        }
        // Company 6 is a secondary company; 7 is the primary (type 5), listed second on purpose.
        if (ab[2] === 'companies') to = [{ toObjectId: 6, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 341 }] }, { toObjectId: 7, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 5 }, { category: 'HUBSPOT_DEFINED', typeId: 341 }] }];
        if (ab[2] === 'contacts') to = [{ toObjectId: 501, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 3 }] }];
        if (ab[2] === 'quotes') to = store.quotes.map((q) => ({ toObjectId: q.id, associationTypes: [{ category: 'HUBSPOT_DEFINED', typeId: 63 }] }));
      } else {
        const q = store.quotes.find((x) => x.id === id);
        const key = { line_items: 'lineIds', quote_template: 'templateIds', contacts: 'contactIds', companies: 'companyIds' }[ab[2]];
        to = ((q && q[key]) || []).map((x) => ({ toObjectId: x, associationTypes: [] }));
      }
      // No associations: HubSpot answers 207 with an error for that input and no result.
      return to.length ? ok({ status: 'COMPLETE', results: [{ from: { id }, to }] }) : ok({ status: 'COMPLETE', results: [], numErrors: 1, errors: [{ status: 'error', category: 'OBJECT_NOT_FOUND', message: 'No associations found' }] }, 207);
    }
    if (p === '/crm/objects/2026-09/quotes/batch/read') return ok({ results: store.quotes.map((q) => ({ id: q.id, properties: q.properties })) });
    const qa = p.match(/^\/crm\/objects\/2026-09\/quotes\/(\w+)\/associations\/(line_items|quote_template|contacts|companies)\/(\w+)$/);
    if (qa) {
      const q = store.quotes.find((x) => x.id === qa[1]);
      const key = { line_items: 'lineIds', quote_template: 'templateIds', contacts: 'contactIds', companies: 'companyIds' }[qa[2]];
      q[key] = q[key] || [];
      if (method === 'DELETE') q[key] = q[key].filter((id) => id !== qa[3]);
      if (method === 'PUT') q[key].push(qa[3]);
      store.assocCalls.push(`${method} ${qa[2]} ${qa[3]}${body ? ' ' + body.map((t) => t.associationTypeId).join('+') : ''}`);
      return ok({});
    }
    const qq = p.match(/^\/crm\/objects\/2026-09\/quotes\/(\w+)$/);
    if (qq && method === 'GET') return ok({ id: qq[1], properties: store.quotes.find((x) => x.id === qq[1]).properties });
    if (qq && method === 'PATCH') {
      store.quotePatches.push({ id: qq[1], properties: body.properties });
      if (store.failQuotePatch) return { ok: false, status: 400, headers: new Map(), text: async () => JSON.stringify({ message: 'Quote locked' }) };
      return ok({ id: qq[1] });
    }
    if (p === '/crm/objects/2026-09/line_items/batch/read') return ok({ results: body.inputs.map((i) => ({ id: i.id, properties: store.lineItems[i.id] || {} })) });
    if (p === '/crm/objects/2026-09/line_items/batch/archive') {
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
  assert.equal(res.products.length, 4); // 3 tagged + 1 one-off SKU
  assert.deepEqual(res.templates.map((t) => t.templateType), ['CPQ_QUOTE', 'CUSTOMIZABLE_QUOTE_TEMPLATE']);
  assert.equal(res.deal.company.name, 'Example MSP');
  assert.deepEqual(res.dealOptions.payment_method.map((o) => o.value), ['ACH', 'Credit Card']); // hidden options are dropped
  assert.equal('promo' in res.dealOptions, false); // Promo is no longer set by the builder
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
  assert.equal(res.quoteUrl, 'https://app.hubspot.com/quote/2585282/editor/Q1/content'); // CPQ quotes open in the quote editor
  assert.equal(res.approval.required, false); // 3-month ramp, 10% discount: under both approval rules
  assert.ok(log.every((l) => l.auth === 'Bearer test-token'));

  const creates = log.filter((l) => l.path === '/crm/objects/2026-09/line_items/batch/create');
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
  assert.deepEqual(types, [286, 64, 67, 67, 67, 67, 69, 702, 71].sort((a, b) => a - b)); // 71 = the deal's company, so its address prints
  assert.equal(q.associations.find((a) => a.types[0].associationTypeId === 71).to.id, '7');
  const quoteLineIds = q.associations.filter((a) => a.types[0].associationTypeId === 67).map((a) => a.to.id);
  const dealLineIds = Object.keys(store.lineItems).filter((id) => store.lineItems[id].hs_position_on_quote && !quoteLineIds.includes(id));
  assert.equal(dealLineIds.length, 4);

  assert.deepEqual(store.dealPatch, {
    agreement_length: '15 Months',
    payment_terms: 'Month-to-Month',
    payment_method: 'ACH',
    invoice_terms: 'Net-30',
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
  const creates = log.filter((l) => l.path === '/crm/objects/2026-09/line_items/batch/create');
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
  const create = log.find((l) => l.path === '/crm/objects/2026-09/line_items/batch/create');
  assert.ok(create.body.inputs.every((i) => i.associations[0].to.id === '123' && i.properties.qb_session_id === 'qb-b'));
  assert.deepEqual(store.dealPatch, saved);
  assert.deepEqual(store.archived, ['L-old-builder']); // manual lines untouched
});

test('make primary carries the NetSuite auto-split fields (qb_family, qb_line_type) onto the deal lines', async () => {
  const quote = { id: 'Q2', lineIds: ['QL1'], properties: { hs_title: 'Option B', hs_quote_progression_status: 'PUBLISHED', qb_session_id: 'qb-b', qb_builder_state: P.builderState({ setup: {}, products: [], ramp: {} }, {}) } };
  const { store, log } = fakeHubSpot({ quotes: [quote] });
  store.lineItems.QL1 = { name: 'AE plan', price: '1050', quantity: '1', qb_source: 'quote_builder', qb_session_id: 'qb-b', qb_family: 'autoelevate', qb_line_type: 'coterm' };
  const res = await setPrimaryFn().main({ parameters: { dealId: '123', quoteId: 'Q2' } });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  const create = log.find((l) => l.path === '/crm/objects/2026-09/line_items/batch/create');
  assert.equal(create.body.inputs[0].properties.qb_family, 'autoelevate');
  assert.equal(create.body.inputs[0].properties.qb_line_type, 'coterm');
});

test('line type: Upsell for a product the company is Active on, New otherwise, from the company record (not the card)', async () => {
  const { log, store } = fakeHubSpot({ companyProps: { ae_product: 'AE Active', optimize_product: 'Optimize Terminated' } });
  const res = await submitFn().main({
    parameters: payload({
      // The card can't claim the partner is Active on Optimize: the server reads the company.
      setup: Object.assign({}, payload().setup, { activeProducts: ['optimize365'] }),
      products: [
        { uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, tier: '', discountPct: 0, ramp: false },
        { uid: 2, family: 'oneoff', productId: '9900', quantity: 1, discountPct: 0, ramp: false },
      ],
      ramp: { enabled: false },
    }),
    accountId: 1,
  });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.ok(store.companyRead.properties.includes('ae_product') && store.companyRead.properties.includes('optimize_product'));
  const lines = log.find((l) => l.path === '/crm/objects/2026-09/line_items/batch/create').body.inputs.map((i) => i.properties);
  const ae = lines.filter((l) => l.hs_sku.includes('AE'));
  const opt = lines.filter((l) => l.hs_product_id === '9900');
  assert.ok(ae.length === 2 && ae.every((l) => l.qb_family === 'autoelevate' && l.qb_line_type === 'Upsell'));
  // A one-off SKU is tagged with its product's family so the auto-split moves it to the Optimize deal.
  assert.ok(opt.length === 1 && opt.every((l) => l.qb_family === 'optimize365' && l.qb_line_type === 'New'));
});

test('line type: a Co-term row writes coterm on every line, ramp lines included', async () => {
  const { log } = fakeHubSpot({ companyProps: { ae_product: 'AE Active' } });
  const res = await submitFn().main({
    parameters: payload({ products: [{ uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, tier: '', discountPct: 0, ramp: true, coterm: true }] }),
    accountId: 1,
  });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  const lines = log.find((l) => l.path === '/crm/objects/2026-09/line_items/batch/create').body.inputs.map((i) => i.properties);
  assert.equal(lines.length, 4);
  assert.ok(lines.every((l) => l.qb_line_type === 'coterm' && l.qb_family === 'autoelevate'));
});

test('line type: coterm must be true or false', async () => {
  fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ products: [{ uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, tier: '', discountPct: 0, ramp: false, coterm: 'yes' }] }), accountId: 1 });
  assert.equal(res.ok, false);
  assert.match(res.errors.join(' '), /coterm/);
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

test('whoever builds the quote owns it and is the seller, so they can request approval', async () => {
  // Pat (not the deal owner) builds on Riley's deal. HubSpot lets only the quote owner or creator
  // request approval, and app-made quotes have no creator, so Pat must own the quote.
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ builder: { email: 'pat.ops@example.com' } }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  const q = store.quote.properties;
  assert.deepEqual([q.hubspot_owner_id, q.hs_sender_firstname, q.hs_sender_lastname, q.hs_sender_email], ['88', 'Pat', 'Ops', 'pat.ops@example.com']);
  assert.equal(store.dealPatch && store.dealPatch.hubspot_owner_id, undefined); // the deal owner is untouched
  assert.equal(q.hs_payment_enabled, 'false'); // like every CyberFOX CPQ quote; payments would block sub-$35 ramp invoices
  const cat = await catalogFn().main({ parameters: { dealId: '123' }, accountId: 1 });
  assert.equal(cat.deal.owner.email, 'riley.rep@example.com');
});

test("the signed-in user HubSpot passes to the function wins over the card's copy", async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ builder: { email: 'riley.rep@example.com' } }), accountId: 1, userEmail: 'pat.ops@example.com' });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(store.quote.properties.hs_sender_email, 'pat.ops@example.com');
});

test('rep on their own deal: owner and seller are both the rep', async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ builder: { email: 'riley.rep@example.com' } }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  const q = store.quote.properties;
  assert.deepEqual([q.hubspot_owner_id, q.hs_sender_email], ['77', 'riley.rep@example.com']);
});

test('builder not found as a HubSpot user: falls back to the deal owner as owner and seller', async () => {
  const { store } = fakeHubSpot();
  const res = await submitFn().main({ parameters: payload({ builder: { email: 'nobody@example.com' } }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.deepEqual([store.quote.properties.hubspot_owner_id, store.quote.properties.hs_sender_email], ['77', 'riley.rep@example.com']);
});

test('no deal owner: the builder owns and sends the quote', async () => {
  const { store } = fakeHubSpot({ ownerId: '' });
  const res = await submitFn().main({ parameters: payload({ builder: { email: 'pat.ops@example.com' } }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.deepEqual([store.quote.properties.hubspot_owner_id, store.quote.properties.hs_sender_email], ['88', 'pat.ops@example.com']);
});

test('no deal owner and no known builder: quote is not created', async () => {
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
  const res = await submitFn().main({ parameters: payload({ editQuoteId: 'Q5', primary: false, builder: { email: 'pat.ops@example.com' } }), accountId: 1 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(res.edited, true);
  assert.equal(res.quoteId, 'Q5');
  assert.equal(res.primary, true); // it was the primary option (its run's lines are on the deal) and stays primary
  assert.equal(store.quote, null); // no new quote
  const creates = log.filter((l) => l.path === '/crm/objects/2026-09/line_items/batch/create');
  assert.equal(creates.length, 2); // deal lines + quote lines
  const quoteLines = creates.find((c) => c.body.inputs[0].associations[0].types[0].associationTypeId === 68);
  assert.ok(quoteLines.body.inputs.every((i) => i.associations[0].to.id === 'Q5' && i.properties.qb_session_id === 'qb-old'));
  assert.equal(store.quotePatches[0].properties.qb_session_id, 'qb-old');
  assert.equal(store.quotePatches[0].properties.hs_sender_email, 'pat.ops@example.com'); // whoever updates it can request approval
  assert.equal(store.quotePatches[0].properties.hubspot_owner_id, '88');
  assert.equal(store.quotePatches[0].properties.hs_payment_enabled, 'false');
  assert.ok(store.archived.includes('QL5a') && store.archived.includes('QL5b')); // old quote lines
  assert.ok(store.archived.includes('L-old-builder')); // old primary deal lines
  assert.ok(!store.archived.includes('L-manual'));
  assert.deepEqual(store.assocCalls, ['DELETE contacts 501', 'PUT contacts 501 69+702', 'PUT companies 7 71']); // template unchanged; company added to an older quote
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

test('one-off SKUs: catalog reads the One-Off SKUs folder; submit writes the picked product at its own price', async () => {
  const { log, store } = fakeHubSpot();
  const cat = await catalogFn().main({ parameters: { dealId: '123' }, accountId: 1 });
  const search = log.find((l) => l.path === '/crm/objects/2026-09/products/search');
  assert.ok(search.body.filterGroups.some((g) => g.filters.some((f) => f.propertyName === 'hs_folder' && f.value === 'One-Off SKUs')));
  assert.ok(cat.products.some((p) => p.id === '9900'));
  const res = await submitFn().main({
    parameters: payload({ products: [{ uid: 1, family: 'oneoff', productId: '9900', quantity: 1, discountPct: 0, ramp: false }], ramp: { enabled: false } }),
    accountId: 1,
  });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  assert.equal(res.title, 'Example MSP - Optimize365');
  const created = log.filter((l) => l.path === '/crm/objects/2026-09/line_items/batch/create').flatMap((l) => l.body.inputs.map((i) => i.properties));
  assert.ok(created.length >= 1 && created.every((p) => p.hs_product_id === '9900' && p.price === '4800' && p.hs_recurring_billing_period === 'P15M'));
});

test('2026-09 API: deal context uses the primary company and association batch reads, never legacy paths', async () => {
  const { log, store } = fakeHubSpot();
  const res = await catalogFn().main({ parameters: { dealId: '123' }, accountId: 2585282 });
  assert.equal(res.ok, true);
  // Company 7 is the primary (type 5) even though company 6 is listed first.
  const companyRead = log.find((l) => l.path === '/crm/objects/2026-09/companies/batch/read');
  assert.deepEqual(companyRead.body.inputs, [{ id: '7' }]);
  assert.deepEqual(store.assocReads.sort(), ['deals->companies', 'deals->contacts', 'deals->line_items', 'deals->quotes']);
  assert.ok(log.every((l) => !/\/v[34]\//.test(l.path)));
  const props = log.find((l) => l.path === '/crm/properties/2026-09/deals/batch/read');
  assert.equal(props.body.dataSensitivity, 'non_sensitive');
});

test('2026-09 API: association reads follow paging', async () => {
  const { store } = fakeHubSpot();
  store.pageAssociations = true;
  const res = await submitFn().main({ parameters: payload(), accountId: 2585282 });
  assert.equal(res.ok, true);
  // Both earlier lines came back across pages; only the builder one is archived.
  assert.deepEqual(store.archived, ['L-old-builder']);
});

test('2026-09 API: quote templates fall back to v3 if the date-based objects API refuses them', async () => {
  const { log, store } = fakeHubSpot();
  store.templates404 = true;
  store.allowLegacy = true;
  const res = await catalogFn().main({ parameters: { dealId: '123' }, accountId: 2585282 });
  assert.equal(res.ok, true);
  assert.deepEqual(res.templates.map((t) => t.id), ['10']);
  assert.deepEqual(log.filter((l) => /\/v3\//.test(l.path)).map((l) => l.path), ['/crm/v3/objects/quote_templates']);
});

test('CAD deal: line items use the products\' CAD prices and carry CAD; the quote is CAD', async () => {
  const cad = PRODUCTS.map((pr) => ({ id: pr.id, properties: Object.assign({}, pr.properties, pr.properties.hs_sku === 'Standard-AE-1000-Agent-Commit-2026' ? { hs_price_cad: '1390' } : pr.properties.hs_sku === 'Standard-AE-1000-Agent-Commit-Additional-Agents+2026' ? { hs_price_cad: '1.39' } : {}) }));
  const { log, store } = fakeHubSpot({ currency: 'CAD', products: cad });
  const res = await submitFn().main({ parameters: payload({ ramp: { enabled: false }, products: [{ uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, tier: '', discountPct: 0, ramp: false }] }), accountId: 2585282 });
  assert.equal(res.ok, true, (res.errors || []).join('; '));
  const created = log.filter((l) => l.path === '/crm/objects/2026-09/line_items/batch/create').flatMap((l) => l.body.inputs.map((i) => i.properties));
  assert.ok(created.length >= 2);
  assert.deepEqual([...new Set(created.map((c) => c.hs_line_item_currency_code))], ['CAD']);
  assert.deepEqual([...new Set(created.map((c) => `${c.hs_sku}=${c.price}`))].sort(), ['Standard-AE-1000-Agent-Commit-2026=1390', 'Standard-AE-1000-Agent-Commit-Additional-Agents+2026=1.39']);
  assert.equal(store.quote.properties.hs_currency, 'CAD');
  // The product search asks for every currency's price.
  assert.ok(log.find((l) => l.path === '/crm/objects/2026-09/products/search').body.properties.includes('hs_price_cad'));
});

test('CAD deal: a SKU with no CAD price stops the quote (never falls back to USD)', async () => {
  const { log } = fakeHubSpot({ currency: 'CAD' }); // fixture products have USD prices only
  const res = await submitFn().main({ parameters: payload({ ramp: { enabled: false }, products: [{ uid: 1, family: 'autoelevate', edition: 'standard', quantity: 1250, tier: '', discountPct: 0, ramp: false }] }), accountId: 2585282 });
  assert.equal(res.ok, false);
  assert.match(res.errors[0], /No CAD price on Standard-AE-1000-Agent-Commit-2026, Standard-AE-1000-Agent-Commit-Additional-Agents\+2026 in the product library/);
  assert.equal(log.filter((l) => l.path.endsWith('/batch/create')).length, 0);
});
