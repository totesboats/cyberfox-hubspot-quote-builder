// HubSpot workflow custom code action: "Quote approval → Teams".
// Runs when a quote's Internal quote status becomes Pending approval. Reads the quote, its deal, company,
// owner and line items, builds a Teams Adaptive Card (overview + line items + an Approved button), and sends
// it to the Power Automate flow that posts it in the approvals channel and handles the click.
//
// Paste this whole file into the workflow's custom code action (Node.js 20 or 24).
// Secrets (Settings → workflow custom code secrets; never in this file):
//   QUOTE_APPROVALS_HUBSPOT_TOKEN  "Quote Approvals (Microsoft Teams)" private app token, read scopes: crm.objects.quotes.read, crm.objects.deals.read,
//                                  crm.objects.companies.read, crm.objects.line_items.read, crm.objects.owners.read
//   QUOTE_APPROVALS_FLOW_URL       the Power Automate "When a HTTP request is received" URL (it contains a key).
//                                  Set it to dry-run to read the quote and build the card without sending it.
// Output fields: posted ("yes", or "dry-run"), approver (routed approver's name), reasons (why approval is
// needed), lines (line items on the card), cardBytes (card size; Teams allows about 28,000).

const CONFIG = {
  portalId: 2585282,
  apiVersion: '2026-09',
  // Who approves, by the deal's Sales Team (matches the Quote Approval Workflow). HubSpot owner IDs.
  approverBySalesTeam: {
    MSP: 52200549, // Tina Harvey
    ENT: 189572944, // Adam Friedman
    AM: 94415503, // Julie Webb
  },
  // Ops can approve any quote (fallback approvers).
  opsApprovers: [203165110, 2100374439, 16957424, 52200551], // Trevor Brown, Harry Lampert, Alex Munson, Anthony Bellini
  // Approval policy, shown on the card as the reason. Keep in step with the Quote Approval Workflow.
  discountThreshold: 30, // percent, on non-ramp lines
  rampThresholdMonths: 4, // total ramp length
  maxLinesOnCard: 25,
};

const BASE = 'https://api.hubapi.com';
const OBJ = `/crm/objects/${CONFIG.apiVersion}`;

const QUOTE_PROPS = ['hs_title', 'hs_status', 'hs_quote_amount', 'hs_currency', 'hs_expiration_date', 'hubspot_owner_id', 'hs_template_type', 'hs_quote_number', 'hs_tcv'];
const DEAL_PROPS = ['dealname', 'sales_team', 'agreement_length', 'payment_terms', 'payment_method', 'invoice_terms', 'deal_currency_code'];
const LINE_PROPS = [
  'name', 'hs_sku', 'quantity', 'price', 'hs_discount_percentage', 'discount', 'amount', 'recurringbillingfrequency',
  'hs_recurring_billing_period', 'hs_term_in_months', 'hs_position_on_quote', 'ramp', 'approval_discount', 'approval_ramp_months',
];

// ---------------------------------------------------------------------------
// HubSpot API

function makeClient(token, fetchImpl) {
  const f = fetchImpl || fetch;
  return async function hs(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await f(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(`HubSpot ${method} ${path.split('?')[0]} failed (${res.status}): ${(data && data.message) || text.slice(0, 200)}`);
      return data;
    }
  };
}

async function associatedIds(hs, fromType, fromId, toType) {
  const res = await hs(`/crm/associations/${CONFIG.apiVersion}/${fromType}/${toType}/batch/read`, { method: 'POST', body: { inputs: [{ id: String(fromId) }] } });
  return ((res && res.results) || []).flatMap((r) => (r.to || []).map((t) => String(t.toObjectId)));
}

async function owner(hs, ownerId) {
  if (!ownerId) return null;
  try {
    const o = await hs(`/crm/owners/${CONFIG.apiVersion}/${encodeURIComponent(ownerId)}`);
    return { id: String(o.id), name: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email || String(o.id), email: String(o.email || '').toLowerCase() };
  } catch (err) {
    return null;
  }
}

async function loadQuote(hs, quoteId) {
  const quote = await hs(`${OBJ}/quotes/${encodeURIComponent(quoteId)}?properties=${QUOTE_PROPS.join(',')}`);
  const [dealIds, companyIds, lineIds] = await Promise.all([
    associatedIds(hs, 'quotes', quoteId, 'deals'),
    associatedIds(hs, 'quotes', quoteId, 'companies'),
    associatedIds(hs, 'quotes', quoteId, 'line_items'),
  ]);
  const [deal, company, lines] = await Promise.all([
    dealIds[0] ? hs(`${OBJ}/deals/${dealIds[0]}?properties=${DEAL_PROPS.join(',')}`) : null,
    companyIds[0] ? hs(`${OBJ}/companies/${companyIds[0]}?properties=name`) : null,
    lineIds.length ? hs(`${OBJ}/line_items/batch/read`, { method: 'POST', body: { inputs: lineIds.slice(0, 100).map((id) => ({ id })), properties: LINE_PROPS } }) : { results: [] },
  ]);
  return { quote, deal, company, lines: (lines.results || []).map((l) => Object.assign({ id: String(l.id) }, l.properties)) };
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for tests)

const num = (v) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);

function money(value, currency) {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(num(value));
  } catch (_) {
    return `${num(value).toFixed(2)} ${currency || ''}`.trim();
  }
}

function termMonths(line) {
  const m = String(line.hs_recurring_billing_period || '').match(/^P(\d+)M$/i);
  if (m) return Number(m[1]);
  const y = String(line.hs_recurring_billing_period || '').match(/^P(\d+)Y$/i);
  if (y) return Number(y[1]) * 12;
  return num(line.hs_term_in_months) || null;
}

function isRamp(line) {
  return String(line.ramp) === 'true' || /^RAMP\b/i.test(line.name || '');
}

function per(line) {
  return { monthly: '/mo', annually: '/yr', quarterly: '/qtr' }[line.recurringbillingfrequency] || '';
}

// Why the quote needs approval, from the line items (same policy as the Quote Approval Workflow).
function approvalReasons(lines) {
  const reasons = [];
  let maxDiscount = 0;
  let maxDiscountLine = null;
  for (const l of lines) {
    if (isRamp(l)) continue;
    const d = l.approval_discount != null && l.approval_discount !== '' ? num(l.approval_discount) : num(l.hs_discount_percentage);
    if (d > maxDiscount) {
      maxDiscount = d;
      maxDiscountLine = l;
    }
  }
  if (maxDiscount >= CONFIG.discountThreshold) reasons.push(`${maxDiscount}% discount on ${maxDiscountLine.name}`);
  let ramp = 0;
  for (const l of lines) {
    const r = num(l.approval_ramp_months) || (isRamp(l) ? termMonths(l) || 0 : 0);
    if (r > ramp) ramp = r;
  }
  if (ramp >= CONFIG.rampThresholdMonths) reasons.push(`${ramp}-month ramp`);
  return reasons;
}

function quoteLink(quoteId, templateType) {
  if (templateType === 'CPQ_QUOTE') return `https://app.hubspot.com/quote/${CONFIG.portalId}/editor/${quoteId}/content`;
  return `https://app.hubspot.com/quotes/${CONFIG.portalId}/details/${quoteId}`;
}

const cell = (text, opts = {}) => Object.assign({ type: 'TextBlock', text: String(text), wrap: true, size: 'Small' }, opts);

// The Adaptive Card posted in Teams. Version 1.4 (what Teams renders for Power Automate cards).
function buildCard(d) {
  const currency = d.currency;
  const sorted = d.lines.slice().sort((a, b) => num(a.hs_position_on_quote) - num(b.hs_position_on_quote));
  const shown = sorted.slice(0, CONFIG.maxLinesOnCard);
  const widths = ['stretch', '40px', '80px', '50px', '55px', '90px'];
  const row = (cells, header) => ({
    type: 'ColumnSet',
    spacing: header ? 'Medium' : 'Small',
    separator: !header,
    columns: cells.map((c, i) => ({ type: 'Column', width: widths[i], items: [cell(c, Object.assign(header ? { weight: 'Bolder' } : {}, i > 0 ? { horizontalAlignment: 'Right' } : {}))] })),
  });
  const lineRows = shown.map((l) => {
    const disc = num(l.hs_discount_percentage) > 0 ? `${num(l.hs_discount_percentage)}%` : num(l.discount) > 0 ? money(l.discount, currency) : '—';
    const term = termMonths(l);
    return row([l.name || l.hs_sku || 'Line item', num(l.quantity).toLocaleString('en-US'), money(l.price, currency), disc, term ? `${term} mo` : '—', `${money(l.amount, currency)}${per(l)}`]);
  });
  const facts = [
    ['Company', d.companyName],
    ['Deal', d.dealName],
    ['Rep (quote owner)', d.ownerName],
    ['Sales team', d.salesTeam],
    ['Approver', d.approverName ? `${d.approverName} or Ops` : 'Ops'],
    ['Quote amount', money(d.amount, currency) + (currency && currency !== 'USD' ? ` (${currency})` : '')],
    ['Agreement length', d.agreementLength],
    ['Payment', [d.paymentTerms, d.paymentMethod].filter(Boolean).join(' · ')],
    ['Invoice terms', d.invoiceTerms],
    ['Expires', d.expires],
  ].filter(([, v]) => v);

  const body = [
    { type: 'TextBlock', text: 'Quote approval needed', weight: 'Bolder', size: 'Large', color: 'Accent' },
    { type: 'TextBlock', text: d.title || `Quote ${d.quoteId}`, weight: 'Bolder', wrap: true, spacing: 'None' },
    d.reasons.length ? { type: 'TextBlock', text: `Needs approval for: ${d.reasons.join('; ')}`, wrap: true, color: 'Warning' } : null,
    { type: 'FactSet', facts: facts.map(([title, value]) => ({ title, value: String(value) })) },
    { type: 'TextBlock', text: 'Line items', weight: 'Bolder', spacing: 'Large' },
    row(['Product', 'Qty', 'Unit price', 'Disc.', 'Term', 'Net'], true),
    ...lineRows,
    sorted.length > shown.length ? cell(`+ ${sorted.length - shown.length} more line items in HubSpot`, { isSubtle: true, spacing: 'Small' }) : null,
  ].filter(Boolean);

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    msteams: { width: 'Full' },
    body,
    actions: [
      { type: 'Action.Submit', title: 'Approved', style: 'positive', data: { action: 'approve', quoteId: d.quoteId } },
      { type: 'Action.OpenUrl', title: 'Open in HubSpot', url: d.quoteUrl },
    ],
  };
}

// Everything the flow needs: the card plus who may approve.
function buildPayload({ quote, deal, company, lines }, people) {
  const qp = quote.properties || {};
  const dp = (deal && deal.properties) || {};
  const currency = String(qp.hs_currency || dp.deal_currency_code || 'USD').toUpperCase();
  const quoteId = String(quote.id);
  const reasons = approvalReasons(lines);
  const quoteUrl = quoteLink(quoteId, qp.hs_template_type);
  const salesTeam = dp.sales_team || '';
  const routed = people.routed;
  const allowed = [routed].concat(people.ops).filter((p) => p && p.email);
  const card = buildCard({
    quoteId,
    title: qp.hs_title,
    companyName: company && company.properties ? company.properties.name : '',
    dealName: dp.dealname || '',
    ownerName: people.owner ? people.owner.name : '',
    salesTeam,
    approverName: routed ? routed.name : '',
    amount: qp.hs_quote_amount,
    currency,
    agreementLength: dp.agreement_length,
    paymentTerms: dp.payment_terms,
    paymentMethod: dp.payment_method,
    invoiceTerms: dp.invoice_terms,
    expires: qp.hs_expiration_date ? String(qp.hs_expiration_date).slice(0, 10) : '',
    reasons,
    lines,
    quoteUrl,
  });
  return {
    quoteId,
    quoteTitle: qp.hs_title || `Quote ${quoteId}`,
    quoteUrl,
    dealId: deal ? String(deal.id) : '',
    salesTeam,
    reasons,
    routedApprover: routed ? { name: routed.name, email: routed.email } : null,
    // Teams sign-in emails of everyone allowed to approve (lowercase). The quote owner is never allowed.
    allowedApprovers: [...new Set(allowed.map((p) => p.email))].filter((e) => !people.owner || e !== people.owner.email),
    allowedApproverNames: allowed.map((p) => p.name),
    ownerEmail: people.owner ? people.owner.email : '',
    ownerName: people.owner ? people.owner.name : '',
    card,
    cardJson: JSON.stringify(card),
  };
}

// ---------------------------------------------------------------------------
// Workflow entry point

async function run(quoteId, env, fetchImpl) {
  if (!env.QUOTE_APPROVALS_HUBSPOT_TOKEN) throw new Error('Secret QUOTE_APPROVALS_HUBSPOT_TOKEN is not set on this custom code action.');
  if (!env.QUOTE_APPROVALS_FLOW_URL) throw new Error('Secret QUOTE_APPROVALS_FLOW_URL is not set on this custom code action.');
  const hs = makeClient(env.QUOTE_APPROVALS_HUBSPOT_TOKEN, fetchImpl);
  const data = await loadQuote(hs, quoteId);
  const salesTeam = data.deal && data.deal.properties ? data.deal.properties.sales_team : '';
  const [quoteOwner, routed, ...ops] = await Promise.all([
    owner(hs, data.quote.properties && data.quote.properties.hubspot_owner_id),
    owner(hs, CONFIG.approverBySalesTeam[salesTeam]),
    ...CONFIG.opsApprovers.map((id) => owner(hs, id)),
  ]);
  const payload = buildPayload(data, { owner: quoteOwner, routed, ops: ops.filter(Boolean) });
  payload.lineCount = data.lines.length;
  // Dry run: everything except sending to Teams (for testing before the flow exists).
  if (String(env.QUOTE_APPROVALS_FLOW_URL).trim().toLowerCase() === 'dry-run') return Object.assign(payload, { dryRun: true });
  const res = await (fetchImpl || fetch)(env.QUOTE_APPROVALS_FLOW_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Power Automate flow returned ${res.status}`);
  return payload;
}

// Works with both custom code styles: Node.js 24+ returns the outputs, older versions pass a callback.
exports.main = async (event, callback) => {
  const quoteId = event.object.objectId;
  const payload = await run(quoteId, process.env);
  if (payload.dryRun) console.log('Dry run: card built, not sent.', JSON.stringify({ quote: payload.quoteTitle, approvers: payload.allowedApproverNames, owner: payload.ownerName, reasons: payload.reasons, lines: payload.lineCount }));
  const result = {
    outputFields: {
      posted: payload.dryRun ? 'dry-run' : 'yes',
      approver: payload.routedApprover ? payload.routedApprover.name : 'Ops',
      reasons: payload.reasons.join('; ') || 'none found',
      lines: payload.lineCount,
      cardBytes: payload.cardJson.length,
    },
  };
  if (typeof callback === 'function') callback(result);
  return result;
};

// For the repo's tests only (HubSpot ignores these).
exports._test = { CONFIG, approvalReasons, buildCard, buildPayload, run, termMonths, money };
