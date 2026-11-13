import React from 'react';
import { Accordion, Alert, Button, Checkbox, Dropdown, Flex, Heading, NumberInput, Select, Tag, Text, Tile } from '@hubspot/ui-extensions';
import { Row, NONE, toSelect, fromSelect } from './Layout.jsx';
import { AE_FEATURE_TYPES, BILLING, FAMILIES, FAMILY_ORDER, M2M_FAMILIES, OPTIMIZE_TDR, SEGMENTS } from '../lib/config.js';
import { editionsFor, formatMoney, lineTypeLabel, unitsFor } from '../lib/pricing.js';
import { LineTable } from './LineTable.jsx';
import { ProductRamp, RampSection } from './RampSection.jsx';
import { PrintedReference } from './PrintedReference.jsx';

// The main row: Feature Type / Pricing (when the product has a choice), count, plan and discount. Per-tenant
// Optimize365 adds the Optimize TDR users field on a second row.
function StandardFields({ input, priced, family, segment, onUpdate }) {
  // Co-term rows come from the company record: only the discount can change.
  const locked = !!input.coterm;
  const units = unitsFor(input.family, input.edition);
  const ae = input.family === 'autoelevate';
  const editions = editionsFor(input.family, segment);
  const tdrField = input.family === 'optimize365' && input.edition === OPTIMIZE_TDR.withEdition;
  const tdrTiers = OPTIMIZE_TDR.tiers.map((t) => `${t.from.toLocaleString('en-US')}${t.to == null ? '+' : `–${t.to.toLocaleString('en-US')}`}: ${formatMoney(t.price)}`).join(', ');
  const tierOptions = priced.tierOptions.length
    ? [{ label: `Default${priced.bestTier ? ` — ${priced.bestTier.toLocaleString('en-US')} tier` : ''}`, value: NONE }].concat(priced.tierOptions.map((o) => ({ label: o.label, value: String(o.value) })))
    : [{ label: 'No tiers for this combination', value: NONE }];
  const picker = ae ? (
    <Select
      label="Feature Type"
      name={`feature-${input.uid}`}
      options={AE_FEATURE_TYPES.map((f) => ({ label: f.value, value: f.value }))}
      readOnly={locked}
      value={input.featureType || 'Standard'}
      onChange={(v) => onUpdate({ featureType: String(v), tier: '' })}
    />
  ) : editions.length > 1 ? (
    <Select
      label={family.pickerLabel || 'Edition'}
      name={`edition-${input.uid}`}
      options={editions.map((e) => ({ label: e.label, value: e.value }))}
      readOnly={locked}
      value={input.edition}
      onChange={(v) => onUpdate({ edition: String(v), tier: '' })}
    />
  ) : null;
  return (
    <Flex direction="column" gap="medium">
      <Row>
        {picker}
        <NumberInput label={`Total ${units.unit}`} name={`qty-${input.uid}`} min={0} precision={0} readOnly={locked} value={Number(input.quantity) || 0} onChange={(v) => onUpdate({ quantity: v })} />
        <Select
          label="Plan"
          name={`tier-${input.uid}`}
          tooltip="Highest tier at or below the count, plus additional units. Pick a bigger tier to round up."
          options={tierOptions}
          readOnly={locked}
          value={toSelect(input.tier)}
          onChange={(v) => onUpdate({ tier: fromSelect(v) === '' ? '' : Number(v) })}
        />
        <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
      </Row>
      {tdrField && (
        <Row weights={[1, 3]}>
          <NumberInput
            label="TDR users"
            name={`tdr-${input.uid}`}
            tooltip={`Volume priced per user per month: ${tdrTiers}. 0 = no TDR.`}
            min={0}
            precision={0}
            readOnly={locked}
            value={Number(input.tdrUsers) || 0}
            onChange={(v) => onUpdate({ tdrUsers: v })}
          />
          <Text> </Text>
        </Row>
      )}
    </Flex>
  );
}

// One-off SKU: pick the product from the One-Off SKUs folder; its price and billing come from HubSpot.
function OneOffFields({ input, priced, oneOffs, onUpdate }) {
  const options = oneOffs.length
    ? [{ label: 'Choose a one-off SKU', value: NONE }].concat(
        oneOffs.map((o) => ({ label: `${o.name} — ${formatMoney(o.price)}${o.frequency === 'annually' ? '/yr' : '/mo'}`, value: o.id }))
      )
    : [{ label: 'No active products in the One-Off SKUs folder', value: NONE }];
  return (
    <Row weights={[3, 1, 1]}>
      <Select
        label="One-off SKU"
        name={`oneoff-${input.uid}`}
        options={options}
        value={toSelect(input.productId)}
        onChange={(v) => {
          const id = fromSelect(v);
          const picked = oneOffs.find((o) => o.id === id);
          onUpdate({ productId: id, baseFamily: picked ? picked.baseFamily : null });
        }}
      />
      <NumberInput label="Quantity" name={`qty-${input.uid}`} min={0} precision={0} value={Number(input.quantity) || 0} onChange={(v) => onUpdate({ quantity: v })} />
      <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
    </Row>
  );
}

function TimusFields({ input, priced, onUpdate }) {
  const t = priced.timus || { satgatTiers: [] };
  // A Timus co-term re-signs the company's Timus Committed MRR: only the discount can change.
  const locked = !!input.coterm;
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
        readOnly={locked}
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
          tooltip={locked ? undefined : 'Blank = the Monthly Minimum SKU price.'}
          min={0}
          precision={2}
          readOnly={locked}
          value={num(input.minimum)}
          onChange={(v) => onUpdate({ minimum: v })}
        />
      )}
      <NumberInput label="Discount %" name={`disc-${input.uid}`} min={0} max={100} precision={2} value={Number(input.discountPct) || 0} onChange={(v) => onUpdate({ discountPct: v })} />
    </Row>
    {!locked && (
    <Row>
      <NumberInput label="Users" name={`users-${input.uid}`} min={0} precision={0} value={Number(input.quantity) || 0} onChange={(v) => onUpdate({ quantity: v })} />
      <NumberInput label="Gateways" name={`gw-${input.uid}`} min={0} precision={0} value={Number(input.gateways) || 0} onChange={(v) => onUpdate({ gateways: v })} />
      <NumberInput
        label="Timus Price Per User"
        name={`rate-${input.uid}`}
        required={!input.coterm}
        min={0}
        precision={2}
        value={num(input.userRate)}
        onChange={(v) => onUpdate({ userRate: v })}
      />
      <NumberInput
        label="Timus Price Per Gateway"
        name={`gwrate-${input.uid}`}
        required={!input.coterm}
        min={0}
        precision={2}
        value={num(input.gatewayRate)}
        onChange={(v) => onUpdate({ gatewayRate: v })}
      />
    </Row>
    )}
    </Flex>
  );
}

function ProductTile({ row, quote, onUpdate, onRemove, onStage, onAddStage, onRemoveStage }) {
  const optimizeRamp = quote.optimizeRamp;
  const { input, priced } = row;
  const family = FAMILIES[input.family];
  const edition =
    input.family === 'autoelevate'
      ? { label: input.featureType || 'Standard' }
      : input.family === 'oneoff'
        ? { label: priced.baseFamily && FAMILIES[priced.baseFamily] ? `One-off · ${FAMILIES[priced.baseFamily].label}` : 'One-off' }
        : family.editions.find((e) => e.value === input.edition) || family.editions[0];
  const mrr = row.mainLines.length ? `${formatMoney(row.mainMrr)}/mo` : '—';
  const update = (patch) => onUpdate(input.uid, patch);
  const optimizeLocked = row.family === 'optimize365' && optimizeRamp && !optimizeRamp.allowed && !input.ramp;
  const lineCount = row.rampLines.length + row.mainLines.length;
  const detailsTitle = lineCount ? `Details · ${lineCount} line item${lineCount === 1 ? '' : 's'}` : 'Details';
  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex justify="between" align="center" gap="medium">
          <Flex gap="small" align="center">
            <Heading>{input.family === 'oneoff' ? priced.productName || family.label : family.label}</Heading>
            {input.family === 'oneoff' && <Tag>{edition.label}</Tag>}
            {row.ramped && <Tag variant="warning">{`${row.rampMonths}-mo ramp`}</Tag>}
            {row.lineType && <Tag variant={row.lineType === 'coterm' ? 'info' : row.lineType === 'Downgrade' ? 'warning' : 'default'}>{lineTypeLabel(row.lineType)}</Tag>}
          </Flex>
          <Flex gap="small" align="center">
            <Text format={{ fontWeight: 'demibold' }}>{mrr}</Text>
            {/* Co-term rows can't be removed: every product the company is Active on is co-termed. */}
            {!input.coterm && (
              <Button variant="secondary" size="sm" onClick={() => onRemove(input.uid)}>
                Remove
              </Button>
            )}
          </Flex>
        </Flex>

        {input.coterm && <Text variant="microcopy">{`From the company record: ${input.cotermNote || 'its current commit'}. Only the discount can change.`}</Text>}

        {input.family === 'timus' ? (
          <TimusFields input={input} priced={priced} onUpdate={update} />
        ) : input.family === 'oneoff' ? (
          <OneOffFields input={input} priced={priced} oneOffs={quote.oneOffs || []} onUpdate={update} />
        ) : (
          <StandardFields input={input} priced={priced} family={family} segment={quote.segment} onUpdate={update} />
        )}

        {priced.error ? (
          <Alert title="Can't price this product" variant="warning">
            {priced.error}
          </Alert>
        ) : priced.hint ? (
          priced.hintLevel === 'warning' ? (
            <Alert title="Check this" variant="warning">
              {priced.hint}
            </Alert>
          ) : (
            <Text variant="microcopy">{priced.hint}</Text>
          )
        ) : null}

        {/* Ramp and the line items, out of the way until needed. */}
        <Accordion title={detailsTitle} size="sm" defaultOpen={!!input.ramp}>
          <Flex direction="column" gap="medium">
            {/* Optimize365 can only ramp 1–3 free months on a 13/14/15-month monthly agreement; otherwise the box
                is locked (still untickable if it was ticked before Setup changed). */}
            {!input.coterm && (
              <Checkbox
                name={`ramp-${input.uid}`}
                checked={!!input.ramp}
                readOnly={optimizeLocked}
                description={optimizeLocked ? optimizeRamp.reason : undefined}
                onChange={(checked) => update({ ramp: checked })}
              >
                Ramp
              </Checkbox>
            )}
            {input.ramp && !input.coterm && <ProductRamp row={row} quote={quote} onStage={onStage} onAddStage={onAddStage} onRemoveStage={onRemoveStage} />}
            {row.mainLines.length > 0 && <LineTable lines={row.rampLines.concat(row.mainLines)} />}
          </Flex>
        </Accordion>
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
        <Text variant="microcopy">{`${segment} · ${BILLING[quote.billing].label}${quote.currency && quote.currency !== 'USD' ? ` · ${quote.currency}` : ''}${quote.m2m ? ' · AutoElevate only' : ''}`}</Text>
      </Flex>

      <PrintedReference writes={writes} dealOptions={dealOptions} ramp={ramp} quote={quote} onEdit={onEditSetup} />

      {quote.conflicts.map((c) => (
        <Alert key={c} title="Fix before continuing" variant="warning">
          {c}
        </Alert>
      ))}

      {quote.rows.map((row) => (
        <ProductTile key={row.input.uid} row={row} quote={quote} onUpdate={onUpdate} onRemove={onRemove} onStage={onStage} onAddStage={onAddStage} onRemoveStage={onRemoveStage} />
      ))}

      <Flex>
        <Dropdown buttonText="Add product" variant="secondary" buttonSize="sm">
          {FAMILY_ORDER.filter((f) => !quote.m2m || M2M_FAMILIES.includes(f)).map((f) => (
            <Dropdown.ButtonItem key={f} onClick={() => onAdd(f)}>
              {FAMILIES[f].label}
            </Dropdown.ButtonItem>
          ))}
        </Dropdown>
      </Flex>

      {quote.anyRamp && <RampSection quote={quote} onClear={onClearRamp} />}
    </Flex>
  );
}
