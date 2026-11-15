import React from 'react';
import { Flex, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Text } from '@hubspot/ui-extensions';
import { formatInt, formatMoney, lineTypeLabel } from '../lib/pricing.js';

// Shared line-item table, three columns so it fits a narrow (split-screen) card: the line item with its SKU
// underneath, the quantity, and the net with the unit price and discount underneath. `detailed` (the review
// step) adds the term, start month and type (New / Upsell / Co-term) under the line item.
export function LineTable({ lines, detailed = false, billing = 'monthly' }) {
  return (
    <Table bordered density="condensed">
      <TableHead>
        <TableRow>
          <TableHeader>Line item</TableHeader>
          <TableHeader align="right">Qty</TableHeader>
          <TableHeader align="right">Net</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map((l, i) => {
          const facts = detailed
            ? [billing === 'm2m' && !l.ramp ? 'Month-to-month' : `${l.termMonths} mo`, `Month ${l.startMonth}`, lineTypeLabel(l.lineType)].filter(Boolean)
            : [];
          return (
            <TableRow key={`${l.sku}-${l.ramp ? 'r' : 'm'}-${i}`}>
              <TableCell>
                <Flex direction="column" gap="flush">
                  <Text>
                    {l.ramp ? <Tag variant="warning">RAMP</Tag> : null} {l.ramp ? l.name.replace(/^RAMP /, '') : l.name}
                  </Text>
                  <Text variant="microcopy">{l.sku}</Text>
                  {facts.length > 0 && <Text variant="microcopy">{facts.join(' · ')}</Text>}
                </Flex>
              </TableCell>
              <TableCell align="right">{formatInt(l.quantity)}</TableCell>
              <TableCell align="right">
                <Flex direction="column" gap="flush" align="end">
                  <Text>{`${formatMoney(l.net)}${l.annual ? '/yr' : '/mo'}`}</Text>
                  <Text variant="microcopy">{`${formatMoney(l.unitPrice)} each${l.discountPct ? ` · ${l.discountPct}% off` : ''}`}</Text>
                </Flex>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
