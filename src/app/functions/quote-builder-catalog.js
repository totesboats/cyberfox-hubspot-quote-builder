'use strict';
// Loads everything the card needs in one round trip: tagged products, quote templates
// and the deal's context.
const { loadProducts, loadTemplates, loadDealOptions, loadDeal } = require('./lib/hubspot.js');
const { indexCatalog } = require('./lib/pricing.js');

exports.main = async (context) => {
  const params = context.parameters || {};
  const dealId = params.dealId || (context.propertiesToSend && context.propertiesToSend.hs_object_id);
  if (!dealId) return { ok: false, errors: ['dealId is required'] };

  try {
    const [products, templates, dealOptions, deal] = await Promise.all([loadProducts(), loadTemplates(), loadDealOptions(), loadDeal(dealId)]);
    const catalog = indexCatalog(products);
    const issues = catalog.issues.slice();
    if (dealOptions.issue) issues.push(dealOptions.issue);
    if (!products.length) issues.push('No products are tagged for the Quote Builder (qb_family is empty on every product).');
    return {
      ok: true,
      products, // raw tagged products; the card re-indexes with the same shared code
      templates,
      dealOptions: dealOptions.options,
      deal,
      issues,
      portalId: context.accountId,
      loadedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.error('quote-builder-catalog failed', err.message, err.details || '');
    return { ok: false, errors: [err.message] };
  }
};
