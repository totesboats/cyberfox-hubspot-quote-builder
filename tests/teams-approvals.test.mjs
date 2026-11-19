// Tests for the "Quote approval → Teams" workflow code step (teams-approvals/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { _test: T } = require('../teams-approvals/quote-approval-to-teams.cjs');

const line = (over) => Object.assign({ name: 'AutoElevate 1000 Agent Plan 2026', hs_sku: 'AE-1000', quantity: '1', price: '1050', amount: '1050', recurringbillingfrequency: 'monthly', hs_recurring_billing_period: 'P12M', hs_position_on_quote: '2' }, over);

// A fake HubSpot + Power Automate.
function fakeApis({ salesTeam = 'MSP', ownerId = '77', lines } = {}) {
  const calls = [];
  const owners = {
    77: { id: '77', firstName: 'Riley', lastName: 'Rep', email: 'Riley.Rep@cyberfox.com' },
    52200549: { id: '52200549', firstName: 'Tina', lastName: 'Harvey', email: 'tina@example.com' },
    189572944: { id: '189572944', firstName: 'Adam', lastName: 'Friedman', email: 'adam@example.com' },
    94415503: { id: '94415503', firstName: 'Julie', lastName: 'Webb', email: 'julie@example.com' },
    203165110: { id: '203165110', firstName: 'Trevor', lastName: 'Brown', email: 'trevor@example.com' },
    2100374439: { id: '2100374439', firstName: 'Harry', lastName: 'Lampert', email: 'harry@example.com' },
    16957424: { id: '16957424', firstName: 'Alex', lastName: 'Munson', email: 'alex@example.com' },
    52200551: { id: '52200551', firstName: 'Anthony', lastName: 'Bellini', email: 'anthony@example.com' },
  };
  const items = lines || [
    line({ id: 'L1', name: 'RAMP AutoElevate 1000 Agent Plan 2026', ramp: 'true', hs_discount_percentage: '100', amount: '0', hs_recurring_billing_period: 'P4M', approval_ramp_months: '4', approval_discount: '0', hs_position_on_quote: '1' }),
    line({ id: 'L2', hs_discount_percentage: '35', amount: '682.5', approval_discount: '35' }),
  ];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(init.body) : null;
    calls.push({ method: init.method || 'GET', path: u.pathname, host: u.host, body, auth: init.headers && init.headers.Authorization, headers: init.headers || {} });
    const ok = (data) => ({ ok: true, status: 200, text: async () => JSON.stringify(data) });
    const p = u.pathname;
    if (u.host === 'flow.example.com') {
      const key = init.headers['x-cfx-flow-key'];
      if (key !== undefined && key !== 'test-flow-key') return { ok: false, status: 401, text: async () => '' };
      return { ok: true, status: 202, text: async () => '' };
    }
    if (/\/v[34]\//.test(p)) throw new Error(`legacy path ${p}`);
    if (p === '/crm/objects/2026-09/quotes/Q9') return ok({ id: 'Q9', properties: { hs_title: 'Example MSP - AutoElevate', hs_status: 'PENDING_APPROVAL', hs_quote_amount: '682.5', hs_currency: 'USD', hs_expiration_date: '2026-12-19T00:00:00Z', hubspot_owner_id: ownerId, hs_template_type: 'CPQ_QUOTE' } });
    const ab = p.match(/^\/crm\/associations\/2026-09\/quotes\/(\w+)\/batch\/read$/);
    if (ab) {
      const to = { deals: ['123'], companies: ['7'], line_items: items.map((l) => l.id) }[ab[1]] || [];
      return ok({ results: [{ from: { id: 'Q9' }, to: to.map((id) => ({ toObjectId: id })) }] });
    }
    if (p === '/crm/objects/2026-09/deals/123') return ok({ id: '123', properties: { dealname: 'Example MSP - AE upsell', sales_team: salesTeam, agreement_length: '16 Months', payment_terms: 'Month-to-Month', payment_method: 'Credit Card', invoice_terms: 'Due Upon Receipt', deal_currency_code: 'USD' } });
    if (p === '/crm/objects/2026-09/companies/7') return ok({ id: '7', properties: { name: 'Example MSP' } });
    if (p === '/crm/objects/2026-09/line_items/batch/read') return ok({ results: body.inputs.map((i) => ({ id: i.id, properties: items.find((l) => l.id === i.id) })) });
    const o = p.match(/^\/crm\/owners\/2026-09\/(\d+)$/);
    if (o) return owners[o[1]] ? ok(owners[o[1]]) : { ok: false, status: 404, text: async () => '{"message":"not found"}' };
    throw new Error(`unexpected ${p}`);
  };
  return { fetchImpl, calls };
}
const ENV = { QUOTE_APPROVALS_HUBSPOT_TOKEN: 'test-token', QUOTE_APPROVALS_FLOW_URL: 'https://flow.example.com/trigger', QUOTE_APPROVALS_FLOW_KEY: 'test-flow-key' };

test('teams approvals: posts the quote overview, line items and Approved button to the flow', async () => {
  const { fetchImpl, calls } = fakeApis();
  const payload = await T.run('Q9', ENV, fetchImpl);
  const sent = calls.find((c) => c.host === 'flow.example.com');
  assert.ok(sent, 'posted to the flow');
  assert.equal(sent.headers['x-cfx-flow-key'], 'test-flow-key', 'sends the shared key header');
  assert.equal(T.FLOW_KEY_HEADER, 'x-cfx-flow-key');
  // The HubSpot token never goes to the flow.
  assert.ok(!JSON.stringify(sent).includes('test-token'));
  assert.deepEqual(sent.body, JSON.parse(JSON.stringify(payload)));
  assert.equal(payload.quoteTitle, 'Example MSP - AutoElevate');
  assert.equal(payload.quoteUrl, 'https://app.hubspot.com/quote/2585282/editor/Q9/content');
  assert.deepEqual(payload.reasons, ['35% discount on AutoElevate 1000 Agent Plan 2026', '4-month ramp']);
  assert.deepEqual(payload.routedApprover, { name: 'Tina Harvey', email: 'tina@example.com' });
  assert.deepEqual(payload.allowedApprovers, ['tina@example.com', 'trevor@example.com', 'harry@example.com', 'alex@example.com', 'anthony@example.com']);
  assert.equal(payload.ownerEmail, 'riley.rep@cyberfox.com');
  // Every HubSpot call used the token and the 2026-09 API.
  assert.ok(calls.filter((c) => c.host === 'api.hubapi.com').every((c) => c.auth === 'Bearer test-token'));
  // The card.
  const card = payload.card;
  assert.equal(card.version, '1.4');
  assert.equal(JSON.parse(payload.cardJson).type, 'AdaptiveCard');
  assert.deepEqual(card.actions.map((a) => [a.type, a.title]), [['Action.Submit', 'Approved'], ['Action.OpenUrl', 'Open in HubSpot']]);
  assert.deepEqual(card.actions[0].data, { action: 'approve', quoteId: 'Q9' });
  const text = JSON.stringify(card);
  for (const s of ['Quote approval needed', 'Example MSP', 'Riley Rep', 'Tina Harvey or Ops', '$682.50', '16 Months', 'Month-to-Month · Credit Card', 'Due Upon Receipt', '2026-12-19', 'Needs approval for: 35% discount', 'RAMP AutoElevate', '$1,050.00', '35%', '4 mo', '$682.50/mo']) {
    assert.ok(text.includes(s), `card shows ${s}`);
  }
  // Line items in quote order: the ramp line (position 1) first.
  const rows = card.body.filter((b) => b.type === 'ColumnSet');
  assert.equal(rows.length, 3); // header + 2 lines
  assert.match(rows[1].columns[0].items[0].text, /^RAMP/);
});

test('teams approvals: done and note cards for updating the same tile after a click', async () => {
  const { fetchImpl } = fakeApis();
  const payload = await T.run('Q9', ENV, fetchImpl);
  // Done card: same content, status line instead of the Approved button.
  const done = JSON.parse(payload.doneCardJson);
  assert.deepEqual(done.actions.map((a) => a.title), ['Open in HubSpot']);
  assert.equal(done.body[0].text, 'Quote approval');
  assert.equal(done.body[2].text, '{{STATUS}}');
  assert.equal(done.body[2].color, '{{STATUS_COLOR}}');
  assert.ok(payload.doneCardJson.includes('RAMP AutoElevate') && payload.doneCardJson.includes('$682.50/mo'));
  // What the flow does: replace() the placeholders; the result must still be valid JSON.
  const filled = payload.doneCardJson.replace('{{STATUS}}', '✅ Approved by Alex Munson on Nov 19, 2026 1:47 PM ET').replace('{{STATUS_COLOR}}', 'Good');
  assert.equal(JSON.parse(filled).body[2].text, '✅ Approved by Alex Munson on Nov 19, 2026 1:47 PM ET');
  // Note card: small, title + status + Open in HubSpot.
  const note = JSON.parse(payload.noteCardJson);
  assert.equal(note.body.length, 2);
  assert.deepEqual(note.actions.map((a) => a.type), ['Action.OpenUrl']);
  // The open card is unchanged: Approved first, no placeholders.
  assert.ok(!payload.cardJson.includes('{{STATUS}}'));
  assert.ok(payload.doneCardJson.length < 28000);
});

test('teams approvals: routes ENT to Adam and AM to Julie; the quote owner can never approve their own quote', async () => {
  const ent = await T.run('Q9', ENV, fakeApis({ salesTeam: 'ENT' }).fetchImpl);
  assert.equal(ent.routedApprover.name, 'Adam Friedman');
  const am = await T.run('Q9', ENV, fakeApis({ salesTeam: 'AM' }).fetchImpl);
  assert.equal(am.routedApprover.name, 'Julie Webb');
  // Ops member Alex builds a quote for a rep: Alex owns it, so Alex isn't in the allowed list.
  const ownQuote = await T.run('Q9', ENV, fakeApis({ ownerId: '16957424' }).fetchImpl);
  assert.ok(!ownQuote.allowedApprovers.includes('alex@example.com'));
  assert.ok(ownQuote.allowedApprovers.includes('tina@example.com'));
  // Unknown sales team: Ops only.
  const none = await T.run('Q9', ENV, fakeApis({ salesTeam: '' }).fetchImpl);
  assert.equal(none.routedApprover, null);
  assert.equal(none.allowedApprovers.length, 4);
});

test('teams approvals: reasons follow the approval policy (30%+ discount, 4+ month ramp)', () => {
  assert.deepEqual(T.approvalReasons([line({ hs_discount_percentage: '29.99' })]), []);
  assert.deepEqual(T.approvalReasons([line({ hs_discount_percentage: '30' })]), ['30% discount on AutoElevate 1000 Agent Plan 2026']);
  // A 100% ramp line is not a "discount"; a 3-month ramp is under the threshold.
  assert.deepEqual(T.approvalReasons([line({ name: 'RAMP AE', hs_discount_percentage: '100', hs_recurring_billing_period: 'P3M' })]), []);
  // Hand-built quote (no builder properties): ramp read from the RAMP line's term.
  assert.deepEqual(T.approvalReasons([line({ name: 'RAMP AE', hs_discount_percentage: '100', hs_recurring_billing_period: 'P4M' })]), ['4-month ramp']);
});

test('teams approvals: long quotes are trimmed on the card; foreign currency shows its code', () => {
  const lines = Array.from({ length: 30 }, (_, i) => line({ name: `Line ${i + 1}`, hs_position_on_quote: String(i + 1) }));
  const card = T.buildCard({ quoteId: 'Q1', title: 'Big', lines, reasons: [], currency: 'CAD', amount: 1390, quoteUrl: 'https://x' });
  const text = JSON.stringify(card);
  assert.ok(text.includes('+ 5 more line items in HubSpot'));
  assert.ok(text.includes('CA$1,390.00 (CAD)'));
  assert.ok(!text.includes('Needs approval for'));
});

test('teams approvals: missing secrets fail with a clear message', async () => {
  await assert.rejects(T.run('Q9', {}, fakeApis().fetchImpl), /QUOTE_APPROVALS_HUBSPOT_TOKEN/);
  await assert.rejects(T.run('Q9', { QUOTE_APPROVALS_HUBSPOT_TOKEN: 'x' }, fakeApis().fetchImpl), /QUOTE_APPROVALS_FLOW_URL/);
});

test('teams approvals: the flow key header is optional, sent when set, and a wrong key gives a clear error', async () => {
  const noKey = { QUOTE_APPROVALS_HUBSPOT_TOKEN: 'x', QUOTE_APPROVALS_FLOW_URL: 'https://flow.example.com/trigger' };
  const { fetchImpl, calls } = fakeApis();
  await T.run('Q9', noKey, fetchImpl);
  const sent = calls.find((c) => c.host === 'flow.example.com');
  assert.ok(sent && !('x-cfx-flow-key' in sent.headers), 'no header without the secret');
  await assert.rejects(T.run('Q9', { ...noKey, QUOTE_APPROVALS_FLOW_KEY: 'wrong' }, fakeApis().fetchImpl), /rejected the request/);
  // A rejected call shows Power Automate's reason.
  const off = async (url, init) => (new URL(url).host === 'flow.example.com'
    ? { ok: false, status: 400, text: async () => '{"error":{"code":"WorkflowNotEnabled","message":"The flow is turned off."}}' }
    : fakeApis().fetchImpl(url, init));
  await assert.rejects(T.run('Q9', noKey, off), /returned 400: .*WorkflowNotEnabled/);
  // Dry run doesn't need the key.
  const dry = await T.run('Q9', { ...noKey, QUOTE_APPROVALS_FLOW_URL: 'dry-run' }, fakeApis().fetchImpl);
  assert.equal(dry.dryRun, true);
});

test('teams approvals: dry-run builds the card without sending it', async () => {
  const { fetchImpl, calls } = fakeApis();
  const payload = await T.run('Q9', { QUOTE_APPROVALS_HUBSPOT_TOKEN: 'x', QUOTE_APPROVALS_FLOW_URL: 'dry-run' }, fetchImpl);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.lineCount, 2);
  assert.ok(payload.cardJson.length > 1000 && payload.cardJson.length < 28000);
  assert.equal(calls.filter((c) => c.host === 'flow.example.com').length, 0);
});

test('teams approvals: main returns the outputs (Node 24 style) and also calls a callback (older style)', async () => {
  const mod = require('../teams-approvals/quote-approval-to-teams.cjs');
  const { fetchImpl } = fakeApis();
  const realFetch = global.fetch;
  const env = { ...process.env };
  global.fetch = fetchImpl;
  process.env.QUOTE_APPROVALS_HUBSPOT_TOKEN = 'x';
  process.env.QUOTE_APPROVALS_FLOW_URL = 'dry-run';
  try {
    let called = null;
    const result = await mod.main({ object: { objectId: 'Q9' } }, (r) => { called = r; });
    assert.deepEqual(called, result);
    assert.equal(result.outputFields.posted, 'dry-run');
    assert.equal(result.outputFields.approver, 'Tina Harvey');
    const noCallback = await mod.main({ object: { objectId: 'Q9' } });
    assert.equal(noCallback.outputFields.lines, 2);
  } finally {
    global.fetch = realFetch;
    process.env = env;
  }
});
