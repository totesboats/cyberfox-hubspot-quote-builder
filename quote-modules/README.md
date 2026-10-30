# CyberFOX quote template modules

A separate HubSpot project (not part of the Quote Builder card) holding custom modules for
**CPQ quote templates**. It has one module so far:

## Line items by product

Prints one line item table per product, in this order:

1. AutoElevate (always the first table)
2. Password Manager
3. DNS Filtering
4. Timus SASE
5. Optimize365 (TDR lines go here too)
6. Other (anything that matches none of the above, e.g. an old CyberFOX Bundle line)

There is no Bundle table: CyberFOX Bundles aren't quoted.

A product's table only appears when the quote has lines for it, so an AutoElevate-only quote
shows one table. Ramp lines (RAMP 1, RAMP 2 …) stay in their product's table. Each table looks
like HubSpot's own line items table: Product name, Quantity, Term, Unit discount, Net Price, with
no subtotals or totals.

### How lines are matched to a product

HubSpot only gives quote templates the standard line item properties, not custom ones like
`qb_family`, so the module reads the product from the line's **name and SKU**. All 369 tagged
products were checked against the rules (Oct 2026), and every one lands in the right table.
Lines added by hand in HubSpot are grouped the same way.

To add a product or change a heading: edit `PRODUCT_GROUPS` in
`src/cms-assets/cyberfox-quote-modules/components/modules/ProductLineItems/productGroups.js`
and add a case to `tests/quote-modules.test.mjs`.

## Deploy

`.\push.cmd "message"` as usual. When anything in `quote-modules/` changes, GitHub runs
**Deploy quote template module** (tests, typecheck, then `hs project upload` for this folder).
It uses the same two secrets as the card. Pushes that only touch `quote-modules/` don't
redeploy the card.

## Works with or without the Quote Builder

The module only reads the quote's line items, so it groups quotes built by hand in HubSpot
exactly like Quote Builder quotes. The Quote Builder isn't needed for the template to work.

## Put it on the template

1. In HubSpot, open the CPQ quote template in the template editor.
2. Add the **Line items by product** module where the line items table sits now.
3. Hide the default **Line items** module, but don't delete it. HubSpot needs it on the
   template to edit a quote's line items.
4. Optional: in the module's settings, rename any table heading, add a heading above the
   tables, or change the space at the left and right edges (default 32px, to line up with the
   rest of the quote).
5. Preview with a real multi-product quote before switching the team's default template.

**After every push that changes this module, open the template and update it by hand.** A
deploy doesn't change existing templates on its own.

The template editor shows sample AutoElevate and DNS Filtering tables, because a template has
no real line items.

Custom quote modules are a HubSpot **beta** for CPQ templates and need Revenue Hub
Professional or Enterprise. If the module doesn't show up in the editor after a successful
deploy, the portal may not be enrolled in the beta yet.

## Local work (optional)

```
cd quote-modules/src/cms-assets/cyberfox-quote-modules
npm install
npm run typecheck
```
