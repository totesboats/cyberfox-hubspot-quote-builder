'use strict';
// Rebuilds the quote from fresh catalog data (never trusts client prices), then writes:
//   1. line items on the deal (primary option only)   2. a separate copy of each on the quote
//   3. the quote (template, contact, deal, builder state)   4. the printed deal properties
//   5. for the primary option, archives line items an earlier builder run left on the deal
// A deal can hold several builder quotes ("options", e.g. 100 vs 250 agents). Only the
// primary option's lines sit on the deal, so the deal amount reflects one option.
// Anything created before a failure is archived again so a failed run leaves no debris.
const { hs, batchCreate, batchArchive, loadProducts, loadTemplates, loadDealOptions, loadDeal, findBuilderLineItems } = require('./lib/hubspot.js');
const { indexCatalog, buildQuote, lineItemProperties, validateSubmission, autoQuoteName, dealWrites, builderState, openQuoteConflicts } = require('./lib/pricing.js');
const { QUOTE_DEFAULTS, QUOTE_SESSION_PROPERTY, QUOTE_STATE_PROPERTY } = require('./lib/config.js');

const ASSOC = {
  lineItemToDeal: 20,
  quoteToDeal: 64,
  quoteToLineItem: 67,
  quoteToContact: 69,
  quoteToTemplate: 286,
  quoteToSigner: 702,
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

  const sessionId = `qb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lineProps = quote.lines.map((l) => lineItemProperties(l, { billing: setup.billing, rampMonths: quote.ramp.months, sessionId }));
  const created = { dealLines: [], quoteLines: [], quoteId: null };
  // Primary unless the rep says otherwise; the first builder quote on a deal is always primary.
  const primary = payload.primary !== false || !deal.quotes.some((q) => q.builder);
  const affected = openQuoteConflicts(deal.quotes, deal.properties, writes.properties).quotes;
  const title = (payload.setup.quoteName || '').trim() || autoQuoteName(deal.company && deal.company.name, payload.products, quote.anyRamp ? quote.ramp.months : 0);

  try {
    if (primary) created.dealLines = await batchCreate('line_items', lineProps.map((properties) => ({ properties, associations: [link(dealId, ASSOC.lineItemToDeal)] })));
    created.quoteLines = await batchCreate('line_items', lineProps.map((properties) => ({ properties })));

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
    else quoteProps.hs_status = 'DRAFT';

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

    return {
      ok: true,
      quoteId: created.quoteId,
      quoteUrl: `https://app.hubspot.com/quotes/${context.accountId}/details/${created.quoteId}`,
      title,
      templateType: template.templateType,
      lineCount: created.quoteLines.length,
      primary,
      replaced,
      openQuotesAffected: affected.map((q) => ({ id: q.id, title: q.title })),
      approval: quote.approval,
      totals: quote.totals,
      dealProperties: writes.properties,
      warnings: writes.warnings,
    };
  } catch (err) {
    console.error('quote-builder-submit failed; rolling back', err.message, err.details || '');
    const rollbackErrors = [];
    if (created.quoteId) await hs(`/crm/v3/objects/quotes/${created.quoteId}`, { method: 'DELETE' }).catch((e) => rollbackErrors.push(e.message));
    const lineIds = created.dealLines.concat(created.quoteLines).map((li) => li.id);
    if (lineIds.length) await batchArchive('line_items', lineIds).catch((e) => rollbackErrors.push(e.message));
    return { ok: false, errors: [err.message].concat(rollbackErrors.map((m) => `Rollback: ${m}`)) };
  }
};
