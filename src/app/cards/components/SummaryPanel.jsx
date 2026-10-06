import React from 'react';
import { Alert, Flex, Statistics, StatisticsItem, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { FAMILIES } from '../lib/config.js';
import { formatMoney } from '../lib/pricing.js';

const money0 = (n) => formatMoney(n, 0);

export function SummaryPanel({ quote, template, dealQuoteCount }) {
  const t = quote.totals;
  const a = quote.approval;
  const usable = quote.rows.filter((r) => r.usable);
  const length = t.contractMonths == null ? 'Month-to-month' : `${t.contractMonths} months${quote.anyRamp ? ` incl. ${quote.ramp.months}-mo ramp` : ''}`;

  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex justify="between" align="center" wrap>
          <Flex gap="small" align="center" wrap>
            <Text format={{ fontWeight: 'demibold' }}>Live summary</Text>
            {template && <Tag variant={template.templateType === 'CPQ_QUOTE' ? 'info' : 'default'}>{template.templateType === 'CPQ_QUOTE' ? 'CPQ template' : 'Legacy template'}</Tag>}
            <Tag>{dealQuoteCount ? `${dealQuoteCount} quote${dealQuoteCount > 1 ? 's' : ''} on deal` : 'No quotes on deal yet'}</Tag>
          </Flex>
          <Tag variant={a.required ? 'warning' : 'success'}>{a.required ? 'Needs approval' : 'Auto-approves'}</Tag>
        </Flex>

        <Statistics>
          <StatisticsItem label="MRR (full plan)" number={formatMoney(t.mrr)}>
            <Text variant="microcopy">{`${money0(t.arr)} ARR`}</Text>
          </StatisticsItem>
          <StatisticsItem label="First 12 months" number={money0(t.firstYear)}>
            <Text variant="microcopy">After ramp and discounts</Text>
          </StatisticsItem>
          <StatisticsItem label="Total contract value" number={money0(t.tcv)}>
            <Text variant="microcopy">{length}</Text>
          </StatisticsItem>
          <StatisticsItem label="Savings vs list" number={money0(t.savings)}>
            <Text variant="microcopy">{`Max discount ${t.maxDiscountPct}%`}</Text>
          </StatisticsItem>
        </Statistics>

        {a.required && (
          <Alert title={`Approval: ${a.approver}`} variant="warning">
            {a.reasons.join(' · ')}
            {a.manual ? ' · Legacy template: Commerce Hub approvals will not run, so request approval manually.' : ''}
          </Alert>
        )}

        {usable.length > 0 && (
          <Flex gap="small" wrap>
            {usable.map((r) => (
              <Tag key={r.input.uid}>{`${FAMILIES[r.input.family].label} ${formatMoney(r.mainMrr)}/mo`}</Tag>
            ))}
          </Flex>
        )}
      </Flex>
    </Tile>
  );
}
