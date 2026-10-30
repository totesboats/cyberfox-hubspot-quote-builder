// "Line items by product": one line item table per CyberFOX product on the quote, AutoElevate first.
// A product's table only appears when the quote has lines for it. Styled like HubSpot's own line
// items table (Product name, Quantity, Term, Unit discount, Net Price). Add this module to a CPQ
// quote template and hide (don't delete) the default Line items module: HubSpot needs it on the
// template to edit the line items.
import { ModuleFields, TextField, NumberField, FieldGroup } from '@hubspot/cms-components/fields';
import type { QuoteTemplateContext } from '@hubspot/quote-dev-sdk';

import { groupLineItems, rowCells, SAMPLE_LINE_ITEMS, PRODUCT_GROUPS, OTHER_GROUP } from './productGroups.js';

type LineItem = QuoteTemplateContext['lineItems'][number];

interface FieldValues {
  heading?: string;
  sidePadding?: number;
  headings?: Record<string, string>;
}

interface HublData {
  lineItems: LineItem[];
  currency?: string;
  isQuoteBlueprint: boolean;
}

interface Props {
  fieldValues: FieldValues;
  hublData: HublData;
}

// Matches HubSpot's native quote line items table.
const LINE = '#eaf0f6';
const th = { padding: '10px 12px', fontWeight: 700, textAlign: 'left' as const, borderBottom: `6px solid ${LINE}`, whiteSpace: 'nowrap' as const };
const td = { padding: '14px 12px', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' as const };
const right = { textAlign: 'right' as const };

function ProductTable({ label, items, currency }: { label: string; items: LineItem[]; currency?: string }) {
  return (
    <section style={{ marginBottom: 32, breakInside: 'avoid' }}>
      <h3 style={{ margin: '0 0 12px 0', fontSize: '1.15em', fontWeight: 700 }}>{label}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={{ ...th, width: '42%' }}>Product name</th>
            <th style={{ ...th, ...right }}>Quantity</th>
            <th style={th}>Term</th>
            <th style={{ ...th, ...right }}>Unit discount</th>
            <th style={{ ...th, ...right }}>Net Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const c = rowCells(item, currency);
            return (
              <tr key={String(item.hs_object_id ?? i)}>
                <td style={{ ...td, fontWeight: 700 }}>{c.name}</td>
                <td style={{ ...td, ...right }}>{c.quantity}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.term}</td>
                <td style={{ ...td, ...right }}>{c.discount}</td>
                <td style={{ ...td, ...right, whiteSpace: 'nowrap' }}>{c.amount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function Component({ fieldValues, hublData }: Props) {
  const { isQuoteBlueprint, currency } = hublData;
  const lineItems = (hublData.lineItems && hublData.lineItems.length ? hublData.lineItems : isQuoteBlueprint ? SAMPLE_LINE_ITEMS : []) as LineItem[];
  const groups = groupLineItems(lineItems as Array<Record<string, unknown>>, fieldValues.headings || {});
  if (!groups.length) return null;
  const side = typeof fieldValues.sidePadding === 'number' ? fieldValues.sidePadding : 32;
  return (
    <div style={{ margin: '16px 0', padding: `0 ${side}px`, boxSizing: 'border-box' }}>
      {fieldValues.heading ? <h2 style={{ margin: '0 0 16px 0' }}>{fieldValues.heading}</h2> : null}
      {groups.map((g) => (
        <ProductTable key={g.key} label={g.label} items={g.items as LineItem[]} currency={currency} />
      ))}
    </div>
  );
}

export const fields = (
  <ModuleFields>
    <TextField name="heading" label="Heading above the tables" default="" />
    <NumberField name="sidePadding" label="Space at the left and right edges" suffix="px" min={0} max={80} step={4} default={32} />
    <FieldGroup name="headings" label="Table headings">
      {PRODUCT_GROUPS.concat([OTHER_GROUP as (typeof PRODUCT_GROUPS)[number]]).map((g) => (
        <TextField key={g.key} name={g.key} label={`${g.label} table heading`} default={g.label} />
      ))}
    </FieldGroup>
  </ModuleFields>
);

export const meta = {
  label: 'Line items by product',
  content_types: ['QUOTE', 'QUOTE_BLUEPRINT'],
};

// Only what the tables need is passed to the page.
export const hublDataTemplate = `
  {% set hublData = {
    "lineItems": quoteTemplateContext.lineItems,
    "currency": quoteTemplateContext.quote.hs_currency,
    "isQuoteBlueprint": isQuoteBlueprint
  } %}
`;
