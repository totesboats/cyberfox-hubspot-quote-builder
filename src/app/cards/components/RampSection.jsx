import React from 'react';
import { Button, Flex, Heading, NumberInput, Select, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { APPROVAL, FAMILIES, MAX_RAMP_MONTHS, MAX_RAMP_STAGES } from '../lib/config.js';
import { formatMoney, stageLabel } from '../lib/pricing.js';
import { Row } from './Layout.jsx';

const range = (a, b) => (a === b ? `${a}` : `${a}–${b}`);

// Billing schedule across the Agreement Length. Each product ramps on its own schedule, so the ramp
// months are split wherever any product's stage or ramp ends; then the plan, when every product bills
// at its quoted price. Products not on a ramp bill the plan from month 1.
export function scheduleRows(quote) {
  const rows = [];
  const usable = quote.rows.filter((r) => r.usable);
  if (!usable.length) return rows;
  const longest = quote.ramp.months;
  if (quote.anyRamp && longest > 0) {
    const cuts = new Set([1, longest + 1]);
    for (const r of usable) {
      if (!r.ramped) continue;
      for (const st of r.ramp.stages) cuts.add(st.startMonth);
      cuts.add(r.rampMonths + 1);
    }
    const sorted = [...cuts].filter((m) => m >= 1 && m <= longest + 1).sort((a, b) => a - b);
    const segments = sorted.slice(0, -1).map((a, i) => [a, sorted[i + 1] - 1]);
    // Which stage (if any) a product is in during a month.
    const stageAt = (r, month) => (r.ramped && month <= r.rampMonths ? r.ramp.stages.findIndex((st) => month >= st.startMonth && month < st.startMonth + st.months) : -1);
    segments.forEach(([a, b], n) => {
      let perMonth = 0;
      const what = [];
      for (const r of usable) {
        const si = stageAt(r, a);
        perMonth += si >= 0 ? r.stageMrr[si] : r.mainMrr;
        what.push(FAMILIES[r.input.family].label + (si >= 0 ? ` (${stageLabel(r.ramp.stages[si]).toLowerCase()})` : ''));
      }
      const period = segments.length > 1 ? `Ramp ${n + 1}` : 'Ramp';
      rows.push({ key: `ramp-${n}`, ramp: true, period, months: range(a, b), what: what.join(', '), perMonth, total: perMonth * (b - a + 1) });
    });
  }
  const start = quote.anyRamp ? longest + 1 : 1;
  const what = usable.map((r) => FAMILIES[r.input.family].label).join(', ') + ' at quoted price';
  if (quote.m2m) {
    rows.push({ key: 'term', period: 'Month-to-month', months: `${start}+`, what, perMonth: quote.totals.mrr, total: null });
  } else if (start <= quote.term) {
    const n = quote.term - start + 1;
    rows.push({ key: 'term', period: 'Plan', months: range(start, quote.term), what, perMonth: quote.totals.mrr, total: quote.totals.mrr * n });
  }
  return rows;
}

// One product's ramp: its stages (length, pricing, discount), shown inside the product's tile.
// Optimize365 is locked to its only allowed shape (1–2 free months, one stage).
export function ProductRamp({ row, quote, onStage, onAddStage, onRemoveStage }) {
  const uid = row.input.uid;
  const stages = row.input.rampStages && row.input.rampStages.length ? row.input.rampStages : row.ramp.stages;
  const total = row.ramp.months;
  const left = MAX_RAMP_MONTHS - total;
  const locked = row.input.family === 'optimize365' && quote.optimizeRamp && quote.optimizeRamp.allowed;
  const planText = quote.m2m ? 'then month-to-month' : total < quote.term ? `plan bills months ${total + 1}–${quote.term}` : 'no plan months left';
  return (
    <Flex direction="column" gap="small">
      {locked && (
        <Text variant="microcopy" format={{ fontWeight: 'demibold' }}>
          {`Optimize365's ramp is fixed at ${quote.optimizeRamp.months} free month${quote.optimizeRamp.months > 1 ? 's' : ''} (one stage, 100% off).`}
        </Text>
      )}
      {stages.map((st, i) => (
        <Row key={i} weights={[1, 1, 1, 0.6]}>
          <Select
            label={stages.length > 1 ? `Stage ${i + 1} length` : 'Ramp length'}
            name={`rampMonths-${uid}-${i + 1}`}
            options={Array.from({ length: MAX_RAMP_MONTHS }, (_, m) => ({ label: `${m + 1} month${m ? 's' : ''}`, value: m + 1 }))}
            value={Number(st.months) || 1}
            readOnly={locked}
            onChange={(v) => onStage(uid, i, { months: Number(v) })}
          />
          <Select
            label={stages.length > 1 ? `Stage ${i + 1} pricing` : 'Ramp pricing'}
            name={`rampMode-${uid}-${i + 1}`}
            options={[
              { label: 'Free (100% off)', value: 'free' },
              { label: 'Percent off', value: 'percent' },
            ]}
            value={st.mode === 'percent' ? 'percent' : 'free'}
            readOnly={locked}
            onChange={(v) => onStage(uid, i, { mode: String(v) })}
          />
          <NumberInput
            label="Discount %"
            name={`rampPercent-${uid}-${i + 1}`}
            min={1}
            max={99}
            precision={0}
            readOnly={st.mode !== 'percent'}
            value={st.mode === 'percent' ? Number(st.percent) || 50 : 100}
            onChange={(v) => onStage(uid, i, { percent: v })}
          />
          <Button variant="secondary" size="sm" disabled={stages.length < 2} onClick={() => onRemoveStage(uid, i)}>
            Remove stage
          </Button>
        </Row>
      ))}
      <Flex justify="between" align="center" gap="medium">
        <Text variant="microcopy">
          {`Ramp: ${total} month${total === 1 ? '' : 's'}${row.ramp.stages.length > 1 ? ` (${row.ramp.stages.map((s) => `${s.months} mo ${stageLabel(s).toLowerCase()}`).join(', then ')})` : ''}; ${planText}.`}
        </Text>
        <Button variant="secondary" size="sm" disabled={locked || stages.length >= MAX_RAMP_STAGES || left < 1} onClick={() => onAddStage(uid)}>
          + Add ramp stage
        </Button>
      </Flex>
    </Flex>
  );
}

// Below the products: the combined billing schedule for every product's ramp.
export function RampSection({ quote, onClear }) {
  const schedule = scheduleRows(quote);
  const length = quote.m2m ? 'month-to-month' : `${quote.term}-month agreement`;
  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex justify="between" align="start" gap="medium">
          <Flex direction="column" gap="extra-small">
            <Heading>Ramp & schedule</Heading>
            <Text variant="microcopy">
              {`Each product with Ramp ticked has its own ramp (set it in the product above): RAMP line items for its first months of the ${length}, then its plan for the rest. Ramps of ${APPROVAL.rampMonthsThreshold}+ months in total route for approval.`}
            </Text>
          </Flex>
          <Button variant="secondary" size="sm" onClick={onClear}>
            Remove all ramps
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
