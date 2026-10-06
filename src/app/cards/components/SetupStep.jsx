import React from 'react';
import { AutoGrid, DateInput, Divider, Flex, Heading, Input, Select, Text, Tile, ToggleGroup } from '@hubspot/ui-extensions';
import { BILLING, FALLBACK_OPTIONS, PAYMENT_FREQUENCY_DEFAULT, PAYMENT_FREQUENCY_HIDDEN, SEGMENTS } from '../lib/config.js';
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

        <Select label="Quote template" name="templateId" options={templateOptions} value={setup.templateId} description={templateHelp} onChange={(v) => onChange({ templateId: String(v) })} />

        <AutoGrid columnWidth={220} gap="medium" flexible>
          <ToggleGroup
            toggleType="radioButtonList"
            name="segment"
            label="Segment"
            inline
            options={SEGMENTS.map((s) => ({ label: s.label, value: s.value }))}
            value={setup.segment}
            onChange={(v) => onChange({ segment: v })}
          />
          <Select
            label="SKU pricing"
            name="billing"
            readOnly={m2m}
            description={m2m ? 'Month-to-month SKUs (set by Agreement Length).' : 'Which price book the products use.'}
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
        </AutoGrid>

        <Input
          label="Quote name"
          name="quoteName"
          placeholder="Leave blank to name it from the company and products"
          value={setup.quoteName}
          onChange={(v) => onChange({ quoteName: v })}
        />

        <Divider />

        <Flex direction="column" gap="extra-small">
          <Heading>Prints on the quote</Heading>
          <Text variant="microcopy">These are deal properties the quote templates print. The choices are the properties' own options in HubSpot.</Text>
        </Flex>
        <AutoGrid columnWidth={220} gap="medium" flexible>
          <Select
            label="Agreement Length"
            name="agreementLength"
            required
            description={m2m ? 'Month-to-month: plans renew monthly.' : 'Total length, including any ramp.'}
            placeholder="Choose a length"
            options={opts('agreement_length')}
            value={setup.agreementLength}
            onChange={(v) => onChange({ agreementLength: String(v) })}
          />
          <Select
            label="Payment Frequency"
            name="paymentFrequency"
            options={[{ label: `Match SKU pricing — ${autoFrequencyLabel}`, value: '' }].concat(frequencyOptions)}
            value={setup.paymentFrequency || ''}
            onChange={(v) => onChange({ paymentFrequency: String(v) })}
          />
          <Select label="Payment Method" name="paymentMethod" options={opts('payment_method')} value={setup.paymentMethod} onChange={(v) => onChange({ paymentMethod: String(v) })} />
          <Select label="Invoice Terms" name="invoiceTerms" options={opts('invoice_terms')} value={setup.invoiceTerms} onChange={(v) => onChange({ invoiceTerms: String(v) })} />
          <Select label="Promo" name="promo" options={[{ label: 'None', value: '' }].concat(opts('promo'))} value={setup.promo} onChange={(v) => onChange({ promo: String(v) })} />
        </AutoGrid>
        <Text variant="microcopy">AE Feature Type is set on the AutoElevate product, because it decides which SKUs are used.</Text>
      </Flex>
    </Tile>
  );
}

