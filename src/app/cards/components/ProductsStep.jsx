import React from 'react';
import { Alert, Button, Checkbox, Flex, Heading, NumberInput, Select, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { Row, NONE, toSelect, fromSelect } from './Layout.jsx';
import { AE_FEATURE_TYPES, BILLING, FAMILIES, FAMILY_ORDER, SEGMENTS } from '../lib/config.js';
import { formatMoney } from '../lib/pricing.js';
import { LineTable } from './LineTable.jsx';
import { RampSection } from './RampSection.jsx';
import { PrintedReference } from './PrintedReference.jsx';

function StandardFields({ input, priced, family, onUpdate }) {
  const per = priced.annual ? '/yr' : '/mo';
  const tierOptions = priced.tierOptions.length
    ? [{ label: `Best price${priced.bestTier ? ` — ${priced.bestTier.toLocaleString('en-US')} tier` : ''}`, value: NONE }].concat(priced.tierOptions.map((o) => ({ label: o.label, value: String(o.value) })))
    : [{ label: 'No tiers for this combination', value: NONE }];
  return (
    <Row>
      {input.family === 'autoelevate' ? (
        <Select
          label="AE Feature Type"
          name={`feature-${input.uid}`}
          tooltip={`Priced on ${(AE_FEATURE_TYPES.find((f) => f.value === input.featureType) || AE_FEATURE_TYPES[0]).edition} SKUs; sets the quote's feature wording.`}
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
        tooltip={`Prices are list ${per}. Best price picks the cheapest tier for the count.`}
        options={tierOptions}
        value={toSelect(input.tier)}
        onChange={(v) => onUpdate({ tier: fromSelect(v) === '' ? '' : Number(v) })}
      />
      <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
    </Row>
  );
}

function TimusFields({ input, priced, onUpdate }) {
  const t = priced.timus || { satgatTiers: [] };
  const satgat = input.agreement === 'satgat';
  const num = (v) => (v === '' || v === null || v === undefined ? undefined : Number(v));
  return (
    <Flex direction="column" gap="medium">
    <Row>
      <Select
        label="Agreement"
        name={`ag-${input.uid}`}
        options={[
          { label: 'Monthly minimum', value: 'standard' },
          { label: 'Satisfaction guarantee (SATGAT)', value: 'satgat' },
        ]}
        value={input.agreement || 'standard'}
        onChange={(v) => onUpdate({ agreement: String(v) })}
      />
      {satgat ? (
        <Select
          label="SATGAT tier"
          name={`sat-${input.uid}`}
          options={t.satgatTiers.map((tier) => ({ label: `${formatMoney(tier, 0)} minimum`, value: String(tier) }))}
          value={String(Number(input.satgatTier) || t.satgatTiers[0] || '')}
          onChange={(v) => onUpdate({ satgatTier: Number(v) })}
        />
      ) : (
        <NumberInput
          label="Monthly minimum"
          name={`min-${input.uid}`}
          tooltip="Leave blank for the Monthly Minimum SKU price."
          min={0}
          precision={2}
          value={num(input.minimum)}
          onChange={(v) => onUpdate({ minimum: v })}
        />
      )}
      <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
    </Row>
    <Row>
      <NumberInput label="Users" name={`users-${input.uid}`} min={0} precision={0} value={Number(input.quantity) || 0} onChange={(v) => onUpdate({ quantity: v })} />
      <NumberInput label="Gateways" name={`gw-${input.uid}`} min={0} precision={0} value={Number(input.gateways) || 0} onChange={(v) => onUpdate({ gateways: v })} />
      <NumberInput
        label="Timus Price Per User"
        name={`rate-${input.uid}`}
        required
        min={0}
        precision={2}
        tooltip="Prints on the quote."
        value={num(input.userRate)}
        onChange={(v) => onUpdate({ userRate: v })}
      />
      <NumberInput
        label="Timus Price Per Gateway"
        name={`gwrate-${input.uid}`}
        required
        min={0}
        precision={2}
        tooltip="Prints on the quote."
        value={num(input.gatewayRate)}
        onChange={(v) => onUpdate({ gatewayRate: v })}
      />
    </Row>
    </Flex>
  );
}

function ProductTile({ row, onUpdate, onRemove }) {
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
        <Flex justify="between" align="center" gap="medium">
          <Flex gap="small" align="center">
            <Heading>{family.label}</Heading>
            <Tag>{edition.label}</Tag>
            {row.ramped && <Tag variant="warning">{row.rampLines[0] ? `${row.rampLines[0].termMonths}-mo ramp` : 'Ramp'}</Tag>}
          </Flex>
          <Flex gap="small" align="center">
            <Text format={{ fontWeight: 'demibold' }}>{mrr}</Text>
            <Button variant="secondary" size="sm" onClick={() => onRemove(input.uid)}>
              Remove
            </Button>
          </Flex>
        </Flex>

        {input.family === 'timus' ? (
          <TimusFields input={input} priced={priced} onUpdate={update} />
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

export function ProductsStep({ quote, setup, ramp, writes, dealOptions, onEditSetup, onAdd, onUpdate, onRemove, onStage, onAddStage, onRemoveStage, onClearRamp }) {
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

      <PrintedReference writes={writes} dealOptions={dealOptions} ramp={ramp} quote={quote} onEdit={onEditSetup} />

      {quote.conflicts.map((c) => (
        <Alert key={c} title="Fix before continuing" variant="warning">
          {c}
        </Alert>
      ))}

      {quote.rows.map((row) => (
        <ProductTile key={row.input.uid} row={row} onUpdate={onUpdate} onRemove={onRemove} />
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

      {ramp.enabled && <RampSection quote={quote} ramp={ramp} onStage={onStage} onAddStage={onAddStage} onRemoveStage={onRemoveStage} onClear={onClearRamp} />}
    </Flex>
  );
}
