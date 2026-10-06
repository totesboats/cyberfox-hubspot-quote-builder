import React from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Text } from '@hubspot/ui-extensions';
import { formatInt, formatMoney } from '../lib/pricing.js';

// Shared line-item table. `detailed` adds Term and Starts columns for the review step.
export function LineTable({ lines, detailed = false, billing = 'monthly' }) {
  return (
    <Table bordered density="condensed">
      <TableHead>
        <TableRow>
          <TableHeader>Line item</TableHeader>
          <TableHeader>SKU</TableHeader>
          <TableHeader align="right">Qty</TableHeader>
          <TableHeader align="right">Unit</TableHeader>
          <TableHeader align="right">Disc.</TableHeader>
          {detailed && <TableHeader>Term</TableHeader>}
          {detailed && <TableHeader>Starts</TableHeader>}
          <TableHeader align="right">Net</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {lines.map((l, i) => (
          <TableRow key={`${l.sku}-${l.ramp ? 'r' : 'm'}-${i}`}>
            <TableCell>
              {l.ramp ? <Tag variant="warning">RAMP</Tag> : null} {l.ramp ? l.name.replace(/^RAMP /, '') : l.name}
            </TableCell>
            <TableCell>
              <Text variant="microcopy">{l.sku}</Text>
            </TableCell>
            <TableCell align="right">{formatInt(l.quantity)}</TableCell>
            <TableCell align="right">{formatMoney(l.unitPrice)}</TableCell>
            <TableCell align="right">{l.discountPct ? `${l.discountPct}%` : '—'}</TableCell>
            {detailed && <TableCell>{billing === 'm2m' && !l.ramp ? 'Month-to-month' : `${l.termMonths} mo`}</TableCell>}
            {detailed && <TableCell>Month {l.startMonth}</TableCell>}
            <TableCell align="right">
              {formatMoney(l.net)}
              {l.annual ? '/yr' : '/mo'}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
