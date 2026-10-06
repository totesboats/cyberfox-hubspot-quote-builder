'use strict';
// Makes an existing builder quote the deal's primary option:
//   1. copies that quote's line items onto the deal (same run id, so the card sees it as primary)
//   2. archives the line items the previous primary option left on the deal
//   3. writes the quote's printed deal properties back to the deal
// Published quotes keep their frozen values; open (draft / pending approval) quotes would
// pick up the new deal values, which the card warns about before calling this.
const { hs, batchCreate, batchArchive, loadDeal, findBuilderLineItems } = require('./lib/hubspot.js');
const { LINE_SOURCE_PROPERTY, LINE_SESSION_PROPERTY } = require('./lib/config.js');

// Line item properties copied from the quote's lines (everything the builder writes).
const COPY = [
  'hs_product_id', 'name', 'hs_sku', 'quantity', 'price', 'hs_discount_percentage', 'recurringbillingfrequency',
  'hs_recurring_billing_period', 'hs_recurring_billing_terms', 'hs_billing_start_delay_type', 'hs_billing_start_delay_months',
  'hs_position_on_quote', 'ramp', 'approval_discount', 'approval_ramp_months', LINE_SOURCE_PROPERTY, LINE_SESSION_PROPERTY,
];

exports.main = async (context) => {
  const { dealId, quoteId } = context.parameters || {};
  if (!dealId || !quoteId) return { ok: false, errors: ['dealId and quoteId are required'] };
  const created = [];
  try {
    const deal = await loadDeal(String(dealId));
    const quote = deal.quotes.find((q) => q.id === String(quoteId));
    if (!quote) return { ok: false, errors: ['That quote is not on this deal.'] };
    if (!quote.builder || !quote.state) return { ok: false, errors: ['Only quotes made with the Quote Builder can be made primary here.'] };
    if (quote.primary) return { ok: true, unchanged: true };

    const assoc = await hs(`/crm/v4/objects/quotes/${encodeURIComponent(quote.id)}/associations/line_items?limit=500`);
    const ids = assoc.results.map((r) => String(r.toObjectId));
    if (!ids.length) return { ok: false, errors: ['That quote has no line items.'] };
    const read = await hs('/crm/v3/objects/line_items/batch/read', { method: 'POST', body: { inputs: ids.map((id) => ({ id })), properties: COPY } });
    const session = read.results[0].properties[LINE_SESSION_PROPERTY];

    const inputs = read.results.map((li) => {
      const properties = {};
      for (const k of COPY) if (li.properties[k] != null && li.properties[k] !== '') properties[k] = li.properties[k];
      return { properties, associations: [{ to: { id: String(dealId) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 20 }] }] };
    });
    created.push(...(await batchCreate('line_items', inputs)));

    await hs(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, { method: 'PATCH', body: { properties: quote.state.dealProperties || {} } });
    const old = await findBuilderLineItems(String(dealId), session);
    if (old.length) await batchArchive('line_items', old);
    return { ok: true, quoteId: quote.id, lineCount: created.length, replaced: old.length };
  } catch (err) {
    console.error('quote-builder-set-primary failed', err.message, err.details || '');
    if (created.length) await batchArchive('line_items', created.map((li) => li.id)).catch(() => {});
    return { ok: false, errors: [err.message] };
  }
};
