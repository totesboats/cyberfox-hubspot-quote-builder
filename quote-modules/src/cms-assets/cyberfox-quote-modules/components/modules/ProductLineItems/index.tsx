// "Line items by product": one line item table per CyberFOX product on the quote, AutoElevate first.
// On a co-term quote (any line with qb_line_type = coterm) the new products print first, and the
// co-term lines print under their own "Your current subscriptions" heading at the same level. The
// Net Price cell is stacked like the legacy quote: list price struck out, "after N% discount", net price. Quotes without co-term lines are unchanged.
// A product's table only appears when the quote has lines for it. Styled like HubSpot's own line
// items table (Product name, Quantity, Term, Unit discount, Net Price). Add this module to a CPQ
// quote template and hide (don't delete) the default Line items module: HubSpot needs it on the
// template to edit the line items.
import { ModuleFields, TextField, NumberField, FieldGroup } from '@hubspot/cms-components/fields';
import type { QuoteTemplateContext } from '@hubspot/quote-dev-sdk';

import { quoteLayout, rowCells, SAMPLE_LINE_ITEMS, PRODUCT_GROUPS, OTHER_GROUP, COTERM_TEXT } from './productGroups.js';

type LineItem = QuoteTemplateContext['lineItems'][number];

interface FieldValues {
  heading?: string;
  sidePadding?: number;
  headings?: Record<string, string>;
  cotermText?: { newHeading?: string; existingHeading?: string; existingNote?: string };
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
// Type follows the CPQ template (Lexend Deca, 14px body at weight 300, black): section headings match
// its own h2s ("General Terms", "Signature": 22px / 600), with weight 600 elsewhere instead of 700.
const th = { padding: '10px 12px', fontWeight: 600, textAlign: 'left' as const, borderBottom: `6px solid ${LINE}`, whiteSpace: 'nowrap' as const };
const td = { padding: '14px 12px', borderBottom: `1px solid ${LINE}`, verticalAlign: 'top' as const, lineHeight: 1.5 };
const right = { textAlign: 'right' as const };
const GREEN = '#00a38d'; // the legacy quote's "after N% discount"
const GREY = '#7c98b6';

function ProductTable({ label, items, currency }: { label: string; items: LineItem[]; currency?: string }) {
  return (
    <section style={{ marginBottom: 32, breakInside: 'avoid' }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '16px', fontWeight: 600 }}>{label}</h3>
      {/* Fixed column widths so every product's table lines up. */}
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '38%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '34%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={th}>Product name</th>
            <th style={{ ...th, ...right }}>Quantity</th>
            <th style={th}>Term</th>
            <th style={{ ...th, ...right }}>Net Price</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const c = rowCells(item, currency);
            return (
              <tr key={String(item.hs_object_id ?? i)}>
                <td style={{ ...td, fontWeight: 400 }}>{c.name}</td>
                <td style={{ ...td, ...right }}>{c.quantity}</td>
                <td style={{ ...td, whiteSpace: 'nowrap' }}>{c.term}</td>
                <td style={{ ...td, ...right }}>
                  {c.listPrice ? <div style={{ color: GREY, textDecoration: 'line-through', whiteSpace: 'nowrap' }}>{c.listPrice}</div> : null}
                  {c.discountLabel ? <div style={{ color: GREEN, whiteSpace: 'nowrap' }}>{c.discountLabel}</div> : null}
                  <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{c.netPrice}</div>
                </td>
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
  const layout = quoteLayout(lineItems as Array<Record<string, unknown>>, fieldValues.headings || {});
  const side = typeof fieldValues.sidePadding === 'number' ? fieldValues.sidePadding : 32;
  const wrap = { margin: '16px 0', padding: `0 ${side}px`, boxSizing: 'border-box' as const };
  const heading = fieldValues.heading ? <h2 style={{ margin: '0 0 16px 0' }}>{fieldValues.heading}</h2> : null;
  const tables = (groups: Array<{ key: string; label: string; items: unknown[] }>) =>
    groups.map((g) => <ProductTable key={g.key} label={g.label} items={g.items as LineItem[]} currency={currency} />);
  // Co-term section headings: same style as the template's own section headings.
  const sectionHeading = { margin: '0 0 20px 0', fontSize: '22px', lineHeight: '28px', fontWeight: 600 };

  if (!layout.coterm) {
    if (!layout.newGroups.length) return null;
    return (
      <div style={wrap}>
        {heading}
        {tables(layout.newGroups)}
      </div>
    );
  }

  // Co-term quote: new subscriptions first, then current ones, both at the same level.
  const text = { ...COTERM_TEXT, ...Object.fromEntries(Object.entries(fieldValues.cotermText || {}).filter(([, v]) => String(v || '').trim())) };
  return (
    <div style={wrap}>
      {heading}
      {layout.newGroups.length ? (
        <>
          <h2 style={sectionHeading}>{text.newHeading}</h2>
          {tables(layout.newGroups)}
        </>
      ) : null}
      <h2 style={{ ...sectionHeading, marginTop: layout.newGroups.length ? 40 : 0, marginBottom: text.existingNote ? 8 : 20 }}>{text.existingHeading}</h2>
      {text.existingNote ? <p style={{ margin: '0 0 20px 0', lineHeight: 1.5 }}>{text.existingNote}</p> : null}
      {tables(layout.existingGroups)}
    </div>
  );
}

export const fields = (
  <ModuleFields>
    <TextField name="heading" label="Heading above the tables" default="" />
    <NumberField name="sidePadding" label="Space at the left and right edges" suffix="px" min={0} max={80} step={4} default={32} />
    <FieldGroup name="cotermText" label="Co-term quotes (only shown when the quote has co-term lines)">
      <TextField name="newHeading" label="Heading above the new subscriptions" default={COTERM_TEXT.newHeading} />
      <TextField name="existingHeading" label="Heading above the current subscriptions" default={COTERM_TEXT.existingHeading} />
      <TextField name="existingNote" label="Optional note under that heading (blank = no note)" default={COTERM_TEXT.existingNote} />
    </FieldGroup>
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
