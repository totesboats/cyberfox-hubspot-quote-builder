import React, { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import {
  hubspot,
  Alert,
  Button,
  ErrorState,
  Flex,
  LoadingSpinner,
  StepIndicator,
  Text,
  useExtensionActions,
  useExtensionContext,
} from '@hubspot/ui-extensions';
import { SetupStep } from './components/SetupStep.jsx';
import { ProductsStep } from './components/ProductsStep.jsx';
import { ReviewStep } from './components/ReviewStep.jsx';
import { SummaryPanel } from './components/SummaryPanel.jsx';
import { QuotesPanel } from './components/QuotesPanel.jsx';
import { buildQuote, dealWrites, indexCatalog, openQuoteConflicts, suggestTemplate } from './lib/pricing.js';
import { AGREEMENT_LENGTH_DEFAULT, FAMILIES, QUOTE_DEFAULTS } from './lib/config.js';

export const STEPS = ['Setup', 'Products & ramp', 'Review & create'];

// hubspot.serverless resolves to the function's return value; older runtimes wrap it.
export async function callFunction(name, parameters) {
  const res = await hubspot.serverless(name, { parameters });
  if (res && res.status === 'ERROR') throw new Error(res.message || `${name} failed`);
  const body = res && res.status && res.response !== undefined ? res.response : res;
  if (!body) throw new Error(`${name} returned nothing`);
  return body;
}

function isoInDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export const initialState = {
  step: 0,
  setup: {
    templateId: '',
    segment: 'MSP',
    billing: 'monthly',
    agreementLength: AGREEMENT_LENGTH_DEFAULT,
    expirationDate: isoInDays(QUOTE_DEFAULTS.expirationDays),
    promo: '',
    paymentFrequency: '', // '' = follow billing
    paymentMethod: 'Credit Card',
    invoiceTerms: 'Net-30',
    acceptance: 'esignature',
    signerContactId: '',
    quoteName: '',
  },
  products: [],
  nextUid: 1,
  // Ramp settings; the ramp is on whenever at least one product has its Ramp box ticked.
  ramp: { months: 3, mode: 'free', percent: 50 },
  notes: '',
  primary: null, // null = automatic: primary when it's the deal's first builder quote
};

export function rampFor(state) {
  return Object.assign({}, state.ramp, { enabled: state.products.some((p) => p.ramp) });
}

/** @param {typeof initialState} state @param {any} action @returns {typeof initialState} */
export function reducer(state, action) {
  switch (action.type) {
    case 'hydrate':
      return Object.assign({}, state, { setup: Object.assign({}, state.setup, action.setup) });
    case 'step':
      return Object.assign({}, state, { step: Math.max(0, Math.min(STEPS.length - 1, action.step)) });
    case 'setup':
      return Object.assign({}, state, { setup: Object.assign({}, state.setup, action.patch) });
    case 'addProduct': {
      const family = FAMILIES[action.family];
      const row = {
        uid: state.nextUid,
        family: action.family,
        edition: family.editions[0].value,
        quantity: action.family === 'timus' ? 50 : 100,
        tier: '',
        discountPct: 0,
        ramp: false,
      };
      if (action.family === 'autoelevate') row.featureType = action.defaultAeFeatureType || 'Standard';
      if (action.family === 'timus') {
        // Rates start from the deal's current values (if any) so an existing Timus deal re-quotes as-is.
        const t = action.timusDefaults || {};
        Object.assign(row, { agreement: 'standard', minimum: '', satgatTier: '', gateways: 1, userRate: t.userRate ?? '', gatewayRate: t.gatewayRate ?? '' });
      }
      return Object.assign({}, state, { products: state.products.concat([row]), nextUid: state.nextUid + 1 });
    }
    case 'updateProduct':
      return Object.assign({}, state, { products: state.products.map((p) => (p.uid === action.uid ? Object.assign({}, p, action.patch) : p)) });
    case 'removeProduct':
      return Object.assign({}, state, { products: state.products.filter((p) => p.uid !== action.uid) });
    case 'clearRamp':
      return Object.assign({}, state, { products: state.products.map((p) => (p.ramp ? Object.assign({}, p, { ramp: false }) : p)) });
    case 'ramp': {
      return Object.assign({}, state, { ramp: Object.assign({}, state.ramp, action.patch) });
    }
    case 'notes':
      return Object.assign({}, state, { notes: action.value });
    case 'primary':
      return Object.assign({}, state, { primary: action.value });
    case 'loadState': {
      // Start a new option from a saved builder quote: same inputs, fresh dates, not primary.
      const saved = action.state;
      const products = (saved.products || []).map((p, i) => Object.assign({}, p, { uid: i + 1 }));
      return Object.assign({}, state, {
        step: 1,
        setup: Object.assign({}, state.setup, saved.setup, { expirationDate: state.setup.expirationDate, quoteName: '' }),
        products,
        nextUid: products.length + 1,
        ramp: Object.assign({}, state.ramp, saved.ramp),
        notes: saved.notes || '',
        primary: false,
      });
    }
    case 'nextOption':
      return Object.assign({}, state, { step: 1, primary: false, setup: Object.assign({}, state.setup, { quoteName: '' }) });
    default:
      return state;
  }
}

export function QuoteBuilderApp() {
  /** @type {any} */
  const context = useExtensionContext();
  /** @type {any} */
  const actions = useExtensionActions();
  const dealId = context && context.crm ? String(context.crm.objectId) : '';

  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState('');
  /** @type {[typeof initialState, (action: any) => void]} */
  const [state, dispatch] = useReducer(reducer, initialState);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [busyQuoteId, setBusyQuoteId] = useState('');
  const [pendingPrimary, setPendingPrimary] = useState('');

  // refresh = reload after a write; keeps whatever the rep has entered.
  const load = useCallback(async (refresh = false) => {
    setLoadError('');
    try {
      const res = await callFunction('quote_builder_catalog', { dealId });
      if (!res.ok) throw new Error((res.errors || []).join('; ') || 'Could not load the product library.');
      const catalog = indexCatalog(res.products);
      setData(Object.assign({}, res, { catalog }));
      if (refresh === true) return;
      const props = (res.deal && res.deal.properties) || {};
      dispatch({
        type: 'hydrate',
        setup: {
          segment: res.deal && res.deal.salesTeam === 'ENT' ? 'ENT' : 'MSP',
          promo: props.promo || '',
          paymentMethod: props.payment_method || 'Credit Card',
          invoiceTerms: props.invoice_terms || 'Net-30',
          signerContactId: res.deal && res.deal.contacts[0] ? res.deal.contacts[0].id : '',
          paymentFrequency: props.payment_terms || '',
          agreementLength: props.agreement_length || AGREEMENT_LENGTH_DEFAULT,
        },
      });
    } catch (err) {
      setLoadError(err.message);
    }
  }, [dealId]);

  useEffect(() => {
    if (dealId) load();
  }, [dealId, load]);

  const families = state.products.map((p) => p.family);
  const suggested = useMemo(() => (data ? suggestTemplate(data.templates, families) : null), [data, families.join(',')]);
  const template = data ? data.templates.find((t) => t.id === state.setup.templateId) || suggested : null;

  const quote = useMemo(() => {
    if (!data) return null;
    const setup = Object.assign({}, state.setup, {
      salesTeam: data.deal.salesTeam,
      templateType: template ? template.templateType : 'CPQ_QUOTE',
    });
    return buildQuote(setup, state.products, rampFor(state), data.catalog);
  }, [data, state.setup, state.products, state.ramp, template]);
  // Deal properties the quote template prints as tokens (validated against live options).
  const writes = useMemo(() => (quote ? dealWrites(quote, { setup: state.setup, notes: state.notes }, data.dealOptions) : null), [quote, state.setup, state.notes, data]);

  if (loadError) {
    return (
      <ErrorState title="The Quote Builder couldn't load">
        <Text>{loadError}</Text>
        <Button onClick={() => load()}>Try again</Button>
      </ErrorState>
    );
  }
  if (!data || !quote) return <LoadingSpinner label="Loading the product library…" showLabel layout="centered" />;

  const quotes = data.deal.quotes || [];
  const primary = state.primary == null ? !quotes.some((q) => q.builder) : state.primary;
  const affected = openQuoteConflicts(quotes, data.deal.properties, writes.properties).quotes;

  const makePrimary = async (quoteId) => {
    setPendingPrimary('');
    setBusyQuoteId(quoteId);
    try {
      const res = await callFunction('quote_builder_set_primary', { dealId, quoteId });
      if (!res.ok) throw new Error((res.errors || []).join(' '));
      actions.addAlert({ type: 'success', title: 'Primary option updated', message: `The deal now carries this quote's ${res.lineCount || 0} line items and printed fields.` });
      if (actions.refreshObjectProperties) actions.refreshObjectProperties();
      await load(true);
    } catch (err) {
      actions.addAlert({ type: 'danger', title: "Couldn't change the primary option", message: err.message });
    } finally {
      setBusyQuoteId('');
    }
  };
  const requestPrimary = (q) => {
    const others = quotes.filter((x) => x.id !== q.id);
    const risky = openQuoteConflicts(others, data.deal.properties, (q.state && q.state.dealProperties) || {}).quotes;
    if (risky.length) setPendingPrimary(q.id);
    else makePrimary(q.id);
  };

  const blocker =
    state.step === 0 && !state.setup.agreementLength
      ? 'Pick an Agreement Length.'
      : state.step === 1 && state.products.length === 0
      ? 'Add at least one product.'
      : state.step === 1 && quote.blocking.length
        ? 'Fix the highlighted product before continuing.'
        : state.step === 1 && quote.conflicts.length
          ? 'Fix the issue above before continuing.'
        : state.step === 2 && quote.conflicts.length
          ? quote.conflicts[0]
        : state.step === 2 && writes.errors.length
          ? 'Fix the deal property issues below.'
        : state.step === 2 && !template
          ? 'Pick a quote template on the Setup step.'
        : state.step === 2 && !data.deal.owner
          ? 'Assign a deal owner. The quote\'s seller contact is always the deal owner.'
          : state.step === 2 && quote.lines.length === 0
            ? 'There are no line items to write.'
            : '';

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const payload = {
        dealId,
        setup: Object.assign({}, state.setup, { templateId: template.id }),
        products: state.products,
        ramp: rampFor(state),
        notes: state.notes,
        primary,
      };
      const res = await callFunction('quote_builder_submit', payload);
      setResult(res);
      if (res.ok) {
        actions.addAlert({ type: 'success', title: 'Quote created', message: `${res.title} was created as a draft with ${res.lineCount} line items.` });
        if (actions.refreshObjectProperties) actions.refreshObjectProperties();
        load(true); // refresh the quotes list
      } else {
        actions.addAlert({ type: 'danger', title: 'Quote not created', message: (res.errors || []).join(' ') });
      }
    } catch (err) {
      setResult({ ok: false, errors: [err.message] });
      actions.addAlert({ type: 'danger', title: 'Quote not created', message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const go = (step) => dispatch({ type: 'step', step });
  const isLast = state.step === STEPS.length - 1;
  const created = !!(result && result.ok);

  return (
    <Flex direction="column" gap="medium">
      {data.issues && data.issues.length > 0 && (
        <Alert title="Product library needs attention" variant="warning">
          {data.issues.slice(0, 5).join(' · ')}
          {data.issues.length > 5 ? ` · and ${data.issues.length - 5} more` : ''}
        </Alert>
      )}

      <SummaryPanel quote={quote} template={template} dealQuoteCount={data.deal.quoteCount} />

      {state.step === 0 && (
        <QuotesPanel
          quotes={quotes}
          portalId={data.portalId}
          busyId={busyQuoteId}
          pendingPrimary={pendingPrimary}
          onStartFrom={(q) => {
            setResult(null);
            dispatch({ type: 'loadState', state: q.state });
          }}
          onMakePrimary={requestPrimary}
          onConfirmPrimary={() => makePrimary(pendingPrimary)}
          onCancelPrimary={() => setPendingPrimary('')}
        />
      )}

      <StepIndicator stepNames={STEPS} currentStep={state.step} onClick={go} />

      {state.step === 0 && (
        <SetupStep
          setup={state.setup}
          templates={data.templates}
          suggested={suggested}
          contacts={data.deal.contacts}
          owner={data.deal.owner}
          dealOptions={data.dealOptions}
          onChange={(patch) => dispatch({ type: 'setup', patch })}
        />
      )}
      {state.step === 1 && (
        <ProductsStep
          quote={quote}
          setup={state.setup}
          onAdd={(family) =>
            dispatch({
              type: 'addProduct',
              family,
              timusDefaults: {
                userRate: data.deal.properties.timus_price_per_user || '',
                gatewayRate: data.deal.properties.timus_price_per_gateway || '',
              },
              defaultAeFeatureType: data.deal.properties.sku_type || '',
            })
          }
          onUpdate={(uid, patch) => dispatch({ type: 'updateProduct', uid, patch })}
          onRemove={(uid) => dispatch({ type: 'removeProduct', uid })}
          ramp={rampFor(state)}
          onRamp={(patch) => dispatch({ type: 'ramp', patch })}
          onClearRamp={() => dispatch({ type: 'clearRamp' })}
        />
      )}
      {state.step === 2 && (
        <ReviewStep
          quote={quote}
          setup={state.setup}
          template={template}
          deal={data.deal}
          products={state.products}
          notes={state.notes}
          onNotes={(value) => dispatch({ type: 'notes', value })}
          primary={primary}
          firstBuilderQuote={!quotes.some((q) => q.builder)}
          onPrimary={(value) => dispatch({ type: 'primary', value })}
          affectedQuotes={affected}
          onAnotherOption={() => {
            setResult(null);
            dispatch({ type: 'nextOption' });
          }}
          result={result}
          writes={writes}
          dealOptions={data.dealOptions}
        />
      )}

      {blocker && (
        <Flex justify="end">
          <Text variant="microcopy">{blocker}</Text>
        </Flex>
      )}
      <Flex justify="end" align="center" gap="small">
        {state.step > 0 && (
          <Button variant="secondary" disabled={submitting} onClick={() => go(state.step - 1)}>
            Back
          </Button>
        )}
        {isLast ? (
          <Button variant="primary" disabled={!!blocker || submitting || created} onClick={submit}>
            {submitting ? 'Creating quote…' : created ? 'Quote created' : 'Create quote'}
          </Button>
        ) : (
          <Button variant="primary" disabled={!!blocker} onClick={() => go(state.step + 1)}>
            Continue
          </Button>
        )}
      </Flex>
    </Flex>
  );
}
