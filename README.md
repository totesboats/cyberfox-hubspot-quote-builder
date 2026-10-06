# CyberFOX Quote Builder

A HubSpot app card on the **Deal** record (“Quote Builder” tab) that builds one quote across
AutoElevate, Password Manager, DNS Filtering, Timus SASE, Optimize365 and CyberFOX Bundles:

1. **Setup**: template, segment, SKU pricing (monthly or annual), expiry, signer, and the deal properties the quote prints: **Agreement Length, Payment Frequency, Payment Method, Invoice Terms, Promo**. Their dropdowns are the properties' own options in HubSpot.
2. **Products & ramp**: rep enters a total count; the builder picks the cheapest commit tier and adds the overage (“Additional”) SKU. AutoElevate rows pick an **AE Feature Type**. Timus uses the Timus SKUs (Monthly Minimum at the minimum the rep sets, or a SATGAT SKU); the rep enters **Timus Price Per User** and **Timus Price Per Gateway**, which print on the quote, and the card checks estimated usage against the minimum. Each product has a **Ramp** box; ticking any of them shows the Ramp & schedule section (1–6 months, free or % off, plus the billing schedule) on the same page. Untick them all and the section disappears.
3. **Review & create**: exact line items, the quote-token values, notes for approvers, approval preview → creates a **draft** HubSpot quote.

**Agreement Length drives the terms.** There is no separate Contract Term field. A ramped product gets RAMP lines for the ramp months and its plan for the rest (15 Months with a 3-month ramp → RAMP P3M + plan P12M); products not on the ramp run the plan for the whole agreement. Choosing the Month-to-Month agreement switches the SKUs to month-to-month.

A live summary (MRR, first-12-months, TCV, savings vs list, approval status and approver) sits above every step.

## Architecture

```
src/app/
  app-hsmeta.json                 private app, static auth, scopes
  cards/QuoteBuilder.jsx          entry (hubspot.extend)
  cards/QuoteBuilderApp.jsx       state + steps
  cards/components/*.jsx          Setup, Products, Ramp, Review, Summary, LineTable
  functions/quote-builder-*.js    GENERATED single-file bundles of functions-src/ (HubSpot deploys each function as one file)
functions-src/                         app function source: catalog (products + templates + deal context), submit
                                       (rebuilds the quote server-side and writes it), set-primary; lib/hubspot.js
shared/config.mjs, shared/pricing.mjs  business rules + pricing (single source of truth)
scripts/                               one-time setup (properties, product tagging)
tests/                                 unit, function (fake HubSpot API) and card render tests
```

- **Platform 2026.03 app functions** (HubSpot-hosted, `hubspot.serverless`). Chosen over an external backend because there is nothing to host, the token never leaves HubSpot, and both calls fit the 15-second limit. Requires an Enterprise subscription and a private, static-auth app.
- **Pricing runs twice.** The card prices live for the preview; the submit function re-reads the product library and rebuilds every line. The card never sends prices, so a tampered request can't change them.
- **`shared/` is the only place to edit rules.** `npm run sync` writes an ESM copy into `src/app/cards/lib` and a CommonJS copy into `functions-src/lib`, then bundles each function into `src/app/functions/`; tests check the copies behave identically and the bundles are self-contained.

### What Create quote writes

| Where | What |
|---|---|
| Deal line items | One per line, associated to the deal (type 20), `hs_product_id` linked, price/qty/discount/term/frequency, `ramp`, `approval_discount` (0 on RAMP lines), `approval_ramp_months`, `qb_source = quote_builder`, `qb_session_id` |
| Quote line items | A separate copy of each (CPQ requires quote lines distinct from deal lines) |
| Quote | `hs_title`, `hs_expiration_date`, `hs_template_type`, language, currency; associations: deal 64, line items 67, template 286, contact 69, signer 702 (CPQ + e-sign). CPQ: `hs_acceptance_method`. Legacy: `hs_status = DRAFT` |
| Deal (quote tokens) | `agreement_length` (as chosen on Setup), `payment_terms` (Payment Frequency: follows billing unless the rep picks one), `payment_method`, `invoice_terms`, `promo`; for AutoElevate `sku_type` (AE Feature Type) and `ae_feature_type_details`; for Timus `timus_price_per_user`, `timus_price_per_gateway` (both entered by the rep) and `new_minimum_commitment_amount`. `timus_price_list` is being retired and is never written. Also `hubspot_quote_notes`. `contract_term` is **not** written (set `WRITE_CONTRACT_TERM` in `shared/config.mjs` if something downstream still reads it) |
| Cleanup | For the primary option, archives the line items the previous primary option left on the deal (matched by `qb_source`); it never touches lines created any other way |

If any write fails, everything that run created is archived again and the rep sees the error.

**Several quotes on one deal (options).** Reps can quote 100 agents and 250 agents on the same deal:

- *Quotes on this deal* (Setup step) lists every quote with its status, amount and whether its printed values are **locked** (published, sent, out for signature, accepted) or still **read the deal's current values** (draft, pending approval, changes requested). HubSpot freezes deal-property tokens when a quote is published, so publish each option before building the next.
- **New option from this** reloads a builder quote's inputs (saved on the quote in `qb_builder_state`) so the rep only changes what differs, e.g. 100 → 250 agents.
- **Primary option** (Review step): only the primary option's line items sit on the deal, so the deal amount and forecast reflect one option. The deal's first builder quote is always primary; later options default to not primary. **Make primary** on any builder quote swaps the deal's line items and printed fields to that option (`quote_builder_set_primary` function).
- If unpublished quotes would pick up new printed values, the card warns before Create quote and before Make primary.

**Quote-token properties are validated, not guessed.** The card reads the live dropdown options of Agreement Length, Payment Frequency, Payment Method, Invoice Terms, Promo and AE Feature Type, uses them for its own dropdowns, and refuses to submit a value a property doesn't offer (nothing is written in that case). The Review step lists every token with the exact value the quote will print.

**AutoElevate feature type.** Each AutoElevate row has an *AE Feature Type* picker, which decides both the SKUs and the wording on the quote (`AE_FEATURE_TYPES` in `shared/config.mjs`):

| AE Feature Type | Priced on | AE Feature Type Details |
|---|---|---|
| Standard | Standard 2026 SKUs | “Elevation. Additional agents … Usage of Advanced features Blocker and Just-in-Time Admin Login will result in additional charges. …” |
| Advanced | Advanced 2026 SKUs | “Elevation, Blocker, and Just-In-Time Admin Login. Additional agents … Unlimited User (Technician) & Company licenses included” |
| Advanced (GrandFathered) | Standard 2026 SKUs | “{commit tier} agents include advanced features Just-In-Time Admin Login and Blocker. All additional agents include standard elevation. …” |

The texts are the ones already on your deals. The deal holds one AE Feature Type, so a quote with AutoElevate rows of different feature types is blocked with an explanation.

**Approvals:** the API always creates quotes as Draft; HubSpot does not let the API start an approval. The card shows whether approval is needed and who it routes to (MSP → Tina Kalke, ENT → Adam Friedman, AM → Julie Webb, else Operations), and the rep clicks **Request approval** on the quote. Legacy (custom-coded) templates don't run Commerce Hub approvals, so the card says so.

## Setup (once)

Needs Node 22+, the HubSpot CLI (`npm i -g @hubspot/cli`, `hs auth`) and, for the scripts, `HUBSPOT_TOKEN` = an Ops private-app token (not production-shared; store it in a password manager, not the repo) that can create product and line item properties, read/update products (`e-commerce`), and read quote and deal property settings (`crm.schemas.quotes.read/write`, `crm.schemas.deals.read`, `crm.schemas.line_items.read`). HubSpot names any missing scope in the error. Every script is a dry run unless you pass `--apply`.

```bash
npm install
npm run setup:properties -- --apply      # qb_* product props; qb_source/qb_session_id line item props; qb_session_id/qb_builder_state quote props
npm run setup:tag-products               # writes product-tagging-review.csv — review it
npm run setup:tag-products -- --apply    # tags rows with status "ok" (365 of 372 today)
npm run check                            # sync + unit/function tests + typecheck + card render tests
hs project upload                        # build and deploy
```

Then add the **Quote Builder** card to the Deal record tab layout (Settings › Objects › Deals › Record customization), install the app, and test on a sandbox deal first.

## New price book (e.g. the 2027 SKUs)

The builder sells from one price book, set by `PRICE_BOOK` in `scripts/tag-products.mjs`. Changing it and re-running `tag-products` tags the new folders and untags the old book. Full checklist: `NEW-PRICE-BOOK.md`.

## Product library findings (from the dry-run tagger)

These won't be tagged until fixed, so they won't appear in the builder:

- `Advanced-AE-35000-Agent-Commit-2026`: **name and SKU are swapped**.
- Password Boss 6 folder holds legacy 500-user **packs** (`PB-500-User-Pack`, `-ENT`, `-Annual-Pack-ENT`) priced far below the 500 commit; skipped so they don't collide.
- One-off SKUs (`…-1off`): AE Advanced 250 annual (base + additional) and AE Advanced ENT annual 500 additional.
- `DNS-750-Device-Commi-…-E-2026` (monthly + annual): SKU typo, still tags correctly.
- PB6 commit tiers only have scattered “Additional User” SKUs, so PB commit is priced as whole tiers (no overage line).
- Timus has no per-user or gateway SKUs; reps enter those prices on the Timus row and they print through the deal properties.

## Decisions to confirm

1. **Billing start delay after a ramp.** Off by default (`SET_BILLING_DELAY_AFTER_RAMP` in `shared/config.mjs`) to match how ramps are entered now and how Sale Review groups ramp segments. Turn on if billing should start after the ramp.
2. **Line items on the deal and the quote.** Both are written. If Sale Review should read only quote lines, drop the deal-line step.
3. **Month-to-month lines** use “Automatically renew until canceled” with no term. Check that Sale Review handles that.
4. **Advanced (GrandFathered).** Assumed to price on Standard SKUs with the tier-specific wording above (the most common pattern on existing deals; a few grandfathered deals use the plain Advanced or Standard wording instead). Change `edition`/`details` in `AE_FEATURE_TYPES` if that's wrong.
5. **Contract Term removed.** Agreement Length is the only length the rep sets and what the quote prints. If Sale Review or a report reads `contract_term`, turn `WRITE_CONTRACT_TERM` back on and it will mirror Agreement Length.
6. **Payment Frequency vs. SKU billing.** Kept independent (many deals pay annually on monthly-priced SKUs). The card only warns when annual SKUs are set to a non-annual frequency. Line-item billing frequency always follows the SKU.
7. **The “Length” deal property** (“For HubSpot Quoting”) was empty on the 200 recent AutoElevate deals I checked, so the card doesn't write it. Say if a template still uses it.
8. **Template list** hides names containing “one off”, “clone of”, “sponsorship” and the Default templates (`TEMPLATE_HIDE`).
9. **Scopes.** Not yet confirmed against the live portal: which scope covers `GET /crm/v3/objects/quote_templates`. If the card's first load reports a 403 on quote_templates, add the scope HubSpot names to `app-hsmeta.json`.
10. **Timus quotation sync.** The current Timus Quote Builder also creates the quotation in the Timus platform. This card only writes HubSpot; keep the Timus card for that step or add a Timus API call to the submit function (needs a secret and the Timus endpoint).

## Tests

`npm run check` runs 55 tests: pricing/ramp/approval math (including Timus), tagging (including a price book switch), both app functions against a fake HubSpot API (association IDs, server-side pricing, cleanup scope, rollback), a type-check of every card component against `@hubspot/ui-extensions` 0.17.0, and four card flows rendered with HubSpot's test renderer. Fixtures are synthetic.
