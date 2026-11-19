# Quote approvals in Microsoft Teams

When a quote goes to **Pending approval**, a card is posted in the Teams approvals channel with the quote
overview and line items. The quote's approver (Tina for MSP, Adam for ENT, Julie for AM) or anyone in Ops
clicks **Approved** in Teams, and the quote is approved in HubSpot. **Open in HubSpot** is always on the card
for reviewing or requesting changes there.

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
Copy the token straight into the two places below (the flow's **HubSpot token** step and the HubSpot
workflow secret). Never paste it in chat, email, Teams or a file.

### 3. Where the token lives
In the flow's **HubSpot token** step, with Secure inputs on, so it never shows in run history.
Only the flow's owner should be able to edit the flow, since editors can read that step. CyberFOX policy prefers
Azure Key Vault for production secrets; no vault was available (Nov 2026), so InfoSec should know the token is
kept here. Rotate it in HubSpot (private app → Rotate) if anyone else ever gets edit access to the flow.

### 4. Power Automate flow
Needs Power Automate Premium (the HTTP trigger and HTTP actions are premium). Import `QuoteApprovalsTeams-flow.zip`
or build it from [POWER-AUTOMATE-FLOW.md](POWER-AUTOMATE-FLOW.md). Save it, then copy the trigger's
**HTTP POST URL**. That URL contains a key: treat it like a password.

### 5. HubSpot workflow
Automation → Workflows → **Create workflow → From scratch → Quote-based**, named **Quote Approval to Teams**.

1. **Trigger:** Internal quote status (`hs_status`) is any of **Pending approval**. Turn **re-enrollment** on
   for that trigger, so a quote sent back for changes and re-submitted posts again.
2. **Action: Custom code** (Node.js 24.x). Paste all of `quote-approval-to-teams.cjs`.
   Secrets: `QUOTE_APPROVALS_HUBSPOT_TOKEN` (the private app token) and `QUOTE_APPROVALS_FLOW_URL`
   (the flow URL, or `dry-run` until the flow exists: the step then reads the quote and builds the card but
   sends nothing). Output fields (optional): `posted`, `approver`, `reasons` (strings), `lines`, `cardBytes` (numbers).
3. Turn the workflow on. It runs alongside the existing Quote Approval Workflow, which still decides
   whether a quote needs approval.

### 6. Test
On a test deal, build a quote that needs approval (e.g. 35% discount) and click **Request approval**.
The card should appear in the channel within a minute. Check:
- Someone who isn't an approver clicks Approved: they get the "can't approve" reply.
- The routed approver clicks Approved: the quote shows as approved and published in HubSpot, Approval feedback
  says who approved it in Teams, and the channel says so too.

`test-api-approval.ps1 -QuoteId <id>` re-runs the API approval on its own (test quotes only).

## Status (19 Nov 2026)

- Done: private app and token, Teams channel, flow imported and configured, HubSpot workflow
  **Quote Approval to Teams** built with both secrets, dry-run test passed. Workflow is OFF.
- Waiting on Power Automate Premium. Then: save the flow, set `QUOTE_APPROVALS_FLOW_URL` to the flow's
  HTTP POST URL, run the end-to-end test in step 6, and turn the workflow on.

## Files

- `quote-approval-to-teams.cjs`: the workflow code step (tests: `tests/teams-approvals.test.mjs`).
- `POWER-AUTOMATE-FLOW.md`: the flow, step by step.
- `trigger-schema.json`: the JSON schema for the flow's HTTP trigger.
- `test-api-approval.ps1`: one-off check that a Pending approval quote can be approved through the API.
- `card-preview.png`: what the card looks like.
- `build-flow-package.py` / `QuoteApprovalsTeams-flow.zip`: the flow import package (no secrets in it).
