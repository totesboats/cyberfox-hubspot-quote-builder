// "Line items by product": one line item table per CyberFOX product on the quote, AutoElevate first.
// A product's table only appears when the quote has lines for it. Add this module to a CPQ quote
// template in place of the default Line items module (keep the default one on the template, hidden:
// HubSpot needs it to edit the line items).
import { ModuleFields, TextField, BooleanField, ColorField, FieldGroup } from '@hubspot/cms-components/fields';
import { BILLING_FREQUENCY_ORDER, BILLING_FREQUENCY_LABELS } from '@hubspot/quote-dev-sdk';
import type { QuoteTemplateContext } from '@hubspot/quote-dev-sdk';

import { groupLineItems, money, rowCells, SAMPLE_LINE_ITEMS, PRODUCT_GROUPS, OTHER_GROUP } from './productGroups.js';

type LineItem = QuoteTemplateContext['lineItems'][number];

interface FieldValues {
  heading?: string;
  showTotals?: boolean;
  headings?: Record<string, string>;
  styles?: {
    headerBackground?: { css: string };
    headerText?: { css: string };
  };
}

interface HublData {
  lineItems: LineItem[];
  currency?: string;
  tcv?: number;
  quoteTotals?: QuoteTemplateContext['quoteTotals'];
  isQuoteBlueprint: boolean;
}

interface Props {
  fieldValues: FieldValues;
  hublData: HublData;
}

const cell = { padding: '8px 10px', borderBottom: '1px solid #e5e8eb', verticalAlign: 'top' as const };
const num = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const };

function ProductTable({ label, items, currency, headerStyle }: { label: string; items: LineItem[]; currency?: string; headerStyle: Record<string, string | undefined> }) {
  return (
    <section style={{ marginBottom: 24, breakInside: 'avoid' }}>
      <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1em' }}>{label}</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.92em' }}>
        <thead>
          <tr style={headerStyle}>
            <th style={{ ...cell, textAlign: 'left' }}>Product</th>
            <th style={{ ...num }}>Quantity</th>
            <th style={{ ...num }}>Unit price</th>
            <th style={{ ...num }}>Discount</th>
            <th style={{ ...num }}>Term</th>
            <th style={{ ...num }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => {
            const c = rowCells(item, currency);
            return (
              <tr key={String(item.hs_object_id ?? i)}>
                <td style={cell}>{c.name}</td>
                <td style={num}>{c.quantity}</td>
                <td style={num}>{c.unitPrice}</td>
                <td style={num}>{c.discount}</td>
                <td style={num}>{c.term}</td>
                <td style={num}>{c.amount}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Totals({ quoteTotals, tcv, currency }: { quoteTotals?: HublData['quoteTotals']; tcv?: number; currency?: string }) {
  const subTotals = (quoteTotals && quoteTotals.subTotals) || {};
  const rows = BILLING_FREQUENCY_ORDER.filter((freq) => typeof subTotals[freq]?.subTotal === 'number').map((freq) => ({
    label: `${BILLING_FREQUENCY_LABELS[freq]} subtotal`,
    value: money(subTotals[freq]!.subTotal, currency),
  }));
  if (typeof tcv === 'number' && tcv > 0) rows.push({ label: 'Total contract value', value: money(tcv, currency) });
  if (!rows.length) return null;
  return (
    <table style={{ marginLeft: 'auto', borderCollapse: 'collapse', fontSize: '0.95em' }}>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label}>
            <td style={{ padding: '4px 12px', textAlign: 'right' }}>{r.label}</td>
            <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Component({ fieldValues, hublData }: Props) {
  const { isQuoteBlueprint, currency, quoteTotals, tcv } = hublData;
  const lineItems = (hublData.lineItems && hublData.lineItems.length ? hublData.lineItems : isQuoteBlueprint ? SAMPLE_LINE_ITEMS : []) as LineItem[];
  const groups = groupLineItems(lineItems as Array<Record<string, unknown>>, fieldValues.headings || {});
  const headerStyle = {
    backgroundColor: fieldValues.styles?.headerBackground?.css || '#f5f8fa',
    color: fieldValues.styles?.headerText?.css || undefined,
  };
  if (!groups.length) return null;
  return (
    <div style={{ margin: '16px 0' }}>
      {fieldValues.heading ? <h2 style={{ margin: '0 0 16px 0' }}>{fieldValues.heading}</h2> : null}
      {groups.map((g) => (
        <ProductTable key={g.key} label={g.label} items={g.items as LineItem[]} currency={currency} headerStyle={headerStyle} />
      ))}
      {fieldValues.showTotals !== false ? <Totals quoteTotals={quoteTotals} tcv={tcv} currency={currency} /> : null}
    </div>
  );
}

export const fields = (
  <ModuleFields>
    <TextField name="heading" label="Heading above the tables" default="" />
    <BooleanField name="showTotals" label="Show totals under the tables" default={true} />
    <FieldGroup name="headings" label="Table headings">
      {PRODUCT_GROUPS.concat([OTHER_GROUP as (typeof PRODUCT_GROUPS)[number]]).map((g) => (
        <TextField key={g.key} name={g.key} label={`${g.label} table heading`} default={g.label} />
      ))}
    </FieldGroup>
    <FieldGroup name="styles" label="Styles" tab="STYLE">
      <ColorField name="headerBackground" label="Table header background" />
      <ColorField name="headerText" label="Table header text" />
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
    "tcv": quoteTemplateContext.quote.hs_tcv,
    "quoteTotals": quoteTemplateContext.quoteTotals,
    "isQuoteBlueprint": isQuoteBlueprint
  } %}
`;
