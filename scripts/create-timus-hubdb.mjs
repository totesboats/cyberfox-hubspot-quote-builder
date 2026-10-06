// Creates the HubDB table of Timus price lists and seeds it from the deal property
// "Timus Price List" (timus_price_list). Minimum and gateway rate are parsed from each
// option label, e.g. "Tier 3 - $1000 (GW 50)". Per-user rates are left blank: fill them in
// HubDB (Marketing › Files and Templates › HubDB), then publish the table.
//   node scripts/create-timus-hubdb.mjs            # dry run → timus-price-lists-seed.csv
//   node scripts/create-timus-hubdb.mjs --apply    # creates + seeds + publishes the table
import { writeFileSync } from 'node:fs';
import { hs, apply, csv } from './lib/api.mjs';
import { TIMUS_HUBDB_TABLE } from '../shared/config.mjs';

export function parseLabel(label) {
  const min = label.match(/\$\s?([\d,]+)/);
  const gw = label.match(/GW\s*(\d+)/i);
  return { min_mrr: min ? Number(min[1].replace(/,/g, '')) : null, gateway_rate: gw ? Number(gw[1]) : null };
}

const COLUMNS = [
  { name: 'price_list_value', label: 'Price list value (timus_price_list)', type: 'TEXT' },
  { name: 'label', label: 'Label', type: 'TEXT' },
  { name: 'min_mrr', label: 'Monthly minimum', type: 'NUMBER' },
  { name: 'gateway_rate', label: 'Gateway rate', type: 'NUMBER' },
  { name: 'advanced_user_rate', label: 'Advanced user rate', type: 'NUMBER' },
  { name: 'essentials_user_rate', label: 'Essentials user rate', type: 'NUMBER' },
  { name: 'active', label: 'Active', type: 'BOOLEAN' },
];

async function main() {
  const { data: prop } = await hs('/crm/v3/properties/deals/timus_price_list');
  const rows = prop.options
    .filter((o) => !o.hidden)
    .map((o) => {
      const parsed = parseLabel(o.label);
      return {
        price_list_value: o.value,
        label: o.label,
        min_mrr: parsed.min_mrr,
        gateway_rate: parsed.gateway_rate,
        advanced_user_rate: '',
        essentials_user_rate: '',
        active: parsed.min_mrr != null && !/legacy|poc|internal/i.test(o.label),
      };
    });
  writeFileSync('timus-price-lists-seed.csv', csv(rows));
  console.log(`${rows.length} price lists (${rows.filter((r) => r.active).length} active) → timus-price-lists-seed.csv`);
  if (!apply) return console.log('Dry run. Re-run with --apply to create the HubDB table.');

  const existing = await hs(`/cms/v3/hubdb/tables/${TIMUS_HUBDB_TABLE}`, { allow: [404] });
  if (existing.status !== 404) return console.log(`Table ${TIMUS_HUBDB_TABLE} already exists; not touching it.`);
  const { data: table } = await hs('/cms/v3/hubdb/tables', {
    method: 'POST',
    body: { name: TIMUS_HUBDB_TABLE, label: 'Quote Builder – Timus price lists', useForPages: false, allowPublicApiAccess: false, columns: COLUMNS },
  });
  const values = (r) => {
    const v = { price_list_value: r.price_list_value, label: r.label, active: r.active ? 1 : 0 };
    if (r.min_mrr != null) v.min_mrr = r.min_mrr;
    if (r.gateway_rate != null) v.gateway_rate = r.gateway_rate;
    return v;
  };
  for (let i = 0; i < rows.length; i += 100) {
    await hs(`/cms/v3/hubdb/tables/${table.id}/rows/draft/batch/create`, { method: 'POST', body: { inputs: rows.slice(i, i + 100).map((r) => ({ values: values(r) })) } });
  }
  await hs(`/cms/v3/hubdb/tables/${table.id}/draft/publish`, { method: 'POST' });
  console.log(`Created and published ${TIMUS_HUBDB_TABLE} (id ${table.id}). Now fill in user rates and publish again.`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) await main();
