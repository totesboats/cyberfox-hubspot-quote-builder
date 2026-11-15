import React from 'react';
import { Alert, Button, Divider, Flex, Heading, Link, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { formatMoney, quoteEditability, quoteUrl } from '../lib/pricing.js';

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
export function QuotesPanel({ quotes, portalId, busyId, pendingPrimary, editingId, onEdit, onStartFrom, onMakePrimary, onConfirmPrimary, onCancelPrimary }) {
  if (!quotes || !quotes.length) return null;
  const open = quotes.filter((q) => q.lock === 'open');
  return (
    <Tile>
      <Flex direction="column" gap="small">
        <Flex direction="column" gap="extra-small">
          <Heading>Quotes on this deal</Heading>
          <Text variant="microcopy">The primary option sets the deal amount. Published quotes keep their printed values.</Text>
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

        {/* One block per quote instead of a table, so it reads cleanly on a narrow (split-screen) card. */}
        <Flex direction="column" gap="small">
          {quotes.map((q, idx) => (
            <Flex key={q.id} direction="column" gap="extra-small">
              {idx > 0 && <Divider />}
              <Flex justify="between" align="center" gap="small" wrap>
                <Flex gap="extra-small" align="center" wrap>
                  <Link href={{ url: quoteUrl(portalId, q.id, q.templateType, q.progressionStatus), external: true }}>{q.title || `Quote ${q.id}`}</Link>
                  {q.primary && <Tag variant="success">Primary</Tag>}
                  {q.id === editingId && <Tag variant="info">Editing</Tag>}
                  {!q.builder && <Tag>Not from builder</Tag>}
                </Flex>
                <Text format={{ fontWeight: 'demibold' }}>{q.amount == null ? '—' : formatMoney(q.amount)}</Text>
              </Flex>
              <Flex gap="extra-small" align="center" wrap>
                <Text variant="microcopy">{STATUS_LABEL[q.progressionStatus] || q.progressionStatus}</Text>
                <Tag variant={q.lock === 'open' ? 'warning' : 'default'}>{q.lock === 'open' ? 'Reads current deal values' : 'Values locked'}</Tag>
              </Flex>
              <Flex gap="extra-small" wrap>
                {quoteEditability(q).editable && q.id !== editingId && (
                  <Button size="xs" variant="primary" onClick={() => onEdit(q)}>
                    Edit quote
                  </Button>
                )}
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
              {q.builder && q.state && !quoteEditability(q).editable && <Text variant="microcopy">{quoteEditability(q).reason}</Text>}
            </Flex>
          ))}
        </Flex>
      </Flex>
    </Tile>
  );
}
