import React from 'react';
import {
  AutoGrid,
  Flex,
  Heading,
  NumberInput,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Text,
  Tile,
} from '@hubspot/ui-extensions';
import { APPROVAL, FAMILIES, MAX_RAMP_MONTHS } from '../lib/config.js';
import { formatMoney } from '../lib/pricing.js';

// Billing schedule across the Agreement Length. Products not on the ramp bill the plan from month 1.
export function scheduleRows(quote) {
  const rows = [];
  const usable = quote.rows.filter((r) => r.usable);
  if (!usable.length) return rows;
  if (quote.anyRamp) {
    const perMonth = usable.reduce((a, r) => a + (r.ramped ? r.rampMrr : r.mainMrr), 0);
    const what = usable
      .map((r) => FAMILIES[r.input.family].label + (r.ramped ? (quote.ramp.mode === 'free' ? ' (free)' : ` (${quote.ramp.percent}% off)`) : ''))
      .join(', ');
    rows.push({ key: 'ramp', ramp: true, period: 'Ramp', months: `1–${quote.ramp.months}`, what, perMonth, total: perMonth * quote.ramp.months });
  }
  const start = quote.anyRamp ? quote.ramp.months + 1 : 1;
  const what = usable.map((r) => FAMILIES[r.input.family].label).join(', ') + ' at quoted price';
  if (quote.m2m) {
    rows.push({ key: 'term', period: 'Month-to-month', months: `${start}+`, what, perMonth: quote.totals.mrr, total: null });
  } else {
    const n = quote.term - start + 1;
    rows.push({ key: 'term', period: 'Plan', months: `${start}–${quote.term}`, what, perMonth: quote.totals.mrr, total: quote.totals.mrr * n });
  }
  return rows;
}

export function RampSection({ quote, ramp, onRamp }) {
  const schedule = scheduleRows(quote);
  const length = quote.m2m ? 'month-to-month' : `${quote.term}-month agreement`;
  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex direction="column" gap="extra-small">
          <Heading>Ramp & schedule</Heading>
          <Text variant="microcopy">
            {`Products with Ramp ticked get RAMP line items for the first months of the ${length}; their plan bills for the rest. Untick Ramp on every product to remove this section. Ramps of ${APPROVAL.rampMonthsThreshold}+ months route for approval.`}
          </Text>
        </Flex>

        <AutoGrid columnWidth={200} gap="medium" flexible>
            <Select
              label="Ramp length"
              name="rampMonths"
              options={Array.from({ length: MAX_RAMP_MONTHS }, (_, i) => ({ label: `${i + 1} month${i ? 's' : ''}`, value: i + 1 }))}
              value={ramp.months}
              onChange={(v) => onRamp({ months: Number(v) })}
            />
            <Select
              label="Ramp pricing"
              name="rampMode"
              options={[
                { label: 'Free (100% off)', value: 'free' },
                { label: 'Percent off', value: 'percent' },
              ]}
              value={ramp.mode}
              onChange={(v) => onRamp({ mode: String(v) })}
            />
            {ramp.mode === 'percent' && (
              <NumberInput label="Ramp discount %" name="rampPercent" min={1} max={99} precision={0} value={ramp.percent} onChange={(v) => onRamp({ percent: v })} />
            )}
          </AutoGrid>

        {schedule.length > 0 && (
          <Table bordered density="condensed">
            <TableHead>
              <TableRow>
                <TableHeader>Period</TableHeader>
                <TableHeader>Months</TableHeader>
                <TableHeader>What bills</TableHeader>
                <TableHeader align="right">Per month</TableHeader>
                <TableHeader align="right">Period total</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {schedule.map((r) => (
                <TableRow key={r.key}>
                  <TableCell>
                    <Tag variant={r.ramp ? 'warning' : 'info'}>{r.period}</Tag>
                  </TableCell>
                  <TableCell>{r.months}</TableCell>
                  <TableCell>{r.what}</TableCell>
                  <TableCell align="right">{formatMoney(r.perMonth)}</TableCell>
                  <TableCell align="right">{r.total == null ? 'per month' : formatMoney(r.total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Flex>
    </Tile>
  );
}
