import React from 'react';
import { Button, Flex, Heading, NumberInput, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { APPROVAL, FAMILIES, MAX_RAMP_MONTHS, MAX_RAMP_STAGES } from '../lib/config.js';
import { formatMoney, stageLabel } from '../lib/pricing.js';
import { Row } from './Layout.jsx';

const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);

// Billing schedule across the Agreement Length: one row per ramp stage, then the plan.
// Products not on the ramp bill the plan from month 1.
export function scheduleRows(quote) {
  const rows = [];
  const usable = quote.rows.filter((r) => r.usable);
  if (!usable.length) return rows;
  if (quote.anyRamp) {
    quote.ramp.stages.forEach((st, si) => {
      const perMonth = usable.reduce((a, r) => a + (r.ramped ? r.stageMrr[si] : r.mainMrr), 0);
      const what = usable.map((r) => FAMILIES[r.input.family].label + (r.ramped ? ` (${stageLabel(st).toLowerCase()})` : '')).join(', ');
      const period = quote.ramp.stages.length > 1 ? `Ramp ${si + 1}` : 'Ramp';
      rows.push({ key: `ramp-${si}`, ramp: true, period, months: range(st.startMonth, st.startMonth + st.months - 1), what, perMonth, total: perMonth * st.months });
    });
  }
  const start = quote.anyRamp ? quote.ramp.months + 1 : 1;
  const what = usable.map((r) => FAMILIES[r.input.family].label).join(', ') + ' at quoted price';
  if (quote.m2m) {
    rows.push({ key: 'term', period: 'Month-to-month', months: `${start}+`, what, perMonth: quote.totals.mrr, total: null });
  } else {
    const n = quote.term - start + 1;
    rows.push({ key: 'term', period: 'Plan', months: range(start, quote.term), what, perMonth: quote.totals.mrr, total: quote.totals.mrr * n });
  }
  return rows;
}

export function RampSection({ quote, ramp, onStage, onAddStage, onRemoveStage, onClear }) {
  const schedule = scheduleRows(quote);
  const length = quote.m2m ? 'month-to-month' : `${quote.term}-month agreement`;
  const stages = ramp.stages || [];
  const total = quote.ramp.months;
  const left = MAX_RAMP_MONTHS - total;
  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex justify="between" align="start" gap="medium">
          <Flex direction="column" gap="extra-small">
            <Heading>Ramp & schedule</Heading>
            <Text variant="microcopy">
              {`Products with Ramp ticked get RAMP line items for the first months of the ${length}; their plan bills for the rest. Add stages to step the discount down (e.g. 2 months free, then 2 months at 50% off). Ramps of ${APPROVAL.rampMonthsThreshold}+ months in total route for approval.`}
            </Text>
          </Flex>
          <Button variant="secondary" size="sm" onClick={onClear}>
            Remove ramp
          </Button>
        </Flex>

        {stages.map((st, i) => (
          <Row key={i} weights={[1, 1, 1, 0.6]}>
            <Select
              label={stages.length > 1 ? `Stage ${i + 1} length` : 'Ramp length'}
              name={`rampMonths-${i + 1}`}
              options={Array.from({ length: MAX_RAMP_MONTHS }, (_, m) => ({ label: `${m + 1} month${m ? 's' : ''}`, value: m + 1 }))}
              value={Number(st.months) || 1}
              onChange={(v) => onStage(i, { months: Number(v) })}
            />
            <Select
              label={stages.length > 1 ? `Stage ${i + 1} pricing` : 'Ramp pricing'}
              name={`rampMode-${i + 1}`}
              options={[
                { label: 'Free (100% off)', value: 'free' },
                { label: 'Percent off', value: 'percent' },
              ]}
              value={st.mode === 'percent' ? 'percent' : 'free'}
              onChange={(v) => onStage(i, { mode: String(v) })}
            />
            <NumberInput
              label="Discount %"
              name={`rampPercent-${i + 1}`}
              min={1}
              max={99}
              precision={0}
              readOnly={st.mode !== 'percent'}
              value={st.mode === 'percent' ? Number(st.percent) || 50 : 100}
              onChange={(v) => onStage(i, { percent: v })}
            />
            <Button variant="secondary" size="sm" disabled={stages.length < 2} onClick={() => onRemoveStage(i)}>
              Remove stage
            </Button>
          </Row>
        ))}

        <Flex justify="between" align="center" gap="medium">
          <Text variant="microcopy">
            {`Ramp: ${total} month${total === 1 ? '' : 's'} in total${quote.ramp.stages.length > 1 ? ` (${quote.ramp.stages.map((s) => `${s.months} mo ${stageLabel(s).toLowerCase()}`).join(', then ')})` : ''}${left > 0 ? `; up to ${left} more available` : ''}.`}
          </Text>
          <Button variant="secondary" size="sm" disabled={stages.length >= MAX_RAMP_STAGES || left < 1} onClick={onAddStage}>
            + Add ramp stage
          </Button>
        </Flex>

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
