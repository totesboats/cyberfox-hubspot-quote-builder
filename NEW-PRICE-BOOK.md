# Switching the Quote Builder to a new price book (e.g. the 2027 SKUs)

The builder sells from one price book at a time, set by `PRICE_BOOK` in `scripts/tag-products.mjs`.
Switching takes one push and one setup-script run. Nothing about the card itself changes.

## 1. Before the switch: build the new products in HubSpot

Create the 2027 products in folders named like the 2026 ones, with the new year:

| 2026 folder | 2027 folder |
|---|---|
| AutoElevate - Standard 2026 | AutoElevate - Standard 2027 |
| AutoElevate - Advanced 2026 | AutoElevate - Advanced 2027 |
| DNS Filtering - 2026 | DNS Filtering - 2027 |
| Password Boss - 2026 | Password Boss - 2027 |
| Timus - Advanced 2026 | Timus - Advanced 2027 |
| Bundles - 2026 | Bundles - 2027 |

`Password Boss 6` and `Optimize365` have no year. Their products stay tagged as they are; update prices in place or tell Claude if they move to a yearly folder.

Name products the way the tagger reads them:

- Tier: a number before "Agent", "Device" or "User" ("250 Agent Commit"), or "Bundle 500"
- Overage SKUs: "Additional" in the name
- Enterprise: "Enterprise" in the name, or `-E` / `-ENT` in the SKU
- Billing: "Annual" or "Month-to-Month" in the name; otherwise monthly
- One-off SKUs: `1off` in the SKU (they're skipped on purpose)

Creating the new products changes nothing for reps until step 3.

## 2. Point the builder at the new book

Ask Claude to switch the price book to 2027, or edit `scripts/tag-products.mjs`:

```js
export const PRICE_BOOK = '2027';
```

Then run `.\push.cmd "Switch to 2027 price book"`.

## 3. Dry run, check, apply (this is the cutover)

GitHub → **Actions → Setup scripts → Run workflow** → `tag-products`, Apply unticked.

The log reads `Price book 2027: … ok, … conflict, … skip, … untag`:

- **ok**: 2027 products that will be tagged. Spot-check the CSV (family, segment, billing, tier, component).
- **untag**: the 2026 products that will leave the builder. Expect roughly the old ok count.
- **conflict**: two products claim the same slot (same family, edition, segment, billing, tier and component). Fix to 0 before applying.
- **skip**: read the note column; fix the name/SKU or accept.

When it looks right, run it again with **Apply** ticked, at the moment reps should switch. From then on the card offers only 2027 SKUs and prices.

Not affected: existing deals, line items and quotes keep their 2026 lines and prices. The 2026 products stay active in the Product Library for anything else that uses them.

## 4. The rest of the checklist

- **Timus price lists (HubDB).** If per-user or gateway rates change, edit the rows in *Quote Builder – Timus price lists* and **Publish**. If the minimum or SATGAT SKUs get new names, tell Claude (they're in `TIMUS` in `shared/config.mjs`).
- **AE Feature Type wording.** If the AutoElevate quote text changes, update `AE_FEATURE_TYPES` in `shared/config.mjs`.
- **Quote templates.** If 2027 templates get new names, check that the Setup step still suggests the right one (`TEMPLATE_HINTS`).
- **Smoke test.** On the test deal, build one quote per product family and compare prices to the 2027 price sheet.

## Rolling back

Set `PRICE_BOOK` back to `'2026'`, push, and run `tag-products` with Apply. The 2026 products are re-tagged and the 2027 ones untagged.

## Decision to make before December

After the switch, the builder can't quote 2026 prices. If renewals or open deals still need 2026 pricing after the cutover, reps add those lines by hand, or ask Claude to add a price-book picker to the Setup step before the switch.
