import React from 'react';
import { Flex, Statistics, StatisticsItem, StatusTag, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { FAMILIES } from '../lib/config.js';
import { formatMoney } from '../lib/pricing.js';

const money0 = (n) => formatMoney(n, 0);

export function SummaryPanel({ quote, template, dealQuoteCount }) {
  const t = quote.totals;
  const a = quote.approval;
  const usable = quote.rows.filter((r) => r.usable);
  const length = t.contractMonths == null ? 'Month-to-month' : `${t.contractMonths} months${quote.anyRamp ? ` incl. ${new Set(quote.rows.filter((r) => r.ramped).map((r) => r.rampMonths)).size > 1 ? 'up to ' : ''}${quote.ramp.months}-mo ramp` : ''}`;

  const header = (
    <Flex gap="small" align="center" wrap>
      <Text format={{ fontWeight: 'demibold' }}>Live summary</Text>
      {template && <Tag variant={template.templateType === 'CPQ_QUOTE' ? 'info' : 'default'}>{template.templateType === 'CPQ_QUOTE' ? 'CPQ template' : 'Legacy template'}</Tag>}
      <Tag>{dealQuoteCount ? `${dealQuoteCount} quote${dealQuoteCount > 1 ? 's' : ''} on deal` : 'No quotes on deal yet'}</Tag>
    </Flex>
  );

  // Nothing priced yet (e.g. on Setup): one compact line instead of four $0 figures.
  if (usable.length === 0) {
    return (
      <Tile compact>
        <Flex justify="between" align="center" gap="medium" wrap>
          {header}
        </Flex>
      </Tile>
    );
  }

  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex justify="between" align="center" wrap>
          {header}
          <StatusTag variant={a.required ? 'warning' : 'success'}>{a.required ? `Needs approval · ${a.approver}` : 'Auto-approved'}</StatusTag>
        </Flex>
        {a.required && <Text variant="microcopy">{a.reasons.concat(a.manual ? ['Legacy template: request approval manually'] : []).join(' · ')}</Text>}

        <Statistics>
          <StatisticsItem label="MRR (full plan)" number={formatMoney(t.mrr)}>
            <Text variant="microcopy">{`${money0(t.arr)} ARR`}</Text>
          </StatisticsItem>
          <StatisticsItem label="First 12 months" number={money0(t.firstYear)} />
          <StatisticsItem label="Total contract value" number={money0(t.tcv)}>
            <Text variant="microcopy">{length}</Text>
          </StatisticsItem>
          <StatisticsItem label="Savings vs list" number={money0(t.savings)}>
            <Text variant="microcopy">{`Max discount ${t.maxDiscountPct}%`}</Text>
          </StatisticsItem>
        </Statistics>

        {usable.length > 0 && (
          <Flex gap="small" wrap>
            {usable.map((r) => (
              <Tag key={r.input.uid}>{`${r.label} ${formatMoney(r.mainMrr)}/mo`}</Tag>
            ))}
          </Flex>
        )}
      </Flex>
    </Tile>
  );
}
