import React from 'react';
import { Alert, AutoGrid, Button, Checkbox, Flex, Heading, NumberInput, Select, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { AE_FEATURE_TYPES, BILLING, FAMILIES, FAMILY_ORDER, SEGMENTS } from '../lib/config.js';
import { formatMoney } from '../lib/pricing.js';
import { LineTable } from './LineTable.jsx';
import { RampSection } from './RampSection.jsx';

function StandardFields({ input, priced, family, onUpdate }) {
  const per = priced.annual ? '/yr' : '/mo';
  const tierOptions = priced.tierOptions.length
    ? [{ label: `Best price${priced.bestTier ? ` — ${priced.bestTier.toLocaleString('en-US')} tier` : ''}`, value: '' }].concat(priced.tierOptions.map((o) => ({ label: o.label, value: o.value })))
    : [{ label: 'No tiers for this combination', value: '' }];
  return (
    <AutoGrid columnWidth={170} gap="medium" flexible>
      {input.family === 'autoelevate' ? (
        <Select
          label="AE Feature Type"
          name={`feature-${input.uid}`}
          description={`Priced on ${(AE_FEATURE_TYPES.find((f) => f.value === input.featureType) || AE_FEATURE_TYPES[0]).edition} SKUs; sets the quote's feature wording`}
          options={AE_FEATURE_TYPES.map((f) => ({ label: f.value, value: f.value }))}
          value={input.featureType || 'Standard'}
          onChange={(v) => onUpdate({ featureType: String(v), tier: '' })}
        />
      ) : family.editions.length > 1 && (
        <Select
          label="Edition"
          name={`edition-${input.uid}`}
          options={family.editions}
          value={input.edition}
          onChange={(v) => onUpdate({ edition: String(v), tier: '' })}
        />
      )}
      <NumberInput label={`Total ${family.unit}`} name={`qty-${input.uid}`} min={0} precision={0} value={Number(input.quantity) || 0} onChange={(v) => onUpdate({ quantity: v })} />
      <Select
        label="Commit tier"
        name={`tier-${input.uid}`}
        description={`List price ${per}`}
        options={tierOptions}
        value={input.tier === '' || input.tier == null ? '' : String(input.tier)}
        onChange={(v) => onUpdate({ tier: v === '' ? '' : Number(v) })}
      />
      <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
    </AutoGrid>
  );
}

function TimusFields({ input, priced, timusLists, onUpdate }) {
  const list = priced.timus && priced.timus.list;
  const needsRate = list && list.advancedUserRate == null;
  return (
    <AutoGrid columnWidth={170} gap="medium" flexible>
      <Select
        label="Timus price list"
        name={`pl-${input.uid}`}
        placeholder={timusLists.length ? 'Choose a price list' : 'No price lists in HubDB'}
        options={timusLists.map((l) => ({ label: l.label, value: l.value }))}
        value={input.priceListValue}
        onChange={(v) => onUpdate({ priceListValue: String(v) })}
      />
      <Select
        label="Agreement"
        name={`ag-${input.uid}`}
        options={[
          { label: 'Standard', value: 'standard' },
          { label: 'Satisfaction guarantee (SATGAT)', value: 'satgat' },
        ]}
        value={input.agreement || 'standard'}
        onChange={(v) => onUpdate({ agreement: String(v) })}
      />
      <NumberInput label="Users" name={`users-${input.uid}`} min={0} precision={0} value={Number(input.quantity) || 0} onChange={(v) => onUpdate({ quantity: v })} />
      <NumberInput label="Gateways" name={`gw-${input.uid}`} min={0} precision={0} value={Number(input.gateways) || 0} onChange={(v) => onUpdate({ gateways: v })} />
      {needsRate ? (
        <NumberInput
          label="Advanced user rate"
          name={`rate-${input.uid}`}
          description="Not set on this price list; enter the agreed rate."
          min={0}
          precision={2}
          value={Number(input.userRateOverride) || 0}
          onChange={(v) => onUpdate({ userRateOverride: v })}
        />
      ) : (
        <NumberInput label="Advanced user rate" name={`rate-${input.uid}`} readOnly precision={2} value={list ? list.advancedUserRate : 0} description="From the price list" />
      )}
      <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
    </AutoGrid>
  );
}

function ProductTile({ row, timusLists, onUpdate, onRemove }) {
  const { input, priced } = row;
  const family = FAMILIES[input.family];
  const edition =
    input.family === 'autoelevate'
      ? { label: input.featureType || 'Standard' }
      : family.editions.find((e) => e.value === input.edition) || family.editions[0];
  const mrr = row.mainLines.length ? `${formatMoney(row.mainMrr)}/mo` : '—';
  const update = (patch) => onUpdate(input.uid, patch);
  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex justify="between" align="center" wrap>
          <Flex gap="small" align="center" wrap>
            <Heading>{family.label}</Heading>
            <Tag>{edition.label}</Tag>
            {row.ramped && <Tag variant="warning">{row.rampLines[0] ? `${row.rampLines[0].termMonths}-mo ramp` : 'Ramp'}</Tag>}
          </Flex>
          <Flex gap="small" align="center">
            <Text format={{ fontWeight: 'demibold' }}>{mrr}</Text>
            <Button variant="transparent" size="sm" onClick={() => onRemove(input.uid)}>
              Remove
            </Button>
          </Flex>
        </Flex>

        {input.family === 'timus' ? (
          <TimusFields input={input} priced={priced} timusLists={timusLists} onUpdate={update} />
        ) : (
          <StandardFields input={input} priced={priced} family={family} onUpdate={update} />
        )}

        {priced.error ? (
          <Alert title="Can't price this product" variant="warning">
            {priced.error}
          </Alert>
        ) : priced.hint ? (
          <Alert title={priced.hintLevel === 'warning' ? 'Check this' : 'Pricing'} variant={priced.hintLevel === 'warning' ? 'warning' : 'info'}>
            {priced.hint}
          </Alert>
        ) : null}

        <Checkbox
          name={`ramp-${input.uid}`}
          checked={!!input.ramp}
          description="Adds RAMP line items for the first months; set the length and pricing under Ramp & schedule."
          onChange={(checked) => update({ ramp: checked })}
        >
          Ramp
        </Checkbox>

        {row.mainLines.length > 0 && <LineTable lines={row.rampLines.concat(row.mainLines)} />}
      </Flex>
    </Tile>
  );
}

export function ProductsStep({ quote, setup, ramp, timusLists, onAdd, onUpdate, onRemove, onRamp }) {
  const segment = (SEGMENTS.find((s) => s.value === setup.segment) || SEGMENTS[0]).label;
  return (
    <Flex direction="column" gap="medium">
      <Flex direction="column" gap="extra-small">
        <Heading>Products & ramp</Heading>
        <Text variant="microcopy">
          Enter the total count. The builder picks the commit tier with the lowest list price and adds the overage SKU above it. Showing {segment} ·{' '}
          {BILLING[quote.billing].label.toLowerCase()} SKUs.
        </Text>
      </Flex>

      {quote.conflicts.map((c) => (
        <Alert key={c} title="Fix before continuing" variant="warning">
          {c}
        </Alert>
      ))}

      {quote.rows.map((row) => (
        <ProductTile key={row.input.uid} row={row} timusLists={timusLists} onUpdate={onUpdate} onRemove={onRemove} />
      ))}

      <Tile compact>
        <Flex direction="column" gap="small">
          <Text format={{ fontWeight: 'demibold' }}>Add a product</Text>
          <Flex gap="small" wrap>
            {FAMILY_ORDER.map((f) => (
              <Button key={f} variant="secondary" size="sm" onClick={() => onAdd(f)}>
                + {FAMILIES[f].label}
              </Button>
            ))}
          </Flex>
        </Flex>
      </Tile>

      {ramp.enabled && <RampSection quote={quote} ramp={ramp} onRamp={onRamp} />}
    </Flex>
  );
}
