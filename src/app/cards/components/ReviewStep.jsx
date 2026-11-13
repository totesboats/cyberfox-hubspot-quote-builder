import React from 'react';
import { Alert, Button, Checkbox, DescriptionList, DescriptionListItem, Flex, Heading, Input, StatusTag, Tag, Text, Tile } from '@hubspot/ui-extensions';
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

export function ReviewStep({ quote, setup, template, deal, products, primary, editing, firstBuilderQuote, onPrimary, onQuoteName, seller, affectedQuotes = [], onAnotherOption, onReloadPage, result, writes, dealOptions }) {
  const labelFor = (name, value) => {
    const o = ((dealOptions && dealOptions[name]) || []).find((x) => x.value === value);
    return o && o.label !== value ? `${o.label} (${value})` : value;
  };
  const tokenRows = TOKEN_ROWS.filter(([name]) => writes && name in writes.properties).map(([name, label]) => {
    const v = writes.properties[name];
    const shown = labelFor(name, v);
    return { name, label, value: shown === '' ? 'Cleared' : shown };
  });
  const autoTitle = autoQuoteName(deal.company && deal.company.name, products, quote.anyRamp ? quote.ramp.months : 0, { oneOffs: quote.oneOffs });
  const rampCount = quote.lines.filter((l) => l.ramp).length;
  const signer = deal.contacts.find((c) => c.id === setup.signerContactId);

  return (
    <Flex direction="column" gap="medium">
      {result && result.ok && (
        <Alert title={result.edited ? 'Quote updated' : 'Draft quote created'} variant="success">
          <Flex direction="column" gap="extra-small">
            <Text>
              {`${result.title} · ${result.lineCount} line items${result.primary ? ' · primary option' : ''}. `}
              {result.approval.required
                ? result.approval.manual
                  ? `Needs approval from ${result.approval.approver}: request it manually (legacy template).`
                  : `Needs approval: open it from the Quotes card and click Request approval (routes to ${result.approval.approver}).`
                : 'No approval needed: open it from the Quotes card to publish and send.'}
            </Text>
            <Text format={{ fontWeight: 'demibold' }}>Refresh the page to see it in the Quotes card.</Text>
            {result.edited && quote.approval.required && <Text variant="microcopy">If it was already approved or had changes requested, request approval again.</Text>}
            {result.approval.required && !result.approval.manual && (
              <Text variant="microcopy">If Request approval sticks on "Saving…", rename the quote, save, and try again (known HubSpot issue).</Text>
            )}
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
            <Text variant="microcopy">Publish this quote before building another option.</Text>
          </Flex>
        </Alert>
      )}
      {affectedQuotes.length > 0 && !(result && result.ok) && (
        <Alert title="Unpublished quotes will pick up these values" variant="warning">
          {`${affectedQuotes.map((q) => q.title).join(', ')}. Publish them first to keep their current values.`}
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
            <Heading>Line items</Heading>
            <Flex gap="small" align="center">
              <Tag>{rampCount ? `${quote.lines.length} lines · ${rampCount} ramp` : `${quote.lines.length} lines`}</Tag>
              <StatusTag variant={quote.approval.required ? 'warning' : 'success'}>{quote.approval.required ? `Needs approval · ${quote.approval.approver}` : 'Auto-approved'}</StatusTag>
            </Flex>
          </Flex>
          <LineTable lines={quote.lines} detailed billing={setup.billing} />
        </Flex>
      </Tile>

      <Tile>
        <Flex direction="column" gap="small">
          <Heading>Prints on the quote</Heading>
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
          <Heading>Quote</Heading>
          <Input label="Quote name" name="quoteName" placeholder={autoTitle} value={setup.quoteName} onChange={(v) => onQuoteName && onQuoteName(v)} />
          <DescriptionList direction="row">
            <DescriptionListItem label="Template">{template ? template.name : 'Not chosen'}</DescriptionListItem>
            <DescriptionListItem label="Expires">{setup.expirationDate}</DescriptionListItem>
            <DescriptionListItem label="Signer">{signer ? signer.label : 'None'}</DescriptionListItem>
            <DescriptionListItem label="Seller">{seller || 'You'}</DescriptionListItem>
          </DescriptionList>
          {editing ? (
            <Text variant="microcopy">{editing.primary ? 'Primary option.' : 'Alternative option: use Make primary under Quotes on this deal to switch.'}</Text>
          ) : (
          <Checkbox
            name="primary"
            checked={primary}
            readOnly={firstBuilderQuote}
            description={firstBuilderQuote ? "The deal's first quote is always primary." : 'Sets the deal amount. Untick for an alternative option.'}
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
