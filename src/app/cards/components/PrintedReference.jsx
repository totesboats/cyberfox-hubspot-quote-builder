import React from 'react';
import { Button, DescriptionList, DescriptionListItem, Flex, Tile } from '@hubspot/ui-extensions';

// The quote-token fields chosen on Setup, read-only, so reps can see them while building
// products and ramps. Values come from the same validated deal writes the quote will use.
const FIELDS = [
  ['agreement_length', 'Agreement Length'],
  ['payment_terms', 'Payment Frequency'],
  ['payment_method', 'Payment Method'],
  ['invoice_terms', 'Invoice Terms'],
];

export function PrintedReference({ writes, dealOptions, ramp, quote, onEdit }) {
  const props = (writes && writes.properties) || {};
  const label = (name, value) => {
    if (value === '' || value == null) return 'Not set';
    const o = ((dealOptions && dealOptions[name]) || []).find((x) => x.value === value);
    return o ? o.label : value;
  };
  return (
    <Tile compact>
      <Flex justify="between" align="center" gap="medium">
        <DescriptionList direction="row">
          {FIELDS.map(([name, title]) => (
            <DescriptionListItem key={name} label={title}>
              {label(name, props[name])}
            </DescriptionListItem>
          ))}
        </DescriptionList>
        <Button variant="transparent" size="sm" onClick={onEdit}>
          Change
        </Button>
      </Flex>
    </Tile>
  );
}
