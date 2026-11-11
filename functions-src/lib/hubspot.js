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
  ONE_OFF_FOLDER,
  HS_PATHS,
  CURRENCIES,
  COMPANY_PRODUCT_STATUS,
} = require('./config.js');
const { normalizeTemplates, quoteLockState, parseBuilderState, activeProducts } = require('./pricing.js');

const BASE = 'https://api.hubapi.com';
// Date-based API paths (see HS_API_VERSION in shared/config.mjs).
const OBJ = HS_PATHS.objects;
const enc = encodeURIComponent;
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
    const page = await hs(`${OBJ}/${objectType}/search`, { method: 'POST', body: Object.assign({}, body, { limit: 200, after }) });
    out.push(...page.results);
    after = page.paging && page.paging.next ? page.paging.next.after : undefined;
  } while (after && out.length < max);
  return out;
}

async function batchCreate(objectType, inputs) {
  const results = [];
  for (const part of chunk(inputs, 100)) {
    const res = await hs(`${OBJ}/${objectType}/batch/create`, { method: 'POST', body: { inputs: part } });
    if (res.status && res.status !== 'COMPLETE') throw new Error(`Batch create ${objectType} returned ${res.status}`);
    // HubSpot does not guarantee result order; restore it via the position property when present.
    const sorted = res.results.slice().sort((a, b) => Number(a.properties.hs_position_on_quote || 0) - Number(b.properties.hs_position_on_quote || 0));
    results.push(...sorted);
  }
  return results;
}

async function batchArchive(objectType, ids) {
  for (const part of chunk(ids, 100)) {
    await hs(`${OBJ}/${objectType}/batch/archive`, { method: 'POST', body: { inputs: part.map((id) => ({ id: String(id) })) } });
  }
}

// ---------------------------------------------------------------------------
// Loaders used by both functions
// ---------------------------------------------------------------------------

const PRODUCT_PROPERTIES = ['name', 'hs_sku', 'price', ...CURRENCIES.map((c) => `hs_price_${c.toLowerCase()}`), 'qb_family', 'qb_edition', 'qb_segment', 'qb_billing', 'qb_tier', 'qb_component', 'hs_folder', 'recurringbillingfrequency'];

// Tagged price-book products, plus every active product in the One-Off SKUs folder (read live, no tagging).
async function loadProducts() {
  const active = { propertyName: 'hs_status', operator: 'EQ', value: 'active' };
  return searchAll('products', {
    filterGroups: [
      { filters: [{ propertyName: 'qb_family', operator: 'HAS_PROPERTY' }, active] },
      { filters: [{ propertyName: 'hs_folder', operator: 'EQ', value: ONE_OFF_FOLDER }, active] },
      // Belt and braces in case the folder name is stored with a suffix; indexCatalog keeps exact matches only.
      { filters: [{ propertyName: 'hs_folder', operator: 'CONTAINS_TOKEN', value: 'One-Off' }, active] },
    ],
    properties: PRODUCT_PROPERTIES,
  });
}

async function loadTemplates() {
  const query = '?limit=100&properties=hs_name,hs_type';
  let res;
  try {
    res = await hs(`${OBJ}/quote_templates${query}`);
  } catch (err) {
    // HubSpot doesn't document quote templates under the date-based objects API yet. If it refuses
    // them, fall back to v3 (supported until September 2027) so the card keeps working.
    if (![400, 404].includes(err.status)) throw err;
    console.warn('quote_templates not available on the date-based API; using v3', err.message);
    res = await hs(`/crm/v3/objects/quote_templates${query}`);
  }
  return normalizeTemplates(res.results);
}

// Live dropdown options for the deal properties the quote prints as tokens.
async function loadDealOptions() {
  try {
    const res = await hs(`${HS_PATHS.properties}/deals/batch/read`, { method: 'POST', body: { archived: false, dataSensitivity: 'non_sensitive', inputs: ENUM_PROPERTIES.map((name) => ({ name })) } });
    const out = Object.assign({}, FALLBACK_OPTIONS);
    for (const p of res.results || []) out[p.name] = (p.options || []).filter((o) => !o.hidden).map((o) => ({ value: o.value, label: o.label }));
    return { options: out, issue: null };
  } catch (err) {
    return { options: Object.assign({}, FALLBACK_OPTIONS), issue: `Couldn't read deal property options (${err.message}); using defaults.` };
  }
}

// The deal owner is the quote's seller contact. Name + email only.
async function loadOwner(ownerId) {
  if (!ownerId) return null;
  try {
    const o = await hs(`${HS_PATHS.owners}/${enc(ownerId)}`);
    return { id: String(o.id), name: [o.firstName, o.lastName].filter(Boolean).join(' '), firstName: o.firstName || '', lastName: o.lastName || '', email: o.email || '' };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}

// The HubSpot owner record for a user's email (the person building the quote), or null.
async function findOwnerByEmail(email) {
  if (!email) return null;
  const res = await hs(`${HS_PATHS.owners}?email=${enc(email)}&limit=1`);
  const o = (res.results || [])[0];
  return o ? { id: String(o.id), name: [o.firstName, o.lastName].filter(Boolean).join(' '), firstName: o.firstName || '', lastName: o.lastName || '', email: o.email || email } : null;
}

async function loadDeal(dealId) {
  const [deal, companyLinks, contactIds, allQuoteIds] = await Promise.all([
    hs(`${OBJ}/deals/${enc(dealId)}?properties=${DEAL_PROPERTIES.join(',')}`),
    associations('deals', dealId, 'companies'),
    associatedIds('deals', dealId, 'contacts').then((ids) => ids.slice(0, 25)),
    associatedIds('deals', dealId, 'quotes'),
  ]);
  const quoteIds = allQuoteIds.slice(0, 50);
  // Primary company first (deal → company type 5), else the first associated company.
  const primaryCompany = companyLinks.find((l) => l.typeIds.includes(5)) || companyLinks[0];
  const companyIds = primaryCompany ? [primaryCompany.id] : [];
  const [companies, contacts, quotes, builderLines, owner] = await Promise.all([
    companyIds.length ? hs(`${OBJ}/companies/batch/read`, { method: 'POST', body: { inputs: [{ id: companyIds[0] }], properties: ['name'].concat(Object.values(COMPANY_PRODUCT_STATUS).map((s) => s.property)) } }) : { results: [] },
    contactIds.length ? hs(`${OBJ}/contacts/batch/read`, { method: 'POST', body: { inputs: contactIds.map((id) => ({ id })), properties: ['firstname', 'lastname', 'jobtitle'] } }) : { results: [] },
    quoteIds.length
      ? hs(`${OBJ}/quotes/batch/read`, {
          method: 'POST',
          body: {
            inputs: quoteIds.map((id) => ({ id })),
            properties: ['hs_title', 'hs_quote_progression_status', 'hs_quote_amount', 'hs_template_type', 'hs_expiration_date', 'hs_createdate', QUOTE_SESSION_PROPERTY, QUOTE_STATE_PROPERTY],
          },
        })
      : { results: [] },
    readBuilderLineItems(dealId),
    loadOwner(deal.properties.hubspot_owner_id),
  ]);
  // The primary option is the builder quote whose run put the current builder lines on the deal.
  const primarySession = builderLines.length ? builderLines[0].session : null;
  const company = companies.results[0];
  return {
    id: String(deal.id),
    properties: deal.properties,
    salesTeam: deal.properties.sales_team || null,
    owner,
    // activeProducts: families the company is Active on, so the builder can tag lines New or Upsell.
    company: company ? { id: String(company.id), name: company.properties.name, activeProducts: activeProducts(company.properties) } : null,
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
          session,
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
  const ids = await associatedIds('deals', dealId, 'line_items');
  if (!ids.length) return [];
  const read = await hs(`${OBJ}/line_items/batch/read`, {
    method: 'POST',
    body: { inputs: ids.map((id) => ({ id })), properties: [LINE_SOURCE_PROPERTY, LINE_SESSION_PROPERTY] },
  });
  return read.results
    .filter((li) => li.properties[LINE_SOURCE_PROPERTY] === LINE_SOURCE_VALUE)
    .map((li) => ({ id: String(li.id), session: li.properties[LINE_SESSION_PROPERTY] || null }));
}

// Line items this builder created earlier on the deal (never touches anything else).
// excludeSessionId keeps one run's lines; keepIds keeps specific lines (used when editing in place).
async function findBuilderLineItems(dealId, excludeSessionId, keepIds = []) {
  const keep = new Set(keepIds.map(String));
  return (await readBuilderLineItems(dealId))
    .filter((li) => (excludeSessionId == null || li.session !== excludeSessionId) && !keep.has(li.id))
    .map((li) => li.id);
}

// Association helpers. The date-based API has no "list one record's associations" GET, so reads use
// the associations batch read with a single input, following its per-input paging.
async function associations(fromType, fromId, toType) {
  const out = [];
  let after;
  do {
    const input = after ? { id: String(fromId), after } : { id: String(fromId) };
    const res = await hs(`${HS_PATHS.associations}/${fromType}/${toType}/batch/read`, { method: 'POST', body: { inputs: [input] } });
    after = undefined;
    for (const r of (res && res.results) || []) {
      for (const t of r.to || []) out.push({ id: String(t.toObjectId), typeIds: (t.associationTypes || []).map((a) => Number(a.typeId)) });
      if (r.paging && r.paging.next && r.paging.next.after) after = r.paging.next.after;
    }
  } while (after && out.length < 5000);
  return out;
}
async function associatedIds(fromType, fromId, toType) {
  return (await associations(fromType, fromId, toType)).map((a) => a.id);
}
async function associate(fromType, fromId, toType, toId, typeIds) {
  await hs(`${OBJ}/${fromType}/${enc(fromId)}/associations/${toType}/${enc(toId)}`, {
    method: 'PUT',
    body: typeIds.map((associationTypeId) => ({ associationCategory: 'HUBSPOT_DEFINED', associationTypeId })),
  });
}
async function unassociate(fromType, fromId, toType, toId) {
  await hs(`${OBJ}/${fromType}/${enc(fromId)}/associations/${toType}/${enc(toId)}`, { method: 'DELETE' });
}

module.exports = { hs, OBJ, searchAll, batchCreate, batchArchive, loadProducts, loadTemplates, loadDealOptions, loadDeal, findOwnerByEmail, findBuilderLineItems, associatedIds, associate, unassociate };
