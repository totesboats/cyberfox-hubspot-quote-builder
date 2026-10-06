// Creates the Quote Builder properties. Safe to re-run (existing properties are skipped).
//   node scripts/create-properties.mjs            # dry run: lists what it would create
//   node scripts/create-properties.mjs --apply
import { hs, apply } from './lib/api.mjs';
import { FAMILIES } from '../shared/config.mjs';

const opts = (pairs) => pairs.map(([value, label], i) => ({ value, label, displayOrder: i, hidden: false }));
const enumProp = (name, label, options) => ({ name, label, type: 'enumeration', fieldType: 'select', groupName: 'quote_builder', options: opts(options) });

const PRODUCT_PROPS = [
  enumProp('qb_family', 'Quote Builder: product family', Object.keys(FAMILIES).map((k) => [k, FAMILIES[k].label])),
  enumProp('qb_edition', 'Quote Builder: edition', [
    ['standard', 'Standard'],
    ['advanced', 'Advanced'],
    ['pack', 'User Pack'],
    ['commit', 'User Commit'],
  ]),
  enumProp('qb_segment', 'Quote Builder: segment', [
    ['MSP', 'MSP'],
    ['ENT', 'Enterprise'],
  ]),
  enumProp('qb_billing', 'Quote Builder: billing', [
    ['monthly', 'Monthly (term commit)'],
    ['annual', 'Annual'],
    ['m2m', 'Month-to-month'],
  ]),
  { name: 'qb_tier', label: 'Quote Builder: commit tier', type: 'number', fieldType: 'number', groupName: 'quote_builder', description: 'Units included in the commit (agents, users, devices). For Timus SATGAT, the monthly minimum.' },
  enumProp('qb_component', 'Quote Builder: component', [
    ['base', 'Commit plan'],
    ['additional', 'Additional units (overage)'],
    ['minimum', 'Timus monthly minimum'],
    ['satgat', 'Timus satisfaction guarantee'],
  ]),
];

const LINE_ITEM_PROPS = [
  { name: 'qb_source', label: 'Quote Builder: source', type: 'string', fieldType: 'text', groupName: 'quote_builder', description: 'Set to quote_builder on line items the Quote Builder card creates.' },
  { name: 'qb_session_id', label: 'Quote Builder: session', type: 'string', fieldType: 'text', groupName: 'quote_builder', description: 'Identifies the Quote Builder run that created this line item.' },
];

const QUOTE_PROPS = [
  { name: 'qb_session_id', label: 'Quote Builder: session', type: 'string', fieldType: 'text', groupName: 'quote_builder', description: 'Identifies the Quote Builder run that created this quote.' },
  { name: 'qb_builder_state', label: 'Quote Builder: saved inputs', type: 'string', fieldType: 'textarea', groupName: 'quote_builder', description: 'Builder inputs (JSON) so reps can start a new option from this quote or make it primary.' },
];

async function ensure(objectType, props) {
  const group = await hs(`/crm/v3/properties/${objectType}/groups/quote_builder`, { allow: [404] });
  if (group.status === 404) {
    console.log(`${objectType}: create group quote_builder`);
    if (apply) await hs(`/crm/v3/properties/${objectType}/groups`, { method: 'POST', body: { name: 'quote_builder', label: 'Quote Builder', displayOrder: -1 } });
  }
  for (const p of props) {
    const existing = await hs(`/crm/v3/properties/${objectType}/${p.name}`, { allow: [404] });
    if (existing.status !== 404) {
      console.log(`${objectType}.${p.name}: exists, skipped`);
      continue;
    }
    console.log(`${objectType}.${p.name}: ${apply ? 'creating' : 'would create'}`);
    if (apply) await hs(`/crm/v3/properties/${objectType}`, { method: 'POST', body: p });
  }
}

await ensure('products', PRODUCT_PROPS);
await ensure('line_items', LINE_ITEM_PROPS);
await ensure('quotes', QUOTE_PROPS);
if (!apply) console.log('\nDry run. Re-run with --apply to create.');
