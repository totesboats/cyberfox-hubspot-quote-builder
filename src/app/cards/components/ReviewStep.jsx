import React from 'react';
import { Alert, AutoGrid, Button, Checkbox, DescriptionList, DescriptionListItem, Flex, Heading, Link, Tag, Text, TextArea, Tile } from '@hubspot/ui-extensions';
import { autoQuoteName } from '../lib/pricing.js';
import { LineTable } from './LineTable.jsx';

// Deal properties shown with their HubSpot labels, in the order the templates use them.
const TOKEN_ROWS = [
  ['agreement_length', 'Agreement Length'],
  ['payment_terms', 'Payment Frequency'],
  ['payment_method', 'Payment Method'],
  ['invoice_terms', 'Invoice Terms'],
  ['promo', 'Promo'],
  ['sku_type', 'AE Feature Type'],
  ['ae_feature_type_details', 'AE Feature Type Details'],
  ['timus_price_per_user', 'Timus Price Per User'],
  ['timus_price_per_gateway', 'Timus Price Per Gateway'],
  ['new_minimum_commitment_amount', 'Timus New Minimum Commitment Amount'],
  ['hubspot_quote_notes', 'HubSpot Quote Notes'],
];

export function ReviewStep({ quote, setup, template, deal, products, notes, onNotes, primary, editing, firstBuilderQuote, onPrimary, affectedQuotes = [], onAnotherOption, result, writes, dealOptions }) {
  const labelFor = (name, value) => {
    const o = ((dealOptions && dealOptions[name]) || []).find((x) => x.value === value);
    return o && o.label !== value ? `${o.label} (${value})` : value;
  };
  const tokenRows = TOKEN_ROWS.filter(([name]) => writes && name in writes.properties).map(([name, label]) => {
    const v = writes.properties[name];
    const shown = name === 'hubspot_quote_notes' ? (v ? 'Notes for approvers' : '') : labelFor(name, v);
    return { name, label, value: shown === '' ? 'Cleared' : shown };
  });
  const title = (setup.quoteName || '').trim() || autoQuoteName(deal.company && deal.company.name, products, quote.anyRamp ? quote.ramp.months : 0);
  const rampCount = quote.lines.filter((l) => l.ramp).length;
  const signer = deal.contacts.find((c) => c.id === setup.signerContactId);

  return (
    <Flex direction="column" gap="medium">
      {result && result.ok && (
        <Alert title={result.edited ? 'Quote updated' : 'Draft quote created'} variant="success">
          <Flex direction="column" gap="extra-small">
            <Text>
              {result.title} has {result.lineCount} line items
              {result.primary ? ` and is the primary option${result.replaced ? ` (replaced ${result.replaced} earlier deal lines)` : ''}` : '; the deal line items were left alone'}.{' '}
              {result.approval.required
                ? result.approval.manual
                  ? `It needs approval from ${result.approval.approver}; this template doesn't run Commerce Hub approvals, so request it manually.`
                  : `It needs approval: open it and click Request approval. It routes to ${result.approval.approver}.`
                : 'No approval needed. Open it to review, publish and send.'}
            </Text>
            {result.edited && quote.approval.required && <Text variant="microcopy">If it was approved or had changes requested, request approval again in HubSpot.</Text>}
            <Text variant="microcopy">Publish it before building another option, so it keeps these printed values.</Text>
            <Flex gap="small" align="center" wrap>
              <Link href={{ url: result.quoteUrl, external: true }}>Open quote in HubSpot</Link>
              <Button size="sm" variant="secondary" onClick={onAnotherOption}>
                Build another option
              </Button>
            </Flex>
          </Flex>
        </Alert>
      )}
      {affectedQuotes.length > 0 && !(result && result.ok) && (
        <Alert title="Unpublished quotes will pick up these values" variant="warning">
          {`The printed fields live on the deal, and these quotes aren't published yet, so they would show this quote's values too: ${affectedQuotes
            .map((q) => q.title)
            .join(', ')}. Publish them first if they should keep their current values.`}
        </Alert>
      )}
      {result && !result.ok && (
        <Alert title={editing ? 'Quote not updated' : 'Quote not created'} variant="danger">
          {(result.errors || []).join(' ')}
        </Alert>
      )}

      <Tile>
        <Flex direction="column" gap="small">
          <Flex justify="between" align="center" wrap>
            <Heading>Review line items</Heading>
            <Tag>{`${quote.lines.length} lines · ${rampCount} ramp`}</Tag>
          </Flex>
          <LineTable lines={quote.lines} detailed billing={setup.billing} />
        </Flex>
      </Tile>

      <Tile>
        <Flex direction="column" gap="small">
          <Heading>Deal properties the quote prints</Heading>
          <Text variant="microcopy">Chosen on the Setup step (AE Feature Type on the AutoElevate product). Go back to change any of them.</Text>
          {writes.errors.map((e) => (
            <Alert key={e} title="Can't write this value" variant="danger">
              {e}
            </Alert>
          ))}
          {writes.warnings.map((w) => (
            <Alert key={w} title="Check this" variant="warning">
              {w}
            </Alert>
          ))}
          <DescriptionList direction="row">
            {tokenRows.map((r) => (
              <DescriptionListItem key={r.name} label={r.label}>
                {r.value}
              </DescriptionListItem>
            ))}
          </DescriptionList>
        </Flex>
      </Tile>

      <Tile>
        <Flex direction="column" gap="medium">
          <Heading>{editing ? 'What Update quote writes to HubSpot' : 'What Create quote writes to HubSpot'}</Heading>
          <AutoGrid columnWidth={240} gap="medium" flexible>
            <DescriptionList direction="column">
              <DescriptionListItem label="Quote">{title}</DescriptionListItem>
              <DescriptionListItem label="Template">{template ? `${template.name} (${template.templateType === 'CPQ_QUOTE' ? 'CPQ' : 'legacy'})` : 'Not chosen'}</DescriptionListItem>
              <DescriptionListItem label="Expires · status">{`${setup.expirationDate} · Draft`}</DescriptionListItem>
              <DescriptionListItem label="Contact">{signer ? signer.label : 'None'}</DescriptionListItem>
            </DescriptionList>
            <DescriptionList direction="column">
              <DescriptionListItem label="Deal line items">{primary ? `${quote.lines.length} new, replacing the previous primary option's lines` : 'Unchanged (not the primary option)'}</DescriptionListItem>
              <DescriptionListItem label="Quote line items">
                {editing ? `${quote.lines.length} new, replacing this quote's current lines` : 'A separate copy of each (CPQ keeps quote lines apart from deal lines)'}
              </DescriptionListItem>
              <DescriptionListItem label="Ramp lines">
                {rampCount ? `${rampCount} with Ramp = Yes, Term P${quote.ramp.months}M, Approval Ramp Months = ${quote.ramp.months}` : 'None'}
              </DescriptionListItem>
              <DescriptionListItem label="Approval Discount %">Each line's discount (0 on RAMP lines)</DescriptionListItem>
            </DescriptionList>
          </AutoGrid>
          <TextArea
            label="Notes for approvers"
            name="notes"
            rows={3}
            placeholder="Why this discount or ramp? e.g. competitive displacement, migration time needed"
            description="Saved to the deal's HubSpot Quote Notes property; not printed on the quote."
            value={notes}
            onChange={onNotes}
          />
          {editing ? (
            <Text variant="microcopy">{editing.primary ? 'This quote is the primary option and stays primary.' : 'This quote is an alternative option; use Make primary under Quotes on this deal to switch.'}</Text>
          ) : (
          <Checkbox
            name="primary"
            checked={primary}
            readOnly={firstBuilderQuote}
            description={
              firstBuilderQuote
                ? "This is the deal's first builder quote, so it's the primary option."
                : 'The primary option\'s line items sit on the deal and drive its amount. Leave unticked for an alternative option (e.g. 250 instead of 100 agents); you can switch later under Quotes on this deal.'
            }
            onChange={onPrimary}
          >
            Primary option
          </Checkbox>
          )}
        </Flex>
      </Tile>
    </Flex>
  );
}
