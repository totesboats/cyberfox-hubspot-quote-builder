import React from 'react';
import { Alert, Button, Checkbox, DescriptionList, DescriptionListItem, Flex, Heading, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { autoQuoteName } from '../lib/pricing.js';
import { LineTable } from './LineTable.jsx';

// Deal properties shown with their HubSpot labels, in the order the templates use them.
const TOKEN_ROWS = [
  ['agreement_length', 'Agreement Length'],
  ['payment_terms', 'Payment Frequency'],
  ['payment_method', 'Payment Method'],
  ['invoice_terms', 'Invoice Terms'],
  ['sku_type', 'AE Feature Type'],
  ['ae_feature_type_details', 'AE Feature Type Details'],
  ['timus_price_per_user', 'Timus Price Per User'],
  ['timus_price_per_gateway', 'Timus Price Per Gateway'],
  ['new_minimum_commitment_amount', 'Timus New Minimum Commitment Amount'],
];

export function ReviewStep({ quote, setup, template, deal, products, primary, editing, firstBuilderQuote, onPrimary, affectedQuotes = [], onAnotherOption, onReloadPage, result, writes, dealOptions }) {
  const labelFor = (name, value) => {
    const o = ((dealOptions && dealOptions[name]) || []).find((x) => x.value === value);
    return o && o.label !== value ? `${o.label} (${value})` : value;
  };
  const tokenRows = TOKEN_ROWS.filter(([name]) => writes && name in writes.properties).map(([name, label]) => {
    const v = writes.properties[name];
    const shown = labelFor(name, v);
    return { name, label, value: shown === '' ? 'Cleared' : shown };
  });
  const title = (setup.quoteName || '').trim() || autoQuoteName(deal.company && deal.company.name, products, quote.anyRamp ? quote.ramp.months : 0, { oneOffs: quote.oneOffs });
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
                  : `It needs approval: open it from the deal's Quotes card and click Request approval. It routes to ${result.approval.approver}.`
                : "No approval needed. Open it from the deal's Quotes card to review, publish and send."}
            </Text>
            <Text format={{ fontWeight: 'demibold' }}>{result.edited ? 'Refresh the page to see the changes in the Quotes card.' : 'Refresh the page and the quote will appear in the Quotes card.'}</Text>
            {result.edited && quote.approval.required && <Text variant="microcopy">If it was approved or had changes requested, request approval again in HubSpot.</Text>}
            {result.approval.required && !result.approval.manual && (
              <Text variant="microcopy">If Request approval keeps showing "Saving…", rename the quote (any small change), save, then request approval again. It's a known HubSpot issue.</Text>
            )}
            <Text variant="microcopy">Publish it before building another option, so it keeps these printed values.</Text>
            <Flex gap="small" align="center" wrap>
              {onReloadPage && (
                <Button variant="primary" onClick={onReloadPage}>
                  Refresh page
                </Button>
              )}
              <Button variant="secondary" onClick={onAnotherOption}>
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
          <Heading>Quote summary</Heading>
          <DescriptionList direction="row">
            <DescriptionListItem label="Quote name">{title}</DescriptionListItem>
            <DescriptionListItem label="Template">{template ? template.name : 'Not chosen'}</DescriptionListItem>
            <DescriptionListItem label="Expires">{setup.expirationDate}</DescriptionListItem>
            <DescriptionListItem label="Signer">{signer ? signer.label : 'None'}</DescriptionListItem>
            <DescriptionListItem label="Line items">{rampCount ? `${quote.lines.length} (${rampCount} ramp)` : String(quote.lines.length)}</DescriptionListItem>
          </DescriptionList>
          <Text variant="microcopy">{editing ? 'Update quote saves these changes to the existing draft.' : 'Create quote makes a draft you can review in HubSpot before sending.'}</Text>
          {editing ? (
            <Text variant="microcopy">{editing.primary ? 'This quote is the primary option and stays primary.' : 'This quote is an alternative option; use Make primary under Quotes on this deal to switch.'}</Text>
          ) : (
          <Checkbox
            name="primary"
            checked={primary}
            readOnly={firstBuilderQuote}
            description={
              firstBuilderQuote
                ? "This is the deal's first quote, so it's the primary option."
                : 'The primary option sets the deal amount. Leave unticked for an alternative (e.g. 250 instead of 100 agents); you can switch later.'
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
