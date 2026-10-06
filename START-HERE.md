# CyberFOX HubSpot Quote Builder — start here

> **No Node on your laptop?** Follow `GITHUB-SETUP.md`. GitHub runs the tests, setup scripts and uploads, so skip steps 1, 3, 4 and the `npm run upload` part of step 5 below. You still create the private app in step 2 (its token goes into a GitHub secret instead of PowerShell) and do the Install in step 5, then 6–10.

Work through these in order. Each step says what you should see. Paste anything unexpected back into the chat with the step number.

All commands run in **PowerShell** opened in this folder
(File Explorer → this folder → click the address bar → type `powershell` → Enter).

---

## 1. Prep your machine (one time)

1. Install **Node.js 22 LTS or newer** (the test commands need 22+) from nodejs.org (accept the defaults). Close and reopen PowerShell.
2. Run:

```powershell
node --version                      # v22 or newer
npm install -g @hubspot/cli@latest
hs --version
npm install                         # installs the test/build tools for this project
npm run check                       # expect: "pass 47" then "pass 5", no "fail"
hs auth                             # sign in to the CyberFOX portal (personal access key)
```

If `npm run check` fails, stop and send the output.

## 2. Token for the setup scripts

HubSpot → Settings → Integrations → **Legacy Apps** → **Create a private app**, name it **Quote Builder setup**, scopes:

- `crm.schemas.products.write`, `crm.schemas.line_items.write`, `crm.schemas.quotes.write`
- `crm.objects.products.read`, `crm.objects.products.write`, `e-commerce`
- `crm.objects.deals.read`, `hubdb`

Copy the token **into PowerShell only** (never into chat, email or a file):

```powershell
$env:HUBSPOT_TOKEN = "paste-token-here"
```

It lasts until you close that PowerShell window.

## 3. Create the fields

```powershell
npm run setup:properties              # dry run: lists what it would create
npm run setup:properties -- --apply
```

Adds a "Quote Builder" group of properties on Products, Line items and Quotes. Nothing existing changes.

## 4. Tag products, seed Timus price lists

```powershell
npm run setup:tag-products            # writes product-tagging-review.csv
```

Open the CSV in Excel: expect ~365 `ok` and 7 `skip`. Then:

```powershell
npm run setup:tag-products -- --apply
npm run setup:timus-hubdb             # writes timus-price-lists-seed.csv
npm run setup:timus-hubdb -- --apply
```

HubSpot → Marketing → Files and Templates → **HubDB** → "Quote Builder – Timus price lists": fill **advanced_user_rate** for the lists you'll test → **Publish**.

## 5. Upload and install the app

```powershell
npm run upload
```

If it reports a missing scope, add it to `src\app\app-hsmeta.json` (`requiredScopes`) and run it again.
Then HubSpot → **Development → Projects → cyberfox-quote-builder → the app → Install**.

## 6. Card on a deal view only you see

Settings → Objects → Deals → **Record customization** → create a view assigned to just you (or Ops) → add a **Quote Builder** tab → Card library → Apps → **Quote Builder**.

## 7. Test deal

Create company **TEST – Quote Builder**, a contact with a job title, and a deal with **Sales Team = MSP** associated to both. Quotes the card creates are drafts — delete them when done.

## 8. Test scenarios

| # | Build | Check |
|---|---|---|
| 1 | AutoElevate Standard, 1,250 agents, 10%, Agreement Length 12 Months | 2 lines (1,000 tier + 250 additional); Standard wording on the quote; Auto-approves |
| 2 | Tick Ramp, 3 months free, Agreement Length 15 Months | RAMP lines P3M, plan lines P12M; Request approval → Tina |
| 3 | Discount 35% | Approval reason; Commerce Hub approval fires |
| 4 | AE Feature Type = Advanced (GrandFathered) | Details text "1,000 agents include advanced features…" |
| 5 | Enterprise + Annual SKUs, Password Manager + DNS | Annual SKUs; Payment Frequency Annual Payments |
| 6 | Timus with a filled-in price list | Monthly Minimum line at tier; Timus deal fields set; check legacy Timus template too |
| 7 | Publish #1 → New option from this → 250 agents, not primary → Make primary | #1 keeps its printed values; deal amount switches on Make primary |

For each: preview the quote (tokens print correctly) and check the deal's line items and fields.

## 9. When something breaks

- Function errors: `hs project logs` → pick `quote_builder_catalog`, `quote_builder_submit` or `quote_builder_set_primary`
- Card errors show in the card itself
- Send the message or a screenshot plus the scenario number

## 10. UI polish

```powershell
npm run dev
```

The card on your test deal hot-reloads as code changes. Share screenshots (or let Claude look at the deal in the browser) and we'll iterate.

---

Folder map: `src\app\cards` (the card UI) · `src\app\functions` (server side) · `shared` (pricing/approval rules — edit here, `npm run sync` copies them) · `scripts` (one-time setup) · `tests` · `README.md` (full design notes).
