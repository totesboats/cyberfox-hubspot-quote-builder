# Quote approvals in Microsoft Teams

When a quote goes to **Pending approval**, a card is posted in the Teams approvals channel with the quote
overview and line items. Line items are split by product like the quote (AutoElevate first), and on a
co-term quote the new products come first under "New subscriptions", then the co-termed ones under "Current
subscriptions (co-term)". The quote's approver (Tina for MSP, Adam for ENT, Julie for AM) or anyone in Ops
clicks **Approved** in Teams, and the quote is approved in HubSpot. Or they type what needs to change and click
**Reject**: the quote is set to Rejected with the reason in Approval feedback, and the rep gets a Teams message.
The card updates in place to show who approved or rejected it and when. The routed approver is @mentioned on the card so Teams notifies them, and the rep gets a Teams message when the quote is approved (or rejected). **Open in HubSpot** is always on the card.

Approving from Teams does what approving in HubSpot does: the quote's Internal quote status becomes Approved
and HubSpot publishes it (the quote link goes live, e-sign quotes move to Pending signature). Tested on
19 Nov 2026 with a test quote (`test-api-approval.ps1`). The approver's name is saved in the quote's
**Approval feedback** and posted in the channel.

```
HubSpot workflow "Quote Approval to Teams"           Power Automate flow "Quote approvals -> Teams"
  trigger: Internal quote status = Pending approval     trigger: When a HTTP request is received
  custom code: quote-approval-to-teams.cjs  ── POST ──▶  post card in channel, wait for Approved
    reads quote, deal, company, owner, line items        check the clicker may approve this quote
    builds the card + allowed approvers                   re-check the quote is still pending
                                                          approve the quote in HubSpot, post the result
```

Works for every quote, built with the Quote Builder or by hand. Nothing in the Quote Builder card changes.

## Who can approve

- The approver for the deal's **Sales Team**: MSP → Tina Harvey, ENT → Adam Friedman, AM → Julie Webb.
- **Ops**: Trevor Brown, Harry Lampert, Alex Munson, Anthony Bellini.
- Never the quote's own owner (HubSpot's rule: approvers can't approve their own quotes).

Anyone else who clicks Approved gets a reply saying who can approve it, and the card is posted again.
The list is in `CONFIG` at the top of `quote-approval-to-teams.cjs` (HubSpot owner IDs); emails are read
from HubSpot each time, and matched against the clicker's Teams sign-in email.

The card shows why approval is needed (30%+ discount, ramp of 4+ months). Those thresholds are in `CONFIG`
too and must match the Quote Approval Workflow.

## Setup

### 1. Teams channel
Create the channel (e.g. **Quote Approvals**) in the team Julie, Adam, Tina and Ops are in.

### 2. HubSpot private app
Settings → Integrations → Private apps → **Quote Approvals (Microsoft Teams)**. Scopes:
`crm.objects.quotes.read`, `crm.objects.quotes.write`, `crm.objects.deals.read`, `crm.objects.companies.read`,
`crm.objects.line_items.read`, `crm.objects.owners.read`.
The token goes in two places only: Key Vault secret `hubspot-quote-approval-token` (for the flow) and the
HubSpot workflow secret `QUOTE_APPROVALS_HUBSPOT_TOKEN`. Never paste it in chat, email, Teams or a file.

### 3. Where the secrets live
Azure Key Vault **cfx-integrations-kv** (set up by Owen, Nov 2026): `hubspot-quote-approval-token` holds the
private app token, and the flow reads it each run. HubSpot workflows can't read Key Vault, so the token is also the
HubSpot workflow secret `QUOTE_APPROVALS_HUBSPOT_TOKEN`. Secure inputs and outputs are on for the Key Vault and
HTTP actions. To rotate: rotate in HubSpot, then update Key Vault (Cloud Shell, PowerShell:
`Set-AzKeyVaultSecret -VaultName cfx-integrations-kv -Name hubspot-quote-approval-token -SecretValue (Read-Host "Paste token" -AsSecureString)`)
and the HubSpot secret.

Secret header: built but off at launch (Owen's call). See "Later: secret header" in POWER-AUTOMATE-FLOW.md.

### 4. Power Automate flow
Needs Power Automate Premium (the HTTP trigger and HTTP actions are premium). Import `QuoteApprovalsTeams-flow.zip`
or build it from [POWER-AUTOMATE-FLOW.md](POWER-AUTOMATE-FLOW.md). Save it, then copy the trigger's
**HTTP POST URL**. That URL contains a key: treat it like a password.

### 5. HubSpot workflow
Automation → Workflows → **Create workflow → From scratch → Quote-based**, named **Quote Approval to Teams**.

1. **Trigger:** Internal quote status (`hs_status`) is any of **Pending approval**. Turn **re-enrollment** on
   for that trigger, so a quote sent back for changes and re-submitted posts again.
2. **Action: Custom code** (Node.js 24.x). Paste all of `quote-approval-to-teams.cjs`.
   Secrets: `QUOTE_APPROVALS_HUBSPOT_TOKEN` (the private app token), `QUOTE_APPROVALS_FLOW_URL`
   (the flow URL, or `dry-run` until the flow exists: the step then reads the quote and builds the card but
   sends nothing). Later: `QUOTE_APPROVALS_FLOW_KEY` (when the header check is turned on). Output fields (optional): `posted`, `approver`, `reasons` (strings), `lines`, `cardBytes` (numbers).
3. Turn the workflow on. It runs alongside the existing Quote Approval Workflow, which still decides
   whether a quote needs approval.

### 6. Test
On a test deal, build a quote that needs approval (e.g. 35% discount) and click **Request approval**.
The card should appear in the channel within a minute. Check:
- Someone who isn't an approver clicks Approved: they get the "can't approve" reply.
- The routed approver clicks Approved: the quote shows as approved and published in HubSpot, Approval feedback
  says who approved it in Teams and when, and the channel says so too.

`test-api-approval.ps1 -QuoteId <id>` re-runs the API approval on its own (test quotes only).

## Status (Nov 2026)

- Done: Teams channel, flow imported, HubSpot workflow **Quote Approval to Teams** built, dry-run test passed.
- Premium approved by Owen. Go-live conditions: approver-only approvals with who/when written to the quote,
  Secure inputs/outputs on Key Vault and HTTP actions, Owen as co-owner, and a fresh HubSpot token stored in
  Key Vault (the old one lived in the flow). Launching with the token in Key Vault only; secret header later.
- Workflow stays OFF until the end-to-end test in step 6 passes and Owen has reviewed the flow.

## Files

- `quote-approval-to-teams.cjs`: the workflow code step (tests: `tests/teams-approvals.test.mjs`).
- `POWER-AUTOMATE-FLOW.md`: the flow, step by step.
- `trigger-schema.json`: the JSON schema for the flow's HTTP trigger.
- `test-api-approval.ps1`: one-off check that a Pending approval quote can be approved through the API.
- `card-preview.png`: what the card looks like.
- `build-flow-package.py` / `QuoteApprovalsTeams-flow.zip`: the flow import package (no secrets in it).
