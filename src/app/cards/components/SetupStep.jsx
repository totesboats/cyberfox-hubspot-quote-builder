import React from 'react';
import { Box, DateInput, Divider, Flex, Heading, Input, Select, Text, Tile } from '@hubspot/ui-extensions';
import { BILLING, FALLBACK_OPTIONS, PAYMENT_FREQUENCY_DEFAULT, PAYMENT_FREQUENCY_HIDDEN, SEGMENTS } from '../lib/config.js';
import { effectiveBilling } from '../lib/pricing.js';

const toDateValue = (iso) => {
  const [year, month, date] = (iso || '').split('-').map(Number);
  return year ? { year, month: month - 1, date } : undefined;
};
const fromDateValue = (v) => (v ? `${v.year}-${String(v.month + 1).padStart(2, '0')}-${String(v.date).padStart(2, '0')}` : '');
const kind = (t) => (t.templateType === 'CPQ_QUOTE' ? 'CPQ' : 'Legacy');

// One row of equal-width fields. Help text lives in tooltips so every input lines up.
const Row = ({ children, weights = [] }) => (
  <Flex direction="row" gap="medium" align="end">
    {React.Children.toArray(children).map((child, i) => (
      <Box key={i} flex={weights[i] || 1}>
        {child}
      </Box>
    ))}
  </Flex>
);

export function SetupStep({ setup, templates, suggested, contacts, owner, dealOptions, onChange }) {
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
  const templateOptions = [{ label: suggested ? `Suggest from products — ${suggested.name} (${kind(suggested)})` : 'Suggest from products', value: '' }].concat(
    templates.map((t) => ({ label: `${t.name} (${kind(t)})`, value: t.id }))
  );
  const templateHelp = !selected
    ? 'Pick a template, or add products and one is suggested.'
    : selected.templateType === 'CPQ_QUOTE'
      ? 'CPQ template: Commerce Hub approvals run on this quote.'
      : 'Legacy custom-coded template: your HTML/CSS renders, but Commerce Hub approvals do not run on it.';

  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Flex direction="column" gap="extra-small">
          <Heading>Quote setup</Heading>
          <Text variant="microcopy">Defaults come from the deal.</Text>
        </Flex>

        <Flex direction="column" gap="extra-small">
          <Row weights={[2, 1]}>
            <Select label="Quote template" name="templateId" options={templateOptions} value={setup.templateId} onChange={(v) => onChange({ templateId: String(v) })} />
            <Input
              label="Quote name"
              name="quoteName"
              placeholder="Named from company and products"
              tooltip="Leave blank to name the quote from the company and products."
              value={setup.quoteName}
              onChange={(v) => onChange({ quoteName: v })}
            />
          </Row>
          <Text variant="microcopy">{templateHelp}</Text>
        </Flex>

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
            readOnly={m2m}
            tooltip={m2m ? 'Month-to-month SKUs, set by the Agreement Length.' : 'Which price book the products use.'}
            options={m2m ? [{ label: BILLING.m2m.label, value: 'm2m' }] : ['monthly', 'annual'].map((k) => ({ label: BILLING[k].label, value: k }))}
            value={m2m ? 'm2m' : billing}
            onChange={(v) => onChange({ billing: String(v) })}
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

        <Row>
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
          <Select
            label="Buyer contact / signer"
            name="signerContactId"
            placeholder={contacts.length ? 'Choose a contact' : 'No contacts on this deal'}
            options={contacts.map((c) => ({ label: c.label, value: c.id }))}
            value={setup.signerContactId}
            onChange={(v) => onChange({ signerContactId: String(v) })}
          />
          <Input
            label="Seller contact"
            name="seller"
            readOnly
            tooltip="Always the deal owner. Change the deal owner to change the seller on the quote."
            value={owner ? [owner.name, owner.email].filter(Boolean).join(' · ') : 'No deal owner'}
            error={!owner}
            validationMessage={owner ? undefined : 'Assign a deal owner first.'}
          />
        </Row>

        <Divider />

        <Flex direction="column" gap="extra-small">
          <Heading>Prints on the quote</Heading>
          <Text variant="microcopy">Deal properties the quote templates print. The choices are the properties' own options in HubSpot.</Text>
        </Flex>
        <Row>
          <Select
            label="Agreement Length"
            name="agreementLength"
            required
            tooltip={m2m ? 'Month-to-month: plans renew monthly.' : 'Total length, including any ramp.'}
            placeholder="Choose a length"
            options={opts('agreement_length')}
            value={setup.agreementLength}
            onChange={(v) => onChange({ agreementLength: String(v) })}
          />
          <Select
            label="Payment Frequency"
            name="paymentFrequency"
            tooltip={`Blank matches the SKU pricing (${autoFrequencyLabel}).`}
            options={[{ label: `Match SKU pricing — ${autoFrequencyLabel}`, value: '' }].concat(frequencyOptions)}
            value={setup.paymentFrequency || ''}
            onChange={(v) => onChange({ paymentFrequency: String(v) })}
          />
          <Select label="Payment Method" name="paymentMethod" options={opts('payment_method')} value={setup.paymentMethod} onChange={(v) => onChange({ paymentMethod: String(v) })} />
          <Select label="Invoice Terms" name="invoiceTerms" options={opts('invoice_terms')} value={setup.invoiceTerms} onChange={(v) => onChange({ invoiceTerms: String(v) })} />
          <Select label="Promo" name="promo" options={[{ label: 'None', value: '' }].concat(opts('promo'))} value={setup.promo} onChange={(v) => onChange({ promo: String(v) })} />
        </Row>
        <Text variant="microcopy">AE Feature Type is set on the AutoElevate product, because it decides which SKUs are used.</Text>
      </Flex>
    </Tile>
  );
}
