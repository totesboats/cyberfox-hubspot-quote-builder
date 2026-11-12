# CyberFOX Quote Builder

A HubSpot app card on the **Deal** record (“Quote Builder” tab) that builds one quote across
AutoElevate, Password Manager, DNS Filtering, Timus SASE, Optimize365 (CyberFOX Bundles are retired: no longer offered on new quotes; saved quotes with a bundle still load):

1. **Setup**: template, segment, SKU pricing (monthly or annual), expiry, signer, and the deal properties the quote prints: **Agreement Length, Payment Frequency, Payment Method, Invoice Terms**. Promo is not on Setup and the builder never writes it, so a deal's Promo is left as it is. Their dropdowns are the properties' own options in HubSpot. Agreement Length is always open; the other three show as one read-only line (Invoice Terms starts at Due Upon Receipt, Payment Method at the deal's value) until the rep clicks **Edit**.
2. **Products & ramp**: rep enters a total count; the builder defaults to the highest commit tier at or below the count and adds the overage (“Additional”) SKU above it (900 agents = 750 tier + 150 additional, even when the 1,000 tier lists a few dollars less). The rep can pick a bigger tier to round up. AutoElevate rows pick an **AE Feature Type**. Timus uses the Timus SKUs (Monthly Minimum at the minimum the rep sets, or a SATGAT SKU); the rep enters **Timus Price Per User** and **Timus Price Per Gateway**, which print on the quote, and the card checks estimated usage against the minimum. Each product has a **Ramp** box; ticking it gives **that product its own ramp**, edited in the product's tile: 1–12 months in up to 4 stages, each free or % off (e.g. AutoElevate 2 months free while DNS Filtering is 2 months at 50% off, or ramps of different lengths). The **Ramp & schedule** section below the products shows the combined billing schedule; **Remove all ramps** unticks every product.
3. **Review & create**: exact line items, the quote-token values, approval preview → creates a **draft** HubSpot quote. The success message says to refresh the page so the quote appears in the deal's Quotes card, with a **Refresh page** button, and, when approval is needed, the rename workaround for HubSpot's "Saving…" approval bug.

The **Live summary** (totals and approval status) sits under the step tracker on every step; until products are added it's a single line.

**One-off SKUs.** "+ One-off SKU" adds a row where the rep picks any active product in the product library's **One-Off SKUs** folder (read live each time the card loads, so a new one-off is quotable as soon as it's saved there; no tagging). The line uses that product's own price and billing frequency (Monthly or Annually) × the quantity, less any discount, for the Agreement Length, and can ramp like any product. The builder reads the product family from the name/SKU (`ONE_OFF_FAMILY_PATTERNS` in `shared/config.mjs`): an AutoElevate one-off sets AE Feature Type (Advanced if "Advanced" is in the name) and its wording, an Optimize365 one-off follows the Optimize ramp rule, and the template suggestion and quote name use the family. One-time charges (no billing frequency) aren't supported yet and show an error.

**Default ramp length.** Ticking a product's Ramp box starts its ramp at the months the Agreement Length runs past 12, free (16 months → 4, 18 → 6; 12 months or less → a short ramp). Changing the Agreement Length updates any product ramp still at its untouched default; a length the rep picked is kept.

**MSP Optimize365 (per user or per tenant + Optimize TDR, Nov 2026).** MSP Optimize365 rows have a **Pricing** choice. **Per user** prices the original MSP per-user SKUs (100–2,500 user plans + Additional Users). **Per tenant** prices the tenant plans (5, 25, 50, 100, 250, 500 tenants + Additional Tenants above the tier, using the same highest-tier-at-or-below rule as everything else) and shows a **TDR users** field for the **Optimize TDR** add-on: one line, volume priced, so every user is billed at the rate of the tier the total falls into (1–4,999 $1.00, 5,000–7,499 $0.85, 7,500–14,999 $0.70, 15,000+ $0.50); 0 = no TDR. HubSpot's API doesn't expose a product's volume tiers, so they live in `OPTIMIZE_TDR` (`shared/config.mjs`); keep them in step with the Optimize TDR product. The row's discount and ramp (Optimize rule) apply to the TDR line too. Enterprise is per user only. `tag-products` tags the tenant plans `qb_edition = tenant`, Optimize TDR `qb_edition = tdr`, and clears the tags on the retired Oct 2026 SKUs (Tenant Base, Additional Tenant, TDR – User Base / Additional User); `properties` adds the `tenant` option to *Quote Builder: edition*.

**Currency (Nov 2026).** A quote is priced in its deal's currency (*Deal currency code*): each product's price comes from its `hs_price_<currency>` (USD, CAD, GBP, EUR, AUD), every line item is written with that currency, and the quote's currency matches. A SKU with no price in the deal's currency is a blocking error naming the SKU (it never falls back to USD), so fill in the missing price in the product library. Timus: a Monthly Minimum the rep enters is taken as the deal's currency; the SKU default needs a price in it. Optimize TDR tiers are USD only (`OPTIMIZE_TDR.currency`), so TDR can't be quoted on a non-USD deal until tiers in that currency are added. The Products step says which currency it's showing when it isn't USD.

**Optimize365 ramps.** Optimize ramps only as free months on top of a 12-month plan: a 13-month agreement ramps 1 free month, 14 months ramps 2, 15 months ramps 3 (100% off), paid monthly, for MSP and Enterprise alike. Annual (paid upfront, including monthly SKUs on Annual Payments) and month-to-month Optimize quotes never ramp. On other agreements Optimize's Ramp box is locked with the reason; when ticked, Optimize's own ramp is fixed at that length, one stage, 100% off (other products' ramps are unaffected) (`OPTIMIZE_RAMP` in `shared/config.mjs`). The submit function enforces the same rule.

**Ramp stages.** A single-stage ramp writes `RAMP …` lines; a staged ramp writes `RAMP 1 …`, `RAMP 2 …` lines in order, each with its own term (P2M, P2M …) and discount. `approval_ramp_months` on every RAMP line is that product's total ramp length, so a 2 + 2 ramp counts as 4 months; the card's approval preview uses the longest product ramp on the quote. Quotes saved before per-product ramps (one shared ramp) load with that ramp copied to each ticked product. No billing start delay is set (same as single-stage ramps today; `SET_BILLING_DELAY_AFTER_RAMP` turns delays on for every stage and the plan).

**Automatic co-term (Nov 2026).** When the builder opens a new quote, it adds a **Co-term** row for every product the deal's company is Active on **and pays Month-to-Month** (*AE / PM / DNS / Timus / Optimize Payment Terms* on the company), except the deal's own product, so reps never tick anything. A product paid Annual Payments, Quarterly or One Time, or with no Payment Terms, never co-terms: added by hand it's an Upsell, and the submit function enforces this from the company record. Each row is sized from the company's current commit in the segment picked on Setup (MSP or Enterprise SKUs), using the usual tier rule (150 agents = the 100-agent plan + 50 additional agents):
- **AutoElevate:** *AE Agent Commit*; *AE Feature Type* Standard → Standard SKUs, Advanced or Advanced (GrandFathered) → Advanced SKUs.
- **Password Manager:** *PM User Commit* on the 2026 User Packs, rounded up to whole packs (200 users = 2 × 100-user packs).
- **DNS Filtering:** *DNS Device Commit*.
- **Optimize365:** *Optimize Tenant Commit* per tenant when the company has one (MSP only), else *Optimize User Commit* per user.
- **Timus SASE:** *Timus Committed MRR* (a spend commit) as the Monthly Minimum line. The per-user and per-gateway rates are optional on a co-term and the Timus deal fields aren't written.

A blank commit leaves the count empty and asks the rep to enter it (and Ops to fix the company record). Reps can change the count, plan and discount as a fail-safe; the discount counts toward approval as usual. A co-term row can't be removed and doesn't ramp. Editing or copying an older quote adds any co-term rows it's missing (a one-off SKU counts as its product). The company properties are in `COTERM_COMMITS` in `shared/config.mjs`.

**Line type for the NetSuite auto-split (Nov 2026).** Every line item carries `qb_family` (its product; a one-off SKU gets its product's family when the name says which, else `oneoff`) and `qb_line_type`: **Upsell** when the deal's primary company is already Active on that product (*AE Product*, *PM Product*, *DNS Product*, *Timus Product*, *Optimize Product*), **New** otherwise, or **Co-term** for the automatic co-term rows below. Co-term is never on the deal's own product (`PIPELINE_FAMILY` in `shared/config.mjs`): on an AutoElevate Upsell deal the AutoElevate row is the upsell itself, so it's always Upsell. Co-term lines stay on the deal at Closed Won (no extra deal or Sale Review); Ops updates the renewal date on the company. The product tile and the Review table show each row's type. The submit function reads the company itself, so the card can't change New/Upsell. Internal values are the ones on the HubSpot property: `New`, `Upsell`, `coterm` (`LINE_TYPES` in `shared/config.mjs`). Make primary copies both fields.

**Agreement Length drives the terms.** There is no separate Contract Term field. A ramped product gets RAMP lines for its own ramp months and its plan for the rest (15 Months with a 3-month ramp → RAMP P3M + plan P12M); products not on the ramp run the plan for the whole agreement. Choosing the Month-to-Month agreement switches the SKUs to month-to-month.

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
quote-modules/                         separate HubSpot project: CPQ quote template module (one table per product), see quote-modules/README.md
tests/                                 unit, function (fake HubSpot API) and card render tests
```

- **HubSpot API version 2026-09** (date-based). Every call uses the paths in `HS_PATHS` (`shared/config.mjs`); legacy `/v3` and `/v4` paths stop working September 2027. To move to a newer version, change `HS_API_VERSION` and run `npm run check`. Two things differ from v3/v4: a record's associations are read with the associations batch read (`/crm/associations/2026-09/{from}/{to}/batch/read`), and quote templates fall back to v3 if HubSpot ever refuses them on the date-based objects API (they aren't documented there yet). The tests fail on any `/v3` or `/v4` call.
- **Platform 2026.03 app functions** (HubSpot-hosted, `hubspot.serverless`). Chosen over an external backend because there is nothing to host, the token never leaves HubSpot, and both calls fit the 15-second limit. Requires an Enterprise subscription and a private, static-auth app.
- **Pricing runs twice.** The card prices live for the preview; the submit function re-reads the product library and rebuilds every line. The card never sends prices, so a tampered request can't change them.
- **`shared/` is the only place to edit rules.** `npm run sync` writes an ESM copy into `src/app/cards/lib` and a CommonJS copy into `functions-src/lib`, then bundles each function into `src/app/functions/`; tests check the copies behave identically and the bundles are self-contained.

### What Create quote writes

| Where | What |
|---|---|
| Deal line items | One per line, associated to the deal (type 20), `hs_product_id` linked, price/qty/discount/term/frequency, `ramp`, `approval_discount` (0 on RAMP lines), `approval_ramp_months`, `qb_source = quote_builder`, `qb_session_id`, `qb_family` and `qb_line_type` (for the NetSuite auto-split, below) |
| Quote line items | A separate copy of each (CPQ requires quote lines distinct from deal lines) |
| Quote | `hs_title`, `hs_expiration_date`, `hs_template_type`, language, currency; online payment off (`hs_payment_enabled = false`, as on every CyberFOX CPQ quote); quote owner and seller = whoever builds or updates the quote (`hubspot_owner_id`, `hs_sender_firstname/lastname/email`, looked up as a HubSpot owner from the signed-in user's email). HubSpot only lets a quote's owner or creator click Request approval, and app-made quotes have no creator, so the builder must own the quote. The deal owner is never changed; if the builder can't be matched to a HubSpot owner, the deal owner is used; associations: deal 64, line items 67, template 286, the deal's company 71 (its name and address print as the buyer company), contact 69, signer 702 (CPQ + e-sign). Editing a quote adds the company if it's missing. CPQ: `hs_acceptance_method`. Legacy: `hs_status = DRAFT` |
| Deal (quote tokens) | `agreement_length` (as chosen on Setup), `payment_terms` (Payment Frequency: follows billing unless the rep picks one), `payment_method`, `invoice_terms`; for AutoElevate `sku_type` (AE Feature Type) and `ae_feature_type_details`; for Timus `timus_price_per_user`, `timus_price_per_gateway` (both entered by the rep) and `new_minimum_commitment_amount`. `timus_price_list` is being retired and is never written. **HubSpot Quote Notes (`hubspot_quote_notes`) is never touched**, so reps' special verbiage stays as they wrote it. `contract_term` is **not** written (set `WRITE_CONTRACT_TERM` in `shared/config.mjs` if something downstream still reads it) |
| Cleanup | For the primary option, archives the line items the previous primary option left on the deal (matched by `qb_source`); it never touches lines created any other way |

If any write fails, everything that run created is archived again and the rep sees the error.

**Several quotes on one deal (options).** Reps can quote 100 agents and 250 agents on the same deal:

- *Quotes on this deal* (Setup step) lists every quote with its status, amount and whether its printed values are **locked** (published, sent, out for signature, accepted) or still **read the deal's current values** (draft, pending approval, changes requested). HubSpot freezes deal-property tokens when a quote is published, so publish each option before building the next.
- **Edit quote** (drafts and quotes with changes requested) reopens a builder quote's inputs; **Update quote** replaces its line items and settings in place, keeping the same quote, link and primary/alternative status. Quotes pending approval must be recalled first; published quotes are locked, so start a new option from them. A quote can't switch between a CPQ and a legacy template.
- **New option from this** reloads a builder quote's inputs (saved on the quote in `qb_builder_state`) so the rep only changes what differs, e.g. 100 → 250 agents.
- **Primary option** (Review step): only the primary option's line items sit on the deal, so the deal amount and forecast reflect one option. The deal's first builder quote is always primary; later options default to not primary. **Make primary** on any builder quote swaps the deal's line items and printed fields to that option (`quote_builder_set_primary` function).
- If unpublished quotes would pick up new printed values, the card warns before Create quote and before Make primary.

**Quote-token properties are validated, not guessed.** The card reads the live dropdown options of Agreement Length, Payment Frequency, Payment Method, Invoice Terms and AE Feature Type, uses them for its own dropdowns, and refuses to submit a value a property doesn't offer (nothing is written in that case). The Review step lists every token with the exact value the quote will print.

**AutoElevate feature type.** Each AutoElevate row has an *AE Feature Type* picker, which decides both the SKUs and the wording on the quote (`AE_FEATURE_TYPES` in `shared/config.mjs`):

| AE Feature Type | Priced on | AE Feature Type Details |
|---|---|---|
| Standard | Standard 2026 SKUs | “Elevation. Additional agents … Usage of Advanced features Blocker and Just-in-Time Admin Login will result in additional charges. …” |
| Advanced | Advanced 2026 SKUs | “Elevation, Blocker, and Just-In-Time Admin Login. Additional agents … Unlimited User (Technician) & Company licenses included” |

The texts are the ones already on your deals. The deal holds one AE Feature Type, so a quote with AutoElevate rows of different feature types is blocked with an explanation.

**Advanced (GrandFathered) is retired** (Oct 2026): it is no longer offered. A deal or saved quote that still has it opens as Standard, and the submit function rejects it.

**Approvals:** the API always creates quotes as Draft; HubSpot does not let the API start an approval. The card shows whether approval is needed and who it routes to (MSP → Tina Harvey, ENT → Adam Friedman, AM → Julie Webb, else Operations), and the rep clicks **Request approval** on the quote. Legacy (custom-coded) templates don't run Commerce Hub approvals, so the card says so.

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
4. **Advanced (GrandFathered).** Retired in Oct 2026; no longer offered (see AutoElevate feature type).
5. **Contract Term removed.** Agreement Length is the only length the rep sets and what the quote prints. If Sale Review or a report reads `contract_term`, turn `WRITE_CONTRACT_TERM` back on and it will mirror Agreement Length.
6. **Payment Frequency vs. SKU billing.** Kept independent (many deals pay annually on monthly-priced SKUs). The card only warns when annual SKUs are set to a non-annual frequency. Line-item billing frequency always follows the SKU.
7. **The “Length” deal property** (“For HubSpot Quoting”) was empty on the 200 recent AutoElevate deals I checked, so the card doesn't write it. Say if a template still uses it.
8. **Template list** hides names containing “one off”, “clone of”, “sponsorship” and the Default templates (`TEMPLATE_HIDE`).
9. **Scopes.** Not yet confirmed against the live portal: which scope covers `GET /crm/v3/objects/quote_templates`. If the card's first load reports a 403 on quote_templates, add the scope HubSpot names to `app-hsmeta.json`.
10. **Timus quotation sync.** The current Timus Quote Builder also creates the quotation in the Timus platform. This card only writes HubSpot; keep the Timus card for that step or add a Timus API call to the submit function (needs a secret and the Timus endpoint).

## Tests

`npm run check` runs 68 tests: pricing/ramp/approval math (including Timus), tagging (including a price book switch), both app functions against a fake HubSpot API (association IDs, server-side pricing, cleanup scope, rollback), a type-check of every card component against `@hubspot/ui-extensions` 0.17.0, and eight card flows rendered with HubSpot's test renderer. Fixtures are synthetic.
