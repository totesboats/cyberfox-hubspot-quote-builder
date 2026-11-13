import React from 'react';
import { Accordion, DateInput, Flex, Heading, Input, Select, Text, Tile } from '@hubspot/ui-extensions';
import { Row, NONE, toSelect, fromSelect } from './Layout.jsx';
import { BILLING, BILLING_ORDER, FALLBACK_OPTIONS, PAYMENT_FREQUENCY_DEFAULT, PAYMENT_FREQUENCY_HIDDEN, SEGMENTS } from '../lib/config.js';
import { effectiveBilling } from '../lib/pricing.js';

const toDateValue = (iso) => {
  const [year, month, date] = (iso || '').split('-').map(Number);
  return year ? { year, month: month - 1, date } : undefined;
};
const fromDateValue = (v) => (v ? `${v.year}-${String(v.month + 1).padStart(2, '0')}-${String(v.date).padStart(2, '0')}` : '');
const kind = (t) => (t.templateType === 'CPQ_QUOTE' ? 'CPQ' : 'Legacy');

export function SetupStep({ setup, templates, suggested, contacts, owner, user, dealOptions, onChange }) {
  // Dropdowns use the deal properties' live options, so whatever the rep picks is exactly
  // what the quote template prints.
  const opts = (name) => ((dealOptions && dealOptions[name]) || FALLBACK_OPTIONS[name] || []).map((o) => ({ label: o.label, value: o.value }));
  const billing = effectiveBilling(setup);
  const m2m = billing === 'm2m';
  const frequencyOptions = opts('payment_terms').filter((o) => !PAYMENT_FREQUENCY_HIDDEN.includes(o.value));
  const autoFrequency = PAYMENT_FREQUENCY_DEFAULT[billing];
  const autoFrequencyLabel = (frequencyOptions.find((o) => o.value === autoFrequency) || { label: autoFrequency }).label;

  const labelOf = (name, value) => (opts(name).find((o) => o.value === value) || { label: value }).label;

  const selected = templates.find((t) => t.id === setup.templateId) || suggested;
  const today = new Date();
  const templateOptions = [{ label: suggested ? `Suggested — ${suggested.name} (${kind(suggested)})` : 'Suggest from products', value: NONE }].concat(
    templates.map((t) => ({ label: `${t.name} (${kind(t)})`, value: t.id }))
  );
  const signer = contacts.find((c) => c.id === setup.signerContactId);
  const acceptanceLabel = { esignature: 'E-signature', clickwrap: 'Clickwrap', print_and_sign: 'Print and sign' }[setup.acceptance] || 'E-signature';
  // One line that says what's inside the collapsed Quote details, so reps only open it to change something.
  const details = [
    setup.expirationDate ? `Expires ${setup.expirationDate}` : '',
    acceptanceLabel,
    signer ? signer.label : 'No signer',
    setup.paymentFrequency ? labelOf('payment_terms', setup.paymentFrequency) : autoFrequencyLabel,
    setup.paymentMethod ? labelOf('payment_method', setup.paymentMethod) : '',
    setup.invoiceTerms ? labelOf('invoice_terms', setup.invoiceTerms) : '',
  ].filter(Boolean).join(' · ');

  return (
    <Tile>
      <Flex direction="column" gap="medium">
        <Heading>Quote setup</Heading>

        <Row weights={[2, 1]}>
          <Select label="Quote template" name="templateId" options={templateOptions} value={toSelect(setup.templateId)} onChange={(v) => onChange({ templateId: fromSelect(v) })} />
          <Select
            label="Agreement Length"
            name="agreementLength"
            required
            tooltip={m2m ? undefined : 'Total length, including any ramp.'}
            placeholder="Choose a length"
            options={opts('agreement_length')}
            value={setup.agreementLength}
            onChange={(v) => onChange({ agreementLength: String(v) })}
          />
        </Row>
        {selected && selected.templateType !== 'CPQ_QUOTE' && <Text variant="microcopy">Legacy template: Commerce Hub approvals don't run on it.</Text>}

        <Row weights={[1, 2]}>
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
        </Row>

        <Accordion title={`Quote details · ${details}`} size="sm">
          <Flex direction="column" gap="medium">
            <Row>
              <Input
                label="Quote name"
                name="quoteName"
                placeholder="Named from company and products"
                value={setup.quoteName}
                onChange={(v) => onChange({ quoteName: v })}
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
            </Row>
            <Row>
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
                tooltip={`Whoever builds the quote is the seller, so they can request approval.${owner ? ` The deal owner (${owner.name}) doesn't change.` : ''}`}
                value={user ? [[user.firstName, user.lastName].filter(Boolean).join(' '), user.email].filter(Boolean).join(' · ') : 'You'}
              />
            </Row>
            <Row>
              <Select
                label="Payment Frequency"
                name="paymentFrequency"
                options={[{ label: `Match SKU pricing — ${autoFrequencyLabel}`, value: NONE }].concat(frequencyOptions)}
                value={toSelect(setup.paymentFrequency)}
                onChange={(v) => onChange({ paymentFrequency: fromSelect(v) })}
              />
              <Select label="Payment Method" name="paymentMethod" options={opts('payment_method')} value={setup.paymentMethod} onChange={(v) => onChange({ paymentMethod: String(v) })} />
              <Select label="Invoice Terms" name="invoiceTerms" options={opts('invoice_terms')} value={setup.invoiceTerms} onChange={(v) => onChange({ invoiceTerms: String(v) })} />
            </Row>
          </Flex>
        </Accordion>
      </Flex>
    </Tile>
  );
}
