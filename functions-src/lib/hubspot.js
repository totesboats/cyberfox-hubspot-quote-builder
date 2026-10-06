'use strict';
// Minimal HubSpot API client for app functions. Uses the app's static-auth token
// (PRIVATE_APP_ACCESS_TOKEN is injected into private app functions by HubSpot).
const {
  DEAL_PROPERTIES,
  ENUM_PROPERTIES,
  FALLBACK_OPTIONS,
  LINE_SOURCE_PROPERTY,
  LINE_SOURCE_VALUE,
  LINE_SESSION_PROPERTY,
  QUOTE_SESSION_PROPERTY,
  QUOTE_STATE_PROPERTY,
} = require('./config.js');
const { normalizeTemplates, quoteLockState, parseBuilderState } = require('./pricing.js');

const BASE = 'https://api.hubapi.com';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function hs(path, { method = 'GET', body, retries = 2 } = {}) {
  const token = process.env.PRIVATE_APP_ACCESS_TOKEN;
  if (!token) throw new Error('PRIVATE_APP_ACCESS_TOKEN is not available to this function.');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const retryAfter = Number(res.headers.get('retry-after')) * 1000;
      await sleep(Math.min(retryAfter || 400 * (attempt + 1), 2000));
      continue;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error(`HubSpot ${method} ${path.split('?')[0]} failed (${res.status}): ${(data && data.message) || text.slice(0, 300)}`);
      err.status = res.status;
      err.details = data;
      throw err;
    }
    return data;
  }
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

async function searchAll(objectType, body, max = 2000) {
  const out = [];
  let after;
  do {
    const page = await hs(`/crm/v3/objects/${objectType}/search`, { method: 'POST', body: Object.assign({}, body, { limit: 200, after }) });
    out.push(...page.results);
    after = page.paging && page.paging.next ? page.paging.next.after : undefined;
  } while (after && out.length < max);
  return out;
}

async function batchCreate(objectType, inputs) {
  const results = [];
  for (const part of chunk(inputs, 100)) {
    const res = await hs(`/crm/v3/objects/${objectType}/batch/create`, { method: 'POST', body: { inputs: part } });
    if (res.status && res.status !== 'COMPLETE') throw new Error(`Batch create ${objectType} returned ${res.status}`);
    // HubSpot does not guarantee result order; restore it via the position property when present.
    const sorted = res.results.slice().sort((a, b) => Number(a.properties.hs_position_on_quote || 0) - Number(b.properties.hs_position_on_quote || 0));
    results.push(...sorted);
  }
  return results;
}

async function batchArchive(objectType, ids) {
  for (const part of chunk(ids, 100)) {
    await hs(`/crm/v3/objects/${objectType}/batch/archive`, { method: 'POST', body: { inputs: part.map((id) => ({ id: String(id) })) } });
  }
}

// ---------------------------------------------------------------------------
// Loaders used by both functions
// ---------------------------------------------------------------------------

const PRODUCT_PROPERTIES = ['name', 'hs_sku', 'price', 'hs_price_usd', 'qb_family', 'qb_edition', 'qb_segment', 'qb_billing', 'qb_tier', 'qb_component'];

async function loadProducts() {
  return searchAll('products', {
    filterGroups: [{ filters: [{ propertyName: 'qb_family', operator: 'HAS_PROPERTY' }, { propertyName: 'hs_status', operator: 'EQ', value: 'active' }] }],
    properties: PRODUCT_PROPERTIES,
  });
}

async function loadTemplates() {
  const res = await hs('/crm/v3/objects/quote_templates?limit=100&properties=hs_name,hs_type');
  return normalizeTemplates(res.results);
}

// Live dropdown options for the deal properties the quote prints as tokens.
async function loadDealOptions() {
  try {
    const res = await hs('/crm/v3/properties/deals/batch/read', { method: 'POST', body: { archived: false, inputs: ENUM_PROPERTIES.map((name) => ({ name })) } });
    const out = Object.assign({}, FALLBACK_OPTIONS);
    for (const p of res.results || []) out[p.name] = (p.options || []).filter((o) => !o.hidden).map((o) => ({ value: o.value, label: o.label }));
    return { options: out, issue: null };
  } catch (err) {
    return { options: Object.assign({}, FALLBACK_OPTIONS), issue: `Couldn't read deal property options (${err.message}); using defaults.` };
  }
}

async function loadDeal(dealId) {
  const deal = await hs(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}?properties=${DEAL_PROPERTIES.join(',')}&associations=companies,contacts,quotes`);
  const assoc = (type) => ((deal.associations && deal.associations[type] && deal.associations[type].results) || []).map((r) => String(r.id));
  const companyIds = assoc('companies');
  const contactIds = assoc('contacts').slice(0, 25);
  const quoteIds = assoc('quotes').slice(0, 50);
  const [companies, contacts, quotes, builderLines] = await Promise.all([
    companyIds.length ? hs('/crm/v3/objects/companies/batch/read', { method: 'POST', body: { inputs: [{ id: companyIds[0] }], properties: ['name'] } }) : { results: [] },
    contactIds.length ? hs('/crm/v3/objects/contacts/batch/read', { method: 'POST', body: { inputs: contactIds.map((id) => ({ id })), properties: ['firstname', 'lastname', 'jobtitle'] } }) : { results: [] },
    quoteIds.length
      ? hs('/crm/v3/objects/quotes/batch/read', {
          method: 'POST',
          body: {
            inputs: quoteIds.map((id) => ({ id })),
            properties: ['hs_title', 'hs_quote_progression_status', 'hs_quote_amount', 'hs_template_type', 'hs_expiration_date', 'hs_createdate', QUOTE_SESSION_PROPERTY, QUOTE_STATE_PROPERTY],
          },
        })
      : { results: [] },
    readBuilderLineItems(dealId),
  ]);
  // The primary option is the builder quote whose run put the current builder lines on the deal.
  const primarySession = builderLines.length ? builderLines[0].session : null;
  const company = companies.results[0];
  return {
    id: String(deal.id),
    properties: deal.properties,
    salesTeam: deal.properties.sales_team || null,
    company: company ? { id: String(company.id), name: company.properties.name } : null,
    // Name + title only: enough to pick a signer, nothing more.
    contacts: contacts.results.map((c) => ({
      id: String(c.id),
      label: [[c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || `Contact ${c.id}`, c.properties.jobtitle].filter(Boolean).join(' — '),
    })),
    quoteCount: quoteIds.length,
    quotes: quotes.results
      .map((q) => {
        const p = q.properties;
        const state = parseBuilderState(p[QUOTE_STATE_PROPERTY]);
        const session = p[QUOTE_SESSION_PROPERTY] || null;
        return {
          id: String(q.id),
          title: p.hs_title,
          progressionStatus: p.hs_quote_progression_status || 'DRAFT',
          lock: quoteLockState(p.hs_quote_progression_status),
          amount: p.hs_quote_amount == null ? null : Number(p.hs_quote_amount),
          templateType: p.hs_template_type,
          expirationDate: p.hs_expiration_date,
          createdAt: p.hs_createdate,
          builder: !!session,
          primary: !!session && session === primarySession,
          state, // builder inputs, so the card can start a new option from this quote
        };
      })
      .filter((q) => q.lock !== 'void')
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  };
}

async function readBuilderLineItems(dealId) {
  const res = await hs(`/crm/v4/objects/deals/${encodeURIComponent(dealId)}/associations/line_items?limit=500`);
  const ids = res.results.map((r) => String(r.toObjectId));
  if (!ids.length) return [];
  const read = await hs('/crm/v3/objects/line_items/batch/read', {
    method: 'POST',
    body: { inputs: ids.map((id) => ({ id })), properties: [LINE_SOURCE_PROPERTY, LINE_SESSION_PROPERTY] },
  });
  return read.results
    .filter((li) => li.properties[LINE_SOURCE_PROPERTY] === LINE_SOURCE_VALUE)
    .map((li) => ({ id: String(li.id), session: li.properties[LINE_SESSION_PROPERTY] || null }));
}

// Line items this builder created earlier on the deal (never touches anything else).
async function findBuilderLineItems(dealId, excludeSessionId) {
  return (await readBuilderLineItems(dealId)).filter((li) => li.session !== excludeSessionId).map((li) => li.id);
}

module.exports = { hs, searchAll, batchCreate, batchArchive, loadProducts, loadTemplates, loadDealOptions, loadDeal, findBuilderLineItems };
