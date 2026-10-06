import React from 'react';
import { Alert, Button, Flex, Heading, Link, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { formatMoney } from '../lib/pricing.js';

const STATUS_LABEL = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  CHANGES_REQUESTED: 'Changes requested',
  PUBLISHED: 'Published',
  PENDING_SIGNATURE: 'Pending signature',
  PENDING_ACCEPTANCE: 'Pending acceptance',
  SENT: 'Sent',
  SENT_PENDING_SIGNATURE: 'Sent · pending signature',
  VIEWED: 'Viewed',
  VIEWED_PENDING_SIGNATURE: 'Viewed · pending signature',
  NEEDS_COUNTERSIGN: 'Pending countersignature',
  ACCEPTED: 'Accepted',
};

// Quotes already on the deal. Reps start a new option from one (e.g. 100 → 250 agents) or
// switch which option is primary (whose line items sit on the deal).
export function QuotesPanel({ quotes, portalId, busyId, pendingPrimary, onStartFrom, onMakePrimary, onConfirmPrimary, onCancelPrimary }) {
  if (!quotes || !quotes.length) return null;
  const open = quotes.filter((q) => q.lock === 'open');
  return (
    <Tile>
      <Flex direction="column" gap="small">
        <Flex direction="column" gap="extra-small">
          <Heading>Quotes on this deal</Heading>
          <Text variant="microcopy">
            Each quote is one option. The primary option's line items are on the deal, so they drive the deal amount. Published quotes keep the printed fields they had when
            published; drafts and quotes awaiting approval show the deal's current values.
          </Text>
        </Flex>

        {pendingPrimary && (
          <Alert title="Unpublished quotes will change" variant="warning">
            <Flex direction="column" gap="small">
              <Text>
                {`Making this primary writes its Agreement Length, Payment Frequency and other printed fields to the deal. These unpublished quotes would show the new values: ${open
                  .filter((q) => q.id !== pendingPrimary)
                  .map((q) => q.title)
                  .join(', ')}.`}
              </Text>
              <Flex gap="small">
                <Button size="sm" variant="primary" onClick={onConfirmPrimary}>
                  Make primary anyway
                </Button>
                <Button size="sm" variant="secondary" onClick={onCancelPrimary}>
                  Cancel
                </Button>
              </Flex>
            </Flex>
          </Alert>
        )}

        <Table bordered density="condensed">
          <TableHead>
            <TableRow>
              <TableHeader>Quote</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader align="right">Amount</TableHeader>
              <TableHeader>Actions</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {quotes.map((q) => (
              <TableRow key={q.id}>
                <TableCell>
                  <Flex direction="column" gap="extra-small">
                    <Link href={{ url: `https://app.hubspot.com/quotes/${portalId}/details/${q.id}`, external: true }}>{q.title || `Quote ${q.id}`}</Link>
                    <Flex gap="extra-small" wrap>
                      {q.primary && <Tag variant="success">Primary</Tag>}
                      {!q.builder && <Tag>Not from builder</Tag>}
                    </Flex>
                  </Flex>
                </TableCell>
                <TableCell>
                  <Flex direction="column" gap="extra-small">
                    <Text>{STATUS_LABEL[q.progressionStatus] || q.progressionStatus}</Text>
                    <Tag variant={q.lock === 'open' ? 'warning' : 'default'}>{q.lock === 'open' ? 'Reads current deal values' : 'Values locked'}</Tag>
                  </Flex>
                </TableCell>
                <TableCell align="right">{q.amount == null ? '—' : formatMoney(q.amount)}</TableCell>
                <TableCell>
                  <Flex gap="extra-small" wrap>
                    {q.state && (
                      <Button size="xs" variant="secondary" onClick={() => onStartFrom(q)}>
                        New option from this
                      </Button>
                    )}
                    {q.builder && q.state && !q.primary && (
                      <Button size="xs" variant="secondary" disabled={!!busyId} onClick={() => onMakePrimary(q)}>
                        {busyId === q.id ? 'Updating…' : 'Make primary'}
                      </Button>
                    )}
                  </Flex>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Flex>
    </Tile>
  );
}
