'use strict';
// Rebuilds the quote from fresh catalog data (never trusts client prices), then writes:
//   1. line items on the deal (primary option only)   2. a separate copy of each on the quote
//   3. the quote (template, contact, deal, builder state)   4. the printed deal properties
//   5. for the primary option, archives line items an earlier builder run left on the deal
// A deal can hold several builder quotes ("options", e.g. 100 vs 250 agents). Only the
// primary option's lines sit on the deal, so the deal amount reflects one option.
// Anything created before a failure is archived again so a failed run leaves no debris.
// With editQuoteId it edits a builder quote in place instead (draft / changes requested only):
// new line items replace the quote's old ones, the quote keeps its id, link and option status.
const { hs, batchCreate, batchArchive, loadProducts, loadTemplates, loadDealOptions, loadDeal, findBuilderLineItems, associatedIds, associate, unassociate } = require('./lib/hubspot.js');
const { indexCatalog, buildQuote, lineItemProperties, validateSubmission, autoQuoteName, dealWrites, builderState, openQuoteConflicts, quoteEditability } = require('./lib/pricing.js');
const { QUOTE_DEFAULTS, QUOTE_SESSION_PROPERTY, QUOTE_STATE_PROPERTY } = require('./lib/config.js');

const ASSOC = {
  lineItemToDeal: 20,
  quoteToDeal: 64,
  quoteToLineItem: 67,
  quoteToContact: 69,
  quoteToTemplate: 286,
  quoteToSigner: 702,
  lineItemToQuote: 68,
};
const link = (id, typeId) => ({ to: { id: String(id) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: typeId }] });

exports.main = async (context) => {
  const payload = context.parameters || {};
  const dealId = String(payload.dealId || '');
  const errors = validateSubmission(payload);
  if (!dealId) errors.push('dealId is required');
  if (errors.length) return { ok: false, errors };

  let products, templates, dealOptions, deal;
  try {
    [products, templates, dealOptions, deal] = await Promise.all([loadProducts(), loadTemplates(), loadDealOptions(), loadDeal(dealId)]);
  } catch (err) {
    console.error('quote-builder-submit load failed', err.message);
    return { ok: false, errors: [err.message] };
  }
  if (!deal.owner) return { ok: false, errors: ['Assign a deal owner first. The quote\'s seller contact is always the deal owner.'] };
  const template = templates.find((t) => t.id === String(payload.setup.templateId));
  if (!template) return { ok: false, errors: ['The selected quote template no longer exists.'] };

  const setup = Object.assign({}, payload.setup, { salesTeam: deal.salesTeam, templateType: template.templateType });
  const catalog = indexCatalog(products);
  const quote = buildQuote(setup, payload.products, payload.ramp, catalog);
  if (quote.blocking.length) return { ok: false, errors: quote.blocking.map((b) => b.error) };
  if (quote.conflicts.length) return { ok: false, errors: quote.conflicts };
  if (!quote.lines.length) return { ok: false, errors: ['Nothing to quote.'] };
  const writes = dealWrites(quote, { setup, notes: payload.notes }, dealOptions.options);
  if (writes.errors.length) return { ok: false, errors: writes.errors };

  const signerId = payload.setup.signerContactId && deal.contacts.some((c) => c.id === String(payload.setup.signerContactId)) ? String(payload.setup.signerContactId) : null;
  const isCpq = template.templateType === 'CPQ_QUOTE';
  if (isCpq && payload.setup.acceptance === 'esignature' && !signerId) return { ok: false, errors: ['E-signature quotes need a signer contact associated with the deal.'] };

  let editing = null;
  if (payload.editQuoteId) {
    editing = deal.quotes.find((q) => q.id === String(payload.editQuoteId));
    if (!editing) return { ok: false, errors: ['That quote is not on this deal.'] };
    const can = quoteEditability(editing);
    if (!can.editable) return { ok: false, errors: [`This quote can't be edited: ${can.reason}`] };
    if (editing.templateType && editing.templateType !== template.templateType) {
      return { ok: false, errors: ["An existing quote can't switch between a CPQ and a legacy template. Pick a template of the same kind, or start a new option."] };
    }
  }

  const sessionId = editing ? editing.session : `qb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lineProps = quote.lines.map((l) => lineItemProperties(l, { billing: setup.billing, rampMonths: quote.ramp.months, sessionId }));
  const created = { dealLines: [], quoteLines: [], quoteId: null };
  // Primary unless the rep says otherwise; the first builder quote on a deal is always primary.
  // An edited quote keeps whatever option status it had.
  const primary = editing ? editing.primary : payload.primary !== false || !deal.quotes.some((q) => q.builder);
  const affected = openQuoteConflicts(deal.quotes.filter((q) => !editing || q.id !== editing.id), deal.properties, writes.properties).quotes;
  const title = (payload.setup.quoteName || '').trim() || autoQuoteName(deal.company && deal.company.name, payload.products, quote.anyRamp ? quote.ramp.months : 0);
  const quoteProps = {
    hs_title: title.slice(0, 250),
    hs_expiration_date: payload.setup.expirationDate,
    hs_template_type: template.templateType,
    hs_language: QUOTE_DEFAULTS.language,
    hs_currency: (deal.properties.deal_currency_code || QUOTE_DEFAULTS.currency).toUpperCase(),
    hs_payment_enabled: String(QUOTE_DEFAULTS.paymentEnabled),
    // Seller contact = deal owner, always.
    hubspot_owner_id: deal.owner.id,
    hs_sender_firstname: deal.owner.firstName,
    hs_sender_lastname: deal.owner.lastName,
    hs_sender_email: deal.owner.email,
    [QUOTE_SESSION_PROPERTY]: sessionId,
    [QUOTE_STATE_PROPERTY]: builderState({ setup: payload.setup, products: payload.products, ramp: payload.ramp, notes: payload.notes }, writes.properties),
  };
  if (isCpq) quoteProps.hs_acceptance_method = payload.setup.acceptance || 'esignature';
  else if (!editing) quoteProps.hs_status = 'DRAFT';
  const result = (quoteId) => ({
    ok: true,
    edited: !!editing,
    quoteId,
    quoteUrl: `https://app.hubspot.com/quotes/${context.accountId}/details/${quoteId}`,
    title,
    templateType: template.templateType,
    lineCount: lineProps.length,
    primary,
    replaced: 0,
    openQuotesAffected: affected.map((q) => ({ id: q.id, title: q.title })),
    approval: quote.approval,
    totals: quote.totals,
    dealProperties: writes.properties,
    warnings: writes.warnings,
  });

  if (editing) return editInPlace({ editing, dealId, template, signerId, isCpq, payload, lineProps, quoteProps, primary, writes, result });

  try {
    if (primary) created.dealLines = await batchCreate('line_items', lineProps.map((properties) => ({ properties, associations: [link(dealId, ASSOC.lineItemToDeal)] })));
    created.quoteLines = await batchCreate('line_items', lineProps.map((properties) => ({ properties })));

    const associations = [link(dealId, ASSOC.quoteToDeal), link(template.id, ASSOC.quoteToTemplate)]
      .concat(created.quoteLines.map((li) => link(li.id, ASSOC.quoteToLineItem)));
    if (signerId) {
      associations.push(link(signerId, ASSOC.quoteToContact));
      if (isCpq && payload.setup.acceptance === 'esignature') associations.push(link(signerId, ASSOC.quoteToSigner));
    }
    const created_quote = await hs('/crm/v3/objects/quotes', { method: 'POST', body: { properties: quoteProps, associations } });
    created.quoteId = String(created_quote.id);

    await hs(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, { method: 'PATCH', body: { properties: writes.properties } });

    let replaced = 0;
    if (primary) {
      const old = await findBuilderLineItems(dealId, sessionId);
      if (old.length) await batchArchive('line_items', old);
      replaced = old.length;
    }

    return Object.assign(result(created.quoteId), { replaced });
  } catch (err) {
    console.error('quote-builder-submit failed; rolling back', err.message, err.details || '');
    const rollbackErrors = [];
    if (created.quoteId) await hs(`/crm/v3/objects/quotes/${created.quoteId}`, { method: 'DELETE' }).catch((e) => rollbackErrors.push(e.message));
    const lineIds = created.dealLines.concat(created.quoteLines).map((li) => li.id);
    if (lineIds.length) await batchArchive('line_items', lineIds).catch((e) => rollbackErrors.push(e.message));
    return { ok: false, errors: [err.message].concat(rollbackErrors.map((m) => `Rollback: ${m}`)) };
  }
};

// Edit a builder quote in place: same quote id, new line items, updated properties.
async function editInPlace({ editing, dealId, template, signerId, isCpq, payload, lineProps, quoteProps, primary, writes, result }) {
  const quoteId = editing.id;
  const created = { dealLines: [], quoteLines: [] };
  let before = null;
  try {
    const oldQuoteLines = await associatedIds('quotes', quoteId, 'line_items');
    const current = (await hs(`/crm/v3/objects/quotes/${encodeURIComponent(quoteId)}?properties=${Object.keys(quoteProps).join(',')}`)).properties || {};
    before = Object.fromEntries(Object.keys(quoteProps).map((k) => [k, current[k] == null ? '' : current[k]]));

    if (primary) created.dealLines = await batchCreate('line_items', lineProps.map((properties) => ({ properties, associations: [link(dealId, ASSOC.lineItemToDeal)] })));
    created.quoteLines = await batchCreate('line_items', lineProps.map((properties) => ({ properties, associations: [link(quoteId, ASSOC.lineItemToQuote)] })));
    await hs(`/crm/v3/objects/quotes/${encodeURIComponent(quoteId)}`, { method: 'PATCH', body: { properties: quoteProps } });

    const templates = await associatedIds('quotes', quoteId, 'quote_template');
    if (!templates.includes(String(template.id))) {
      for (const id of templates) await unassociate('quotes', quoteId, 'quote_template', id);
      await associate('quotes', quoteId, 'quote_template', template.id, [ASSOC.quoteToTemplate]);
    }
    const contacts = await associatedIds('quotes', quoteId, 'contacts');
    for (const id of contacts) await unassociate('quotes', quoteId, 'contacts', id);
    if (signerId) await associate('quotes', quoteId, 'contacts', signerId, isCpq && payload.setup.acceptance === 'esignature' ? [ASSOC.quoteToContact, ASSOC.quoteToSigner] : [ASSOC.quoteToContact]);

    if (oldQuoteLines.length) await batchArchive('line_items', oldQuoteLines);
    await hs(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, { method: 'PATCH', body: { properties: writes.properties } });

    let replaced = 0;
    if (primary) {
      const old = await findBuilderLineItems(dealId, null, created.dealLines.map((li) => li.id));
      if (old.length) await batchArchive('line_items', old);
      replaced = old.length;
    }
    return Object.assign(result(quoteId), { replaced });
  } catch (err) {
    console.error('quote-builder-submit edit failed; rolling back', err.message, err.details || '');
    const rollbackErrors = [];
    const lineIds = created.dealLines.concat(created.quoteLines).map((li) => li.id);
    if (lineIds.length) await batchArchive('line_items', lineIds).catch((e) => rollbackErrors.push(e.message));
    if (before) await hs(`/crm/v3/objects/quotes/${encodeURIComponent(quoteId)}`, { method: 'PATCH', body: { properties: before } }).catch((e) => rollbackErrors.push(e.message));
    return { ok: false, errors: [err.message].concat(rollbackErrors.map((m) => `Rollback: ${m}`)) };
  }
}
