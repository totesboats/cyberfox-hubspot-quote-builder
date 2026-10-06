import test from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../scripts/tag-products.mjs';
import { parseLabel } from '../scripts/create-timus-hubdb.mjs';
import { normalizeTemplates, suggestTemplate } from '../shared/pricing.mjs';

const P = (name, sku, folder, freq = 'monthly') => ({ name, hs_sku: sku, hs_folder: `${folder} (auto_generated_x)`, recurringbillingfrequency: freq });

test('classify: AutoElevate commit, additional, enterprise annual, month-to-month', () => {
  assert.deepEqual(classify(P('AutoElevate 1000 Agent Plan 2026', 'Standard-AE-1000-Agent-Commit-2026', 'AutoElevate - Standard 2026')).tags, {
    qb_family: 'autoelevate', qb_edition: 'standard', qb_component: 'base', qb_segment: 'MSP', qb_billing: 'monthly', qb_tier: '1000',
  });
  const add = classify(P('AutoElevate 100 Agent Plan Additional Agents Enterprise Annual Advanced 2026', 'Advanced-AE-100-Agent-Commit-Annual-Additional-Agents-E+2026', 'AutoElevate - Advanced 2026', 'annually')).tags;
  assert.equal(add.qb_component, 'additional');
  assert.equal(add.qb_segment, 'ENT');
  assert.equal(add.qb_billing, 'annual');
  assert.equal(add.qb_edition, 'advanced');
  assert.equal(classify(P('AutoElevate 100 Agent Plan Month-to-Month 2026', 'M2M-Standard-AE-100-Agent-Commit-2026', 'AutoElevate - Standard 2026')).tags.qb_billing, 'm2m');
});

test('classify: skips one-offs, legacy packs in PB6, and products outside builder folders', () => {
  assert.equal(classify(P('AutoElevate 250 Agent Plan Annual Advanced 2026', 'Advanced-AE-250-Agent-Annual-Commit-2026-1off', 'AutoElevate - Advanced 2026')).status, 'skip');
  assert.equal(classify(P('Password Boss 500 User Pack', 'PB-500-User-Pack', 'Password Boss 6')).status, 'skip');
  assert.equal(classify(P('MSP Gold - 400 Users', 'MSP-012-400', 'PasswordBoss')), null);
});

test('classify: Timus minimum and SATGAT', () => {
  const min = classify(P('Timus SASE - Monthly Minimum', 'Timus SASE - Monthly Minimum', 'Timus - Advanced 2026'));
  assert.equal(min.tags.qb_component, 'minimum');
  const sat = classify(P('Timus SASE - SATGAT II', 'Timus SASE - SATGAT II', 'Timus - Advanced 2026'));
  assert.equal(sat.tags.qb_component, 'satgat');
  assert.equal(sat.tags.qb_tier, '500');
});

test('parseLabel reads minimum and gateway rate', () => {
  assert.deepEqual(parseLabel('Tier 3 - $1000 (GW 50)'), { min_mrr: 1000, gateway_rate: 50 });
  assert.deepEqual(parseLabel('Tier 4 - $10,000 (GW 50)'), { min_mrr: 10000, gateway_rate: 50 });
  assert.deepEqual(parseLabel('Pax8 Tier - $1500'), { min_mrr: 1500, gateway_rate: null });
  assert.deepEqual(parseLabel('PoC'), { min_mrr: null, gateway_rate: null });
});

test('templates: CPQ first, hidden one-offs, suggestion by product', () => {
  const t = normalizeTemplates([
    { id: '1', properties: { hs_name: 'AutoElevate', hs_type: 'customizable_quote_template' } },
    { id: '2', properties: { hs_name: 'AutoElevate', hs_type: 'cpq_template' } },
    { id: '3', properties: { hs_name: 'Password Manager / DNS', hs_type: 'cpq_template' } },
    { id: '4', properties: { hs_name: 'Timus SASE - Example Partner ONE OFF', hs_type: 'customizable_quote_template' } },
    { id: '5', properties: { hs_name: 'Clone of Timus SASE', hs_type: 'cpq_template' } },
    { id: '6', properties: { hs_name: 'Timus SASE', hs_type: 'cpq_template' } },
  ]);
  assert.deepEqual(t.map((x) => x.id), ['2', '3', '6', '1']);
  assert.equal(suggestTemplate(t, ['autoelevate']).id, '2');
  assert.equal(suggestTemplate(t, ['password', 'dns']).id, '3');
  assert.equal(suggestTemplate(t, ['dns']).id, '3');
  assert.equal(suggestTemplate(t, []), null);
});
