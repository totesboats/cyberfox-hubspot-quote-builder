// Tags 2026 products with the qb_* properties the Quote Builder reads.
//   node scripts/tag-products.mjs            # dry run → product-tagging-review.csv
//   node scripts/tag-products.mjs --apply    # writes tags for rows with status "ok"
// Review the CSV first: rows marked "conflict" or "skip" are never written; fix them in
// HubSpot (or tag by hand) and re-run.
import { writeFileSync } from 'node:fs';
import { hs, searchAll, apply, csv } from './lib/api.mjs';
import { TIMUS } from '../shared/config.mjs';

// Which product folders feed the builder, and what they mean. Edit when a new price book ships.
const FOLDER_RULES = [
  { folder: /^AutoElevate - Standard 2026/, family: 'autoelevate', edition: 'standard' },
  { folder: /^AutoElevate - Advanced 2026/, family: 'autoelevate', edition: 'advanced' },
  { folder: /^DNS Filtering - 2026/, family: 'dns', edition: 'standard' },
  { folder: /^Password Boss - 2026/, family: 'password', edition: 'pack' },
  { folder: /^Password Boss 6/, family: 'password', edition: 'commit' },
  { folder: /^Optimize365/, family: 'optimize365', edition: 'standard' },
  { folder: /^Timus - Advanced 2026/, family: 'timus', edition: 'advanced' },
  { folder: /^Bundles - 2026/, family: 'bundle', edition: 'standard' },
];
const SATGAT_TIER = Object.fromEntries(Object.entries(TIMUS.satgatSkuByMinimum).map(([min, sku]) => [sku, Number(min)]));

export function classify(p) {
  const name = (p.name || '').trim();
  const sku = (p.hs_sku || '').trim();
  const folder = (p.hs_folder || '').replace(/ \(auto_generated.*$/, '');
  const rule = FOLDER_RULES.find((r) => r.folder.test(folder));
  if (!rule) return null;
  const n = name.toLowerCase();
  const tags = { qb_family: rule.family, qb_edition: rule.edition };
  if (/1off/i.test(sku)) return { tags, status: 'skip', note: 'one-off SKU' };
  if (rule.edition === 'commit' && /pack/i.test(name)) return { tags, status: 'skip', note: 'legacy user pack in the PB6 folder' };

  if (rule.family === 'timus') {
    if (sku === TIMUS.minimumSku) Object.assign(tags, { qb_component: 'minimum', qb_tier: '' });
    else if (SATGAT_TIER[sku]) Object.assign(tags, { qb_component: 'satgat', qb_tier: String(SATGAT_TIER[sku]) });
    else return { tags, status: 'skip', note: 'unrecognised Timus SKU' };
    return { tags: Object.assign(tags, { qb_segment: 'MSP', qb_billing: 'monthly' }), status: 'ok', note: '' };
  }

  tags.qb_component = /additional/i.test(name) ? 'additional' : 'base';
  tags.qb_segment = /enterprise/i.test(name) || /-E(\+|-|$)|-ENT/.test(sku) ? 'ENT' : 'MSP';
  tags.qb_billing = /month-to-month/i.test(n) || /M2M/.test(sku) ? 'm2m' : /annual/i.test(n) || p.recurringbillingfrequency === 'annually' ? 'annual' : 'monthly';
  const m = name.match(/(\d+) (?:Agent|Device|User)/) || name.match(/Bundle (\d+)/) || name.match(/(\d+) Additional/);
  if (!m) return { tags, status: 'skip', note: 'no tier number in the product name' };
  tags.qb_tier = m[1];
  return { tags, status: 'ok', note: '' };
}

async function main() {
  const products = await searchAll('products', {
    filterGroups: [{ filters: [{ propertyName: 'hs_status', operator: 'EQ', value: 'active' }] }],
    properties: ['name', 'hs_sku', 'hs_folder', 'hs_price_usd', 'recurringbillingfrequency', 'qb_family'],
  });

  const rows = [];
  for (const p of products) {
    const c = classify(p.properties);
    if (!c) continue;
    rows.push({ id: p.id, sku: p.properties.hs_sku, name: p.properties.name, price: p.properties.hs_price_usd, ...c.tags, status: c.status, note: c.note });
  }

  // Two products claiming the same slot → both become conflicts.
  const slot = (r) => [r.qb_family, r.qb_edition, r.qb_segment, r.qb_billing, r.qb_component, r.qb_tier].join('|');
  const seen = new Map();
  for (const r of rows.filter((r) => r.status === 'ok')) {
    const k = slot(r);
    if (seen.has(k)) {
      for (const other of [seen.get(k), r]) Object.assign(other, { status: 'conflict', note: `same slot as another SKU (${k})` });
    } else seen.set(k, r);
  }

  writeFileSync('product-tagging-review.csv', csv(rows));
  const count = (s) => rows.filter((r) => r.status === s).length;
  console.log(`${rows.length} products in builder folders: ${count('ok')} ok, ${count('conflict')} conflict, ${count('skip')} skip → product-tagging-review.csv`);

  if (!apply) return console.log('Dry run. Review the CSV, then re-run with --apply.');
  const ok = rows.filter((r) => r.status === 'ok');
  for (let i = 0; i < ok.length; i += 100) {
    const inputs = ok.slice(i, i + 100).map((r) => ({
      id: r.id,
      properties: { qb_family: r.qb_family, qb_edition: r.qb_edition, qb_segment: r.qb_segment, qb_billing: r.qb_billing, qb_tier: r.qb_tier, qb_component: r.qb_component },
    }));
    await hs('/crm/v3/objects/products/batch/update', { method: 'POST', body: { inputs } });
    console.log(`tagged ${Math.min(i + 100, ok.length)}/${ok.length}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
