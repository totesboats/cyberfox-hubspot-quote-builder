// Pure pricing, ramp and approval logic shared by the card (live preview) and the
// submit function (authoritative rebuild). No HubSpot calls in here.
import {
  FAMILIES,
  BILLING,
  MAX_RAMP_MONTHS,
  APPROVAL,
  TIMUS,
  RAMP_NAME_PREFIX,
  SET_BILLING_DELAY_AFTER_RAMP,
  LINE_SOURCE_PROPERTY,
  LINE_SOURCE_VALUE,
  LINE_SESSION_PROPERTY,
  TEMPLATE_HINTS,
  TEMPLATE_HIDE,
  AE_FEATURE_TYPES,
  AGREEMENT_LENGTH_M2M,
  PAYMENT_FREQUENCY_DEFAULT,
  WRITE_CONTRACT_TERM,
  QUOTE_OPEN_STATUSES,
  QUOTE_IGNORED_STATUSES,
  PRINTED_DEAL_PROPERTIES,
} from './config.mjs';

export function toNum(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function formatMoney(n, decimals = 2) {
  return '$' + toNum(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatInt(n) {
  return Math.round(toNum(n)).toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export function normalizeProduct(record) {
  const p = record.properties || record;
  const tierRaw = p.qb_tier;
  return {
    id: String(record.id != null ? record.id : p.hs_object_id),
    name: (p.name || '').trim(),
    sku: (p.hs_sku || '').trim(),
    // Multi-currency portals store the list price in hs_price_<currency>.
    price: toNum(p.hs_price_usd != null && p.hs_price_usd !== '' ? p.hs_price_usd : p.price),
    family: p.qb_family || null,
    edition: p.qb_edition || 'standard',
    segment: p.qb_segment || 'MSP',
    billing: p.qb_billing || 'monthly',
    tier: tierRaw != null && tierRaw !== '' ? toNum(tierRaw, null) : null,
    component: p.qb_component || 'base',
  };
}

export function catalogKey(family, edition, segment, billing) {
  return [family, edition, segment, billing].join('|');
}

// Builds { tiers: { key: { tier: { base, additional } } }, timus: { minimum, satgat }, issues }
export function indexCatalog(records) {
  const tiers = {};
  const timus = { minimum: null, satgat: {} };
  const issues = [];
  for (const record of records || []) {
    const p = normalizeProduct(record);
    if (!p.family || !FAMILIES[p.family]) continue;
    if (p.family === 'timus') {
      if (p.component === 'minimum') timus.minimum = p;
      else if (p.component === 'satgat' && p.tier) timus.satgat[p.tier] = p;
      continue;
    }
    if (!p.tier) {
      issues.push(`${p.sku || p.id}: qb_tier is empty`);
      continue;
    }
    const key = catalogKey(p.family, p.edition, p.segment, p.billing);
    const slot = p.component === 'additional' ? 'additional' : 'base';
    tiers[key] = tiers[key] || {};
    tiers[key][p.tier] = tiers[key][p.tier] || {};
    if (tiers[key][p.tier][slot]) {
      issues.push(`Two ${slot} SKUs for ${key} tier ${p.tier}: ${tiers[key][p.tier][slot].sku} and ${p.sku}`);
      continue;
    }
    tiers[key][p.tier][slot] = p;
  }
  return { tiers, timus, issues };
}

export function normalizeTimusList(row) {
  const v = row.values || row;
  const optional = (x) => (x == null || x === '' ? null : toNum(x, null));
  return {
    value: String(v.price_list_value || v.value || ''),
    label: v.label || v.name || String(v.price_list_value || ''),
    minimum: toNum(v.min_mrr != null ? v.min_mrr : v.minimum),
    gatewayRate: toNum(v.gateway_rate != null ? v.gateway_rate : v.gatewayRate),
    advancedUserRate: optional(v.advanced_user_rate != null ? v.advanced_user_rate : v.advancedUserRate),
    essentialsUserRate: optional(v.essentials_user_rate != null ? v.essentials_user_rate : v.essentialsUserRate),
    active: v.active === undefined ? true : v.active === true || v.active === 1 || v.active === 'true',
  };
}

// Quote templates from /crm/v3/objects/quote_templates → rep-facing list.
export function normalizeTemplates(records) {
  const typeMap = { cpq_template: 'CPQ_QUOTE', customizable_quote_template: 'CUSTOMIZABLE_QUOTE_TEMPLATE' };
  return (records || [])
    .map((r) => {
      const p = r.properties || r;
      const name = (p.hs_name || '').trim();
      const templateType = typeMap[p.hs_type];
      const families = Object.keys(TEMPLATE_HINTS).filter((f) => new RegExp(TEMPLATE_HINTS[f], 'i').test(name));
      return { id: String(r.id), name, templateType, families };
    })
    .filter((t) => t.templateType && t.name && !TEMPLATE_HIDE.some((h) => t.name.toLowerCase().includes(h)))
    .sort((a, b) => (a.templateType === b.templateType ? a.name.localeCompare(b.name) : a.templateType === 'CPQ_QUOTE' ? -1 : 1));
}

// Best template for the families on the quote: CPQ first, most families covered.
export function suggestTemplate(templates, families) {
  const wanted = Array.from(new Set(families || []));
  let best = null;
  let bestScore = -1;
  for (const t of templates || []) {
    const covered = wanted.filter((f) => t.families.includes(f)).length;
    if (!covered) continue;
    const score = covered * 10 + (t.templateType === 'CPQ_QUOTE' ? 5 : 0) - t.families.filter((f) => !wanted.includes(f)).length;
    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pricing one product row
// ---------------------------------------------------------------------------

function makeLine(fields) {
  const gross = round2(fields.quantity * fields.unitPrice);
  const net = round2(gross * (1 - fields.discountPct / 100));
  return Object.assign({}, fields, {
    gross,
    net,
    mrr: fields.annual ? net / 12 : net,
    listMrr: fields.annual ? gross / 12 : gross,
  });
}

// Every commit tier that can cover `quantity`, cheapest first in `best`.
export function tierOptionsFor(tiersForKey, quantity) {
  const options = Object.keys(tiersForKey || {})
    .map(Number)
    .sort((a, b) => a - b)
    .filter((t) => tiersForKey[t].base)
    .map((t) => {
      const base = tiersForKey[t].base;
      const additional = tiersForKey[t].additional || null;
      let baseQty;
      let addQty = 0;
      let cost;
      if (additional) {
        baseQty = 1;
        addQty = Math.max(0, quantity - t);
        cost = base.price + addQty * additional.price;
      } else {
        // Pack-style SKUs (no overage SKU): buy enough packs to cover the count.
        baseQty = Math.max(1, Math.ceil(quantity / t));
        cost = baseQty * base.price;
      }
      return { tier: t, base, additional, baseQty, addQty, cost: round2(cost) };
    });
  let best = options[0] || null;
  for (const o of options) if (o.cost < best.cost - 1e-9) best = o;
  return { options, best };
}

export function priceProduct(input, setup, catalog, timusLists) {
  const family = FAMILIES[input.family];
  const quantity = Math.max(0, Math.round(toNum(input.quantity)));
  const discountPct = clamp(round2(toNum(input.discountPct)), 0, 100);
  const result = {
    uid: input.uid,
    family: input.family,
    quantity,
    discountPct,
    lines: [],
    tierOptions: [],
    chosenTier: null,
    bestTier: null,
    annual: false,
    hint: '',
    hintLevel: 'info',
    error: '',
    timus: null,
  };
  if (!family) {
    result.error = `Unknown product family "${input.family}".`;
    return result;
  }
  if (input.family === 'timus') return priceTimus(input, setup, catalog, timusLists, result);

  const edition = effectiveEdition(input);
  const key = catalogKey(input.family, edition, setup.segment, setup.billing);
  const tiersForKey = catalog.tiers[key];
  const billingLabel = (BILLING[setup.billing] || {}).label || setup.billing;
  if (!tiersForKey) {
    const ed = family.editions.length > 1 ? ` ${edition}` : '';
    result.error = `No ${setup.segment} ${billingLabel.toLowerCase()} SKUs exist for ${family.label}${ed}. Change billing or edition.`;
    return result;
  }
  const annual = setup.billing === 'annual';
  result.annual = annual;
  const per = annual ? '/yr' : '/mo';

  const { options, best } = tierOptionsFor(tiersForKey, quantity);
  if (!best) {
    result.error = `No base SKU found for ${family.label} (${key}).`;
    return result;
  }
  const requested = input.tier != null && input.tier !== '' ? toNum(input.tier, null) : null;
  const chosen = options.find((o) => o.tier === requested) || best;
  result.tierOptions = options.map((o) => ({
    value: String(o.tier),
    label: `${formatInt(o.tier)} ${family.unit} — ${formatMoney(o.cost)}${per}${o === best ? ' (best price)' : ''}`,
    cost: o.cost,
  }));
  result.chosenTier = chosen.tier;
  result.bestTier = best.tier;

  result.lines.push(
    makeLine({
      family: input.family,
      kind: 'base',
      productId: chosen.base.id,
      name: chosen.base.name,
      sku: chosen.base.sku,
      quantity: chosen.baseQty,
      unitPrice: chosen.base.price,
      discountPct,
      annual,
    })
  );
  if (chosen.additional && chosen.addQty > 0) {
    result.lines.push(
      makeLine({
        family: input.family,
        kind: 'additional',
        productId: chosen.additional.id,
        name: chosen.additional.name,
        sku: chosen.additional.sku,
        quantity: chosen.addQty,
        unitPrice: chosen.additional.price,
        discountPct,
        annual,
      })
    );
  }

  if (quantity === 0) {
    result.error = `Enter how many ${family.unit} to quote.`;
  } else if (chosen !== best) {
    result.hint = `The ${formatInt(best.tier)} tier covers ${formatInt(quantity)} ${family.unit} for ${formatMoney(best.cost)}${per}, ${formatMoney(chosen.cost - best.cost)}${per} less than the tier selected.`;
    result.hintLevel = 'warning';
  } else if (chosen.additional) {
    const extra = chosen.addQty > 0 ? ` + ${formatInt(chosen.addQty)} additional ${family.unit}` : '';
    result.hint = `${formatInt(chosen.tier)}-${family.unitSingular.toLowerCase()} commit${extra} is the lowest list price for ${formatInt(quantity)} ${family.unit}.`;
  } else {
    result.hint = `${formatInt(chosen.baseQty)} × ${formatInt(chosen.tier)}-${family.unitSingular.toLowerCase()} pack${chosen.baseQty > 1 ? 's' : ''} covers ${formatInt(quantity)} ${family.unit} at the lowest list price.`;
  }
  return result;
}

function priceTimus(input, setup, catalog, timusLists, result) {
  const lists = (timusLists || []).filter((l) => l.active !== false);
  const list = lists.find((l) => l.value === String(input.priceListValue || ''));
  const gateways = Math.max(0, Math.round(toNum(input.gateways)));
  result.timus = { list: list || null, gateways, userRate: null, usage: 0, rateSource: 'price list' };
  if (!list) {
    result.error = 'Pick a Timus price list.';
    return result;
  }
  let userRate = list.advancedUserRate;
  if (userRate == null) {
    userRate = toNum(input.userRateOverride, 0);
    result.timus.rateSource = 'entered by rep';
  }
  const usage = round2(result.quantity * userRate + gateways * list.gatewayRate);
  Object.assign(result.timus, { userRate, usage });

  if (input.agreement === 'satgat') {
    const product = catalog.timus.satgat[list.minimum];
    if (!product) {
      result.error = `Satisfaction-guarantee SKUs exist for the ${Object.keys(TIMUS.satgatSkuByMinimum).map((m) => '$' + m).join(', ')} minimums only.`;
      return result;
    }
    result.lines.push(
      makeLine({ family: 'timus', kind: 'satgat', productId: product.id, name: product.name, sku: product.sku, quantity: 1, unitPrice: product.price, discountPct: result.discountPct, annual: false })
    );
  } else {
    const product = catalog.timus.minimum;
    if (!product) {
      result.error = `The "${TIMUS.minimumSku}" product is not tagged for the Quote Builder.`;
      return result;
    }
    result.lines.push(
      makeLine({
        family: 'timus',
        kind: 'minimum',
        productId: product.id,
        name: `Timus SASE - $${formatInt(list.minimum)} Tier`,
        sku: product.sku,
        quantity: 1,
        unitPrice: list.minimum,
        discountPct: result.discountPct,
        annual: false,
      })
    );
  }
  if (setup.billing !== 'monthly') {
    result.hint = 'Timus SASE bills monthly against its minimum, whatever billing is set for the quote. ';
    result.hintLevel = 'warning';
  }
  if (usage <= list.minimum) {
    result.hint += `Estimated usage ${formatMoney(usage)}/mo is covered by the ${formatMoney(list.minimum, 0)} monthly minimum.`;
  } else {
    result.hint += `Estimated usage ${formatMoney(usage)}/mo is ${formatMoney(usage - list.minimum)} over the ${formatMoney(list.minimum, 0)} minimum. Overage bills in the Timus portal; consider the next tier.`;
    result.hintLevel = 'warning';
  }
  return result;
}

// ---------------------------------------------------------------------------
// AutoElevate feature type (AE Feature Type + AE Feature Type Details on the deal)
// ---------------------------------------------------------------------------

export function aeFeatureTypeFor(input) {
  if (!input || input.family !== 'autoelevate') return null;
  const byValue = AE_FEATURE_TYPES.find((f) => f.value === input.featureType);
  if (byValue) return byValue;
  // No explicit choice: infer from the edition.
  return AE_FEATURE_TYPES.find((f) => f.edition === input.edition && !/grandfathered/i.test(f.value)) || AE_FEATURE_TYPES[0];
}

// The SKU edition that prices a row. For AutoElevate the feature type decides it.
export function effectiveEdition(input) {
  const ft = aeFeatureTypeFor(input);
  return ft ? ft.edition : input.edition;
}

export function resolveAeFeature(rows) {
  const aeRows = (rows || []).filter((r) => r.input.family === 'autoelevate');
  if (!aeRows.length) return null;
  const types = Array.from(new Set(aeRows.map((r) => aeFeatureTypeFor(r.input).value)));
  if (types.length > 1) {
    return {
      conflict: `AutoElevate lines use different feature types (${types.join(', ')}). The deal holds one AE Feature Type, so the quote can only print one. Use one feature type, or split into separate quotes.`,
    };
  }
  const ft = aeFeatureTypeFor(aeRows[0].input);
  const priced = aeRows.find((r) => r.usable) || aeRows[0];
  const tier = priced.priced.chosenTier;
  return { type: ft.value, details: ft.details.replace('{tier}', tier ? formatInt(tier) : '[commit tier]'), tier };
}

// ---------------------------------------------------------------------------
// Whole quote
// ---------------------------------------------------------------------------

export function normalizeRamp(ramp) {
  const enabled = !!(ramp && ramp.enabled);
  return {
    enabled,
    months: enabled ? clamp(Math.round(toNum(ramp.months, 1)), 1, MAX_RAMP_MONTHS) : 0,
    mode: ramp && ramp.mode === 'percent' ? 'percent' : 'free',
    percent: ramp && ramp.mode === 'percent' ? clamp(Math.round(toNum(ramp.percent, 50)), 1, 99) : 100,
  };
}

// "15 Months" → 15; the Month-to-Month option → null.
export function agreementMonths(value) {
  if (!value || value === AGREEMENT_LENGTH_M2M) return null;
  const m = String(value).match(/^(\d+)\s*Months?$/i);
  return m ? Number(m[1]) : null;
}

// SKU billing actually used: a Month-to-Month Agreement Length means month-to-month SKUs.
export function effectiveBilling(setup) {
  if (setup.agreementLength === AGREEMENT_LENGTH_M2M) return 'm2m';
  return setup.billing === 'annual' ? 'annual' : 'monthly';
}

// The rep picks the Agreement Length (what prints on the quote). It includes any ramp:
// ramped products run RAMP lines for the ramp months, then the plan for the rest;
// products not on the ramp run the plan for the whole agreement.
export function buildQuote(setup, inputs, rampInput, catalog, timusLists) {
  const ramp = normalizeRamp(rampInput);
  const billing = effectiveBilling(setup);
  const priceSetup = Object.assign({}, setup, { billing });
  const m2m = billing === 'm2m';
  const months = m2m ? null : agreementMonths(setup.agreementLength);
  const agreement = months || 12;
  const conflicts = [];
  if (!m2m && !months) conflicts.push('Pick an Agreement Length on the Setup step.');
  if (!m2m && ramp.enabled && ramp.months >= agreement) {
    conflicts.push(`The ${ramp.months}-month ramp is as long as the ${agreement}-month Agreement Length. Pick a longer Agreement Length or a shorter ramp.`);
  }
  const rampDiscount = ramp.mode === 'free' ? 100 : ramp.percent;

  const rows = (inputs || []).map((input) => {
    const priced = priceProduct(input, priceSetup, catalog, timusLists);
    const usable = !priced.error && priced.lines.length > 0;
    const ramped = ramp.enabled && !!input.ramp && usable;
    const mainTerm = m2m ? 1 : Math.max(1, ramped ? agreement - ramp.months : agreement);
    const valueMonths = m2m ? 12 : mainTerm; // months used to value an open-ended M2M quote
    const mainLines = priced.lines.map((l) =>
      Object.assign({}, l, { ramp: false, termMonths: mainTerm, startMonth: ramped ? ramp.months + 1 : 1 })
    );
    const rampLines = ramped
      ? priced.lines.map((l) =>
          Object.assign(makeLine(Object.assign({}, l, { discountPct: rampDiscount })), {
            name: RAMP_NAME_PREFIX + l.name,
            ramp: true,
            termMonths: ramp.months,
            startMonth: 1,
          })
        )
      : [];
    const sum = (ls, k) => ls.reduce((a, l) => a + l[k], 0);
    return {
      input,
      priced,
      usable,
      ramped,
      mainTerm,
      valueMonths,
      mainLines,
      rampLines,
      mainMrr: sum(mainLines, 'mrr'),
      rampMrr: sum(rampLines, 'mrr'),
      listMrr: sum(mainLines, 'listMrr'),
    };
  });

  const lines = [];
  for (const r of rows) {
    if (!r.usable) continue;
    for (const l of r.rampLines) lines.push(l);
    for (const l of r.mainLines) lines.push(l);
  }
  lines.forEach((l, i) => (l.position = i + 1));

  const anyRamp = rows.some((r) => r.ramped);
  let mrr = 0;
  let firstYear = 0;
  let tcv = 0;
  let listTcv = 0;
  let maxDiscountPct = 0;
  let maxDiscountFamily = null;
  for (const r of rows) {
    if (!r.usable) continue;
    const rm = r.ramped ? ramp.months : 0;
    mrr += r.mainMrr;
    firstYear += Math.min(rm, 12) * r.rampMrr + Math.max(0, 12 - rm) * r.mainMrr;
    tcv += rm * r.rampMrr + r.valueMonths * r.mainMrr;
    listTcv += (rm + r.valueMonths) * r.listMrr;
    if (r.priced.discountPct > maxDiscountPct) {
      maxDiscountPct = r.priced.discountPct;
      maxDiscountFamily = r.input.family;
    }
  }

  const totals = {
    mrr: round2(mrr),
    arr: round2(mrr * 12),
    firstYear: round2(firstYear),
    tcv: round2(tcv),
    listTcv: round2(listTcv),
    savings: round2(Math.max(0, listTcv - tcv)),
    contractMonths: m2m ? null : agreement,
    maxDiscountPct,
    maxDiscountFamily,
  };

  const approval = evaluateApproval({
    maxDiscountPct,
    maxDiscountFamily,
    rampMonths: anyRamp ? ramp.months : 0,
    salesTeam: setup.salesTeam,
    templateType: setup.templateType,
  });

  const blocking = rows.filter((r) => !r.usable).map((r) => ({ uid: r.input.uid, family: r.input.family, error: r.priced.error }));
  const aeFeature = resolveAeFeature(rows);
  if (aeFeature && aeFeature.conflict) conflicts.push(aeFeature.conflict);

  return { ramp, term: agreement, billing, m2m, rows, lines, totals, approval, blocking, conflicts, aeFeature, anyRamp };
}

export function evaluateApproval({ maxDiscountPct, maxDiscountFamily, rampMonths, salesTeam, templateType }) {
  const reasons = [];
  if (maxDiscountPct >= APPROVAL.discountThresholdPct) {
    const label = maxDiscountFamily && FAMILIES[maxDiscountFamily] ? FAMILIES[maxDiscountFamily].label : 'a product';
    reasons.push(`${maxDiscountPct}% discount on ${label} (${APPROVAL.discountThresholdPct}% or more needs approval)`);
  }
  if (rampMonths >= APPROVAL.rampMonthsThreshold) {
    reasons.push(`${rampMonths}-month ramp (${APPROVAL.rampMonthsThreshold}+ months needs approval)`);
  }
  const approver = APPROVAL.approversByTeam[salesTeam] || APPROVAL.fallbackApprover;
  const legacy = templateType && templateType !== 'CPQ_QUOTE';
  return {
    required: reasons.length > 0,
    reasons,
    approver,
    // Commerce Hub approval workflows only run on CPQ quotes.
    manual: legacy && reasons.length > 0,
  };
}

// ---------------------------------------------------------------------------
// HubSpot property mapping
// ---------------------------------------------------------------------------

export function lineItemProperties(line, { billing, rampMonths, sessionId }) {
  const props = {
    hs_product_id: line.productId,
    name: line.name,
    hs_sku: line.sku,
    quantity: String(line.quantity),
    price: String(line.unitPrice),
    hs_discount_percentage: String(line.discountPct),
    recurringbillingfrequency: line.annual ? 'annually' : 'monthly',
    hs_position_on_quote: String(line.position),
    ramp: line.ramp ? 'true' : 'false',
    approval_discount: String(line.ramp ? 0 : line.discountPct),
    approval_ramp_months: String(line.ramp ? line.termMonths : 0),
    [LINE_SOURCE_PROPERTY]: LINE_SOURCE_VALUE,
    [LINE_SESSION_PROPERTY]: sessionId,
  };
  if (billing === 'm2m' && !line.ramp) {
    props.hs_recurring_billing_terms = 'AUTOMATICALLY_RENEW';
  } else {
    props.hs_recurring_billing_period = `P${line.termMonths}M`;
  }
  if (SET_BILLING_DELAY_AFTER_RAMP && !line.ramp && line.startMonth > 1) {
    props.hs_billing_start_delay_type = 'hs_billing_start_delay_months';
    props.hs_billing_start_delay_months = String(rampMonths);
  }
  return props;
}

// Deal properties the quote template prints as tokens, plus bookkeeping fields.
// `enumOptions` = { propertyName: [{ value, label }] } read live from HubSpot; a value that
// isn't an option is reported as an error instead of being written.
/** @param {any} quote @param {{ setup?: any, notes?: string }} [ctx] @param {Record<string, {value: string, label: string}[]>} [enumOptions] */
export function dealWrites(quote, { setup = {}, notes = '' } = {}, enumOptions = {}) {
  const properties = {};
  const errors = [];
  const warnings = [];
  const options = (name) => (enumOptions && enumOptions[name]) || [];
  const accepts = (name, value) => !options(name).length || options(name).some((o) => o.value === value);
  const labelOf = (name, value) => (options(name).find((o) => o.value === value) || { label: value }).label;
  const setEnum = (name, label, value) => {
    if (value === '' || value == null) {
      properties[name] = '';
      return;
    }
    if (accepts(name, value)) properties[name] = value;
    else errors.push(`${label} has no "${value}" option in HubSpot. Add the option to the deal property or pick another value.`);
  };

  const agreementLength = setup.agreementLength || '';
  if (!agreementLength) errors.push('Pick an Agreement Length on the Setup step.');
  else setEnum('agreement_length', 'Agreement Length', agreementLength);
  if (WRITE_CONTRACT_TERM) properties.contract_term = quote.m2m ? '' : String(quote.totals.contractMonths);

  const billing = effectiveBilling(setup);
  const paymentFrequency = setup.paymentFrequency || PAYMENT_FREQUENCY_DEFAULT[billing] || 'Month-to-Month';
  setEnum('payment_terms', 'Payment Frequency', paymentFrequency);
  if (billing === 'annual' && paymentFrequency !== 'Annual Payments') {
    warnings.push(`The SKUs are annual but Payment Frequency is ${labelOf('payment_terms', paymentFrequency)}.`);
  }
  setEnum('payment_method', 'Payment Method', setup.paymentMethod || '');
  setEnum('invoice_terms', 'Invoice Terms', setup.invoiceTerms || '');
  setEnum('promo', 'Promo', setup.promo || '');
  properties.hubspot_quote_notes = String(notes || '').slice(0, 5000);

  if (quote.aeFeature && !quote.aeFeature.conflict) {
    setEnum('sku_type', 'AE Feature Type', quote.aeFeature.type);
    properties.ae_feature_type_details = quote.aeFeature.details;
  }

  const timusRow = quote.rows.find((r) => r.input.family === 'timus' && r.usable);
  if (timusRow && timusRow.priced.timus && timusRow.priced.timus.list) {
    const t = timusRow.priced.timus;
    Object.assign(properties, {
      timus_price_list: t.list.value,
      timus_price_per_user: t.userRate.toFixed(2),
      timus_price_per_gateway: t.list.gatewayRate.toFixed(2),
      new_minimum_commitment_amount: String(t.list.minimum),
    });
  }
  return { properties, errors, warnings, agreementLength, paymentFrequency };
}

// ---------------------------------------------------------------------------
// Multiple quotes (options) on one deal
// ---------------------------------------------------------------------------

// 'open' quotes still read the deal's current printed values; 'locked' ones were frozen at publish.
export function quoteLockState(progressionStatus) {
  const s = progressionStatus || 'DRAFT';
  if (QUOTE_IGNORED_STATUSES.includes(s)) return 'void';
  return QUOTE_OPEN_STATUSES.includes(s) ? 'open' : 'locked';
}

// Open quotes whose printed values would change if `newProps` were written to the deal.
export function openQuoteConflicts(quotes, currentDealProps, newProps) {
  const changed = PRINTED_DEAL_PROPERTIES.filter(
    (k) => k in (newProps || {}) && String((currentDealProps || {})[k] || '') !== String(newProps[k] || '')
  );
  if (!changed.length) return { changed, quotes: [] };
  return { changed, quotes: (quotes || []).filter((q) => quoteLockState(q.progressionStatus) === 'open') };
}

// What a builder quote stores so it can be cloned or made primary later.
export function builderState({ setup, products, ramp, notes }, dealProperties) {
  return JSON.stringify({ v: 1, setup, products, ramp, notes: notes || '', dealProperties });
}

export function parseBuilderState(value) {
  try {
    const s = JSON.parse(value || '');
    return s && s.v === 1 ? s : null;
  } catch (_) {
    return null;
  }
}

export function autoQuoteName(companyName, inputs, rampMonths) {
  const seen = [];
  for (const i of inputs || []) {
    const label = FAMILIES[i.family] ? FAMILIES[i.family].label : null;
    if (label && !seen.includes(label)) seen.push(label);
  }
  const base = `${companyName || 'Quote'} - ${seen.join(' + ') || 'Quote'}`;
  return rampMonths ? `${base} + ${rampMonths} Month Ramp` : base;
}

// Server-side guard: reject anything the card should never send.
export function validateSubmission(payload) {
  const errors = [];
  const { setup = {}, products = [], ramp = {} } = payload || {};
  if (!['MSP', 'ENT'].includes(setup.segment)) errors.push('segment must be MSP or ENT');
  if (!BILLING[setup.billing]) errors.push('billing must be monthly, annual or m2m');
  if (!setup.agreementLength || typeof setup.agreementLength !== 'string') errors.push('agreementLength is required');
  else if (setup.agreementLength !== AGREEMENT_LENGTH_M2M && !agreementMonths(setup.agreementLength)) errors.push('agreementLength must look like "15 Months"');
  if (!setup.templateId) errors.push('templateId is required');
  if (!setup.expirationDate || !/^\d{4}-\d{2}-\d{2}$/.test(setup.expirationDate)) errors.push('expirationDate must be YYYY-MM-DD');
  if (!Array.isArray(products) || products.length === 0) errors.push('at least one product is required');
  if (products.length > 12) errors.push('at most 12 product rows');
  for (const p of products) {
    if (!FAMILIES[p.family]) errors.push(`unknown family ${p.family}`);
    const d = toNum(p.discountPct, NaN);
    if (!(d >= 0 && d <= 100)) errors.push(`discount for ${p.family} must be 0–100`);
    const q = toNum(p.quantity, NaN);
    if (!(q >= 0 && q <= 1000000)) errors.push(`quantity for ${p.family} is out of range`);
    if (p.family === 'autoelevate' && p.featureType && !AE_FEATURE_TYPES.some((f) => f.value === p.featureType)) errors.push(`unknown AE feature type ${p.featureType}`);
  }
  if (ramp.enabled) {
    const m = toNum(ramp.months, NaN);
    if (!(m >= 1 && m <= MAX_RAMP_MONTHS)) errors.push(`ramp months must be 1–${MAX_RAMP_MONTHS}`);
  }
  return errors;
}
