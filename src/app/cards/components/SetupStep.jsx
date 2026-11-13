import React from 'react';
import { DateInput, Flex, Heading, Select, Text, Tile } from '@hubspot/ui-extensions';
import { Row, NONE, toSelect, fromSelect } from './Layout.jsx';
import { BILLING, BILLING_ORDER, FALLBACK_OPTIONS, PAYMENT_FREQUENCY_DEFAULT, PAYMENT_FREQUENCY_HIDDEN, SEGMENTS } from '../lib/config.js';
import { effectiveBilling } from '../lib/pricing.js';

const toDateValue = (iso) => {
  const [year, month, date] = (iso || '').split('-').map(Number);
  return year ? { year, month: month - 1, date } : undefined;
};
const fromDateValue = (v) => (v ? `${v.year}-${String(v.month + 1).padStart(2, '0')}-${String(v.date).padStart(2, '0')}` : '');
const kind = (t) => (t.templateType === 'CPQ_QUOTE' ? 'CPQ' : 'Legacy');

export function SetupStep({ setup, templates, suggested, contacts, dealOptions, onChange }) {
  // Dropdowns use the deal properties' live options, so whatever the rep picks is exactly
  // what the quote template prints.
  const opts = (name) => ((dealOptions && dealOptions[name]) || FALLBACK_OPTIONS[name] || []).map((o) => ({ label: o.label, value: o.value }));
  const billing = effectiveBilling(setup);
  const m2m = billing === 'm2m';
  const frequencyOptions = opts('payment_terms').filter((o) => !PAYMENT_FREQUENCY_HIDDEN.includes(o.value));
  const autoFrequency = PAYMENT_FREQUENCY_DEFAULT[billing];
  const autoFrequencyLabel = (frequencyOptions.find((o) => o.value === autoFrequency) || { label: autoFrequency }).label;

  const selected = templates.find((t) => t.id === setup.templateId) || suggested;
  const today = new Date();
  const templateOptions = [{ label: suggested ? `Suggested — ${suggested.name} (${kind(suggested)})` : 'Suggest from products', value: NONE }].concat(
    templates.map((t) => ({ label: `${t.name} (${kind(t)})`, value: t.id }))
  );
  const group = (label) => (
    <Text variant="microcopy" format={{ fontWeight: 'demibold' }}>
      {label}
    </Text>
  );

  // Three equal columns per group so every row lines up. Quote name is set on Review; the seller is always
  // whoever builds the quote, so it isn't a field here.
  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Heading>Quote setup</Heading>

        <Flex direction="column" gap="extra-small">
          <Select label="Quote template" name="templateId" options={templateOptions} value={toSelect(setup.templateId)} onChange={(v) => onChange({ templateId: fromSelect(v) })} />
          {selected && selected.templateType !== 'CPQ_QUOTE' && <Text variant="microcopy">Legacy template: Commerce Hub approvals don't run on it.</Text>}
        </Flex>

        <Flex direction="column" gap="extra-small">
          {group('PRICING')}
          <Row>
            <Select
              label="Segment"
              name="segment"
              options={SEGMENTS.map((s) => ({ label: s.label, value: s.value }))}
              value={setup.segment}
              onChange={(v) => onChange({ segment: String(v) })}
            />
            <Select
              label="SKU pricing"
              name="billing"
              tooltip={m2m ? 'AutoElevate only.' : undefined}
              options={BILLING_ORDER.map((k) => ({ label: BILLING[k].label, value: k }))}
              value={billing}
              onChange={(v) => onChange({ billing: String(v) })}
            />
            <Select
              label="Agreement Length"
              name="agreementLength"
              required
              placeholder="Choose a length"
              options={opts('agreement_length')}
              value={setup.agreementLength}
              onChange={(v) => onChange({ agreementLength: String(v) })}
            />
          </Row>
        </Flex>

        <Flex direction="column" gap="extra-small">
          {group('PRINTS ON THE QUOTE')}
          <Row>
            <Select
              label="Payment Frequency"
              name="paymentFrequency"
              options={[{ label: `${autoFrequencyLabel} (matches SKU pricing)`, value: NONE }].concat(frequencyOptions)}
              value={toSelect(setup.paymentFrequency)}
              onChange={(v) => onChange({ paymentFrequency: fromSelect(v) })}
            />
            <Select label="Payment Method" name="paymentMethod" options={opts('payment_method')} value={setup.paymentMethod} onChange={(v) => onChange({ paymentMethod: String(v) })} />
            <Select label="Invoice Terms" name="invoiceTerms" options={opts('invoice_terms')} value={setup.invoiceTerms} onChange={(v) => onChange({ invoiceTerms: String(v) })} />
          </Row>
        </Flex>

        <Flex direction="column" gap="extra-small">
          {group('SIGNING')}
          <Row>
            <Select
              label="Signer"
              name="signerContactId"
              placeholder={contacts.length ? 'Choose a contact' : 'No contacts on this deal'}
              options={contacts.map((c) => ({ label: c.label, value: c.id }))}
              value={setup.signerContactId}
              onChange={(v) => onChange({ signerContactId: String(v) })}
            />
            <Select
              label="Acceptance"
              name="acceptance"
              readOnly={selected && selected.templateType !== 'CPQ_QUOTE'}
              options={[
                { label: 'E-signature', value: 'esignature' },
                { label: 'Clickwrap (no signature)', value: 'clickwrap' },
                { label: 'Print and sign', value: 'print_and_sign' },
              ]}
              value={setup.acceptance}
              onChange={(v) => onChange({ acceptance: String(v) })}
            />
            <DateInput
              label="Quote expires"
              name="expirationDate"
              format="YYYY-MM-DD"
              min={{ year: today.getFullYear(), month: today.getMonth(), date: today.getDate() }}
              value={toDateValue(setup.expirationDate)}
              onChange={(v) => onChange({ expirationDate: fromDateValue(v) })}
            />
          </Row>
        </Flex>
      </Flex>
    </Tile>
  );
}
