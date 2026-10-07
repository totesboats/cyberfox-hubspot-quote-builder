import React from 'react';
import { Button, DescriptionList, DescriptionListItem, Flex, Text, Tile } from '@hubspot/ui-extensions';

// The quote-token fields chosen on Setup, read-only, so reps can see them while building
// products and ramps. Values come from the same validated deal writes the quote will use.
const FIELDS = [
  ['agreement_length', 'Agreement Length'],
  ['payment_terms', 'Payment Frequency'],
  ['payment_method', 'Payment Method'],
  ['invoice_terms', 'Invoice Terms'],
  ['promo', 'Promo'],
];

export function PrintedReference({ writes, dealOptions, ramp, quote, onEdit }) {
  const props = (writes && writes.properties) || {};
  const label = (name, value) => {
    if (value === '' || value == null) return name === 'promo' ? 'None' : 'Not set';
    const o = ((dealOptions && dealOptions[name]) || []).find((x) => x.value === value);
    return o ? o.label : value;
  };
  const planStart = ramp && ramp.enabled && quote.anyRamp ? quote.ramp.months + 1 : 1;
  const split = quote.m2m ? 'Month-to-month: plans renew monthly.' : quote.anyRamp ? `Ramp months 1–${quote.ramp.months}, plan months ${planStart}–${quote.term}.` : `Plan runs months 1–${quote.term}.`;
  return (
    <Tile compact>
      <Flex direction="column" gap="small">
        <Flex justify="between" align="center" gap="medium">
          <Flex direction="column" gap="extra-small">
            <Text format={{ fontWeight: 'demibold' }}>Prints on the quote</Text>
            <Text variant="microcopy">{`Set on the Setup step. ${split}`}</Text>
          </Flex>
          <Button variant="secondary" size="sm" onClick={onEdit}>
            Change on Setup
          </Button>
        </Flex>
        <DescriptionList direction="row">
          {FIELDS.map(([name, title]) => (
            <DescriptionListItem key={name} label={title}>
              {label(name, props[name])}
            </DescriptionListItem>
          ))}
        </DescriptionList>
      </Flex>
    </Tile>
  );
}
