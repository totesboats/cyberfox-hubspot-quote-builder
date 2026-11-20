# Power Automate flow: Quote approvals -> Teams

Security setup agreed with Owen (Nov 2026):
- The HubSpot token lives in Azure Key Vault **cfx-integrations-kv** (`hubspot-quote-approval-token`) and is read
  at run time. It is never stored in the flow.
- Launch is token-in-Key-Vault only (Owen's call). The secret-header check is built but off: once a
  `quote-approval-flow-key` secret exists, see **Later: secret header** below.
- Secure inputs **and** Secure outputs are on for every Key Vault and HTTP action, so neither the token nor the
  key shows in run history.
- Only the routed approver or Ops can approve (never the quote's owner). The quote's **Approval feedback** records
  who approved and when.
- Owen is a co-owner of the flow.

## Fastest: import the package

`QuoteApprovalsTeams-flow.zip` is the whole flow, built from this guide by `build-flow-package.py`.
It has no secrets in it.

1. make.powerautomate.com -> **My flows** -> **Import** -> **Import Package (Legacy)** -> **Upload** ->
   pick `teams-approvals\QuoteApprovalsTeams-flow.zip` (built without the header check).
2. Under **Related resources**, use the wrench (**Select during import**):
   - **Microsoft Teams**: your Teams connection.
   - **Azure Key Vault**: create a connection with your account (Default Microsoft Entra ID application),
     key vault name `cfx-integrations-kv`.
   - The flow itself: **Update** the existing "Quote approvals -> Teams" flow (keeps its URL), or **Create as new**.
3. **Import**, then **Open flow**.
4. In each Teams step, pick the **Team** and **Channel** (the approvals channel):
   **Post card and wait**, **Not an approver**, **Approved message**, **Approve failed**, **Already handled**.
5. **Save**. If you created a new flow, copy the trigger's **HTTP POST URL** into the HubSpot secret
   `QUOTE_APPROVALS_FLOW_URL` (it's a secret too).
6. Share -> add Owen as a co-owner.

If the import fails, change the existing flow by hand with the steps below.

---

## By hand

Rename each action exactly as written in **bold**: the expressions refer to actions by those names.
Expressions go in the **fx** (expression) box. Text with `@{...}` goes in a normal field.

## Trigger: When a HTTP request is received
- **Method:** POST. **Request Body JSON Schema:** paste `trigger-schema.json`.
- The URL's own key plus the `x-cfx-flow-key` header check below protect it.

## 1-2. Header check (skip at launch; see **Later: secret header**)

## 1. Azure Key Vault -> Get secret, renamed **Get flow key**
- Name of the secret: `quote-approval-flow-key`.
- Settings -> **Secure inputs: On**, **Secure outputs: On**.

## 2. Condition, renamed **Check flow key**
- Left (expression): `coalesce(triggerOutputs()?['headers']?['x-cfx-flow-key'], '')`
- **is equal to**
- Right (expression): `body('Get_flow_key')?['value']`
- **If yes:** **Response**, renamed **Accepted**: status `202`, body `{"status": "accepted"}`.
- **If no:** **Response**, renamed **Rejected**: status `401`, body `{"error": "missing or wrong x-cfx-flow-key header"}`.
  Then **Terminate**, renamed **Stop rejected**, status **Cancelled**.

## 3. Azure Key Vault -> Get secret, renamed **Get HubSpot token**
- Name of the secret: `hubspot-quote-approval-token`. Secure inputs and Secure outputs: On.
- At launch this is the first action (right after the trigger).
- Delete the old **HubSpot token** Compose step (the token no longer lives in the flow).

## 4. Initialize variable, renamed **Init done**
- Name `done`, type Boolean, value `false`.

## 5. Do until, renamed **Until handled**
- Condition (expression): `equals(variables('done'), true)`
- Change limits: **Count** `10`, **Timeout** `P30D`.

Everything below goes inside **Until handled**.

### 3a. Microsoft Teams → Post adaptive card and wait for a response, renamed **Post card and wait**
- Post as: **Flow bot**. Post in: **Channel**. Team / Channel: the approvals channel.
- Message (expression): `triggerBody()?['cardJson']`
- Update message: `Thanks, checking your approval…`
- Should update card: **Yes** (if the step shows this option)

### 3b. Compose, renamed **Responder email**
- Inputs (expression):
  `toLower(coalesce(body('Post_card_and_wait')?['responder']?['email'], body('Post_card_and_wait')?['responder']?['userPrincipalName'], ''))`

### 3c. Condition, renamed **Can approve**
- `contains(triggerBody()?['allowedApprovers'], outputs('Responder_email'))` **is equal to** `true`
  (left side as an expression, right side the expression `true`).

#### If no
**Microsoft Teams → Post message in a chat or channel**, renamed **Not an approver**, Flow bot, same channel:
```
<b>@{body('Post_card_and_wait')?['responder']?['displayName']}</b> can't approve <b>@{triggerBody()?['quoteTitle']}</b>. It needs @{coalesce(triggerBody()?['routedApprover']?['name'], 'its sales team approver')} or Ops, and nobody can approve their own quote. Posting the card again.
```
(The loop posts the card again.)

#### If yes
1. **HTTP**, renamed **Get quote status**. Settings → Secure inputs: On, Secure outputs: On.
   - Method GET. URI:
     `https://api.hubapi.com/crm/objects/2026-09/quotes/@{triggerBody()?['quoteId']}?properties=hs_status`
   - Headers: `Authorization` = `Bearer @{body('Get_HubSpot_token')?['value']}`
2. **Condition**, renamed **Still pending**:
   `body('Get_quote_status')?['properties']?['hs_status']` **is equal to** `PENDING_APPROVAL`
   - **If no:** Post message in a chat or channel (**Already handled**):
     ```
     <b>@{triggerBody()?['quoteTitle']}</b> is no longer pending approval in HubSpot (status: @{body('Get_quote_status')?['properties']?['hs_status']}), so nothing was changed. <a href="@{triggerBody()?['quoteUrl']}">Open in HubSpot</a>
     ```
     Then **Set variable** `done` = `true`.
   - **If yes:**
     1. **HTTP**, renamed **Approve quote**. Settings → Secure inputs: On, Secure outputs: On.
        Method PATCH. URI `https://api.hubapi.com/crm/objects/2026-09/quotes/@{triggerBody()?['quoteId']}`.
        Headers `Authorization` = `Bearer @{body('Get_HubSpot_token')?['value']}`, `Content-Type` = `application/json`.
        Body: `{"properties": {"hs_status": "APPROVED"}}`
        This approves **and publishes** the quote, as approving in HubSpot does (tested 19 Nov 2026).
     2. **HTTP**, renamed **Record approver**. Secure inputs and Secure outputs: On. Same URI and headers as **Approve quote**,
        method PATCH, body:
        `{"properties": {"hs_feedback": "Approved in Microsoft Teams by @{body('Post_card_and_wait')?['responder']?['displayName']} (@{outputs('Responder_email')}) on @{convertFromUtc(utcNow(), 'Eastern Standard Time', 'MMM d, yyyy h:mm tt')} ET"}}`
        Settings → **Configure run after**: is successful **and** has failed (a failure here never blocks the rest).
     3. Post message in a chat or channel (**Approved message**), run after **Record approver** is successful or has failed:
        ```
        ✅ <b>@{triggerBody()?['quoteTitle']}</b> approved by @{body('Post_card_and_wait')?['responder']?['displayName']} in Teams on @{convertFromUtc(utcNow(), 'Eastern Standard Time', 'MMM d, yyyy h:mm tt')} ET. <a href="@{triggerBody()?['quoteUrl']}">Open in HubSpot</a>
        ```
     4. **Set variable** `done` = `true`.
     5. Failure path: add a parallel branch after **Approve quote** with **Configure run after → has failed**:
        Post message in a chat or channel (**Approve failed**):
        ```
        ⚠️ Couldn't approve <b>@{triggerBody()?['quoteTitle']}</b> from Teams (HubSpot said @{outputs('Approve_quote')?['statusCode']}). Please approve it in HubSpot: <a href="@{triggerBody()?['quoteUrl']}">Open in HubSpot</a>
        ```
        Then **Set variable** `done` = `true`.

---

## Notes
- A card waits up to 30 days. If the quote is approved or changed in HubSpot first, clicking Approved later
  just reports its current status and changes nothing.
- One card per approval request. If a quote is sent back for changes and re-submitted, the HubSpot workflow
  re-enrolls and posts a fresh card.
- The flow's owner account must be in the Team. Posts come from the Flow bot.
- Rotating the HubSpot token: rotate it in HubSpot (private app -> Rotate), then update
  `hubspot-quote-approval-token` in Key Vault **and** the HubSpot workflow secret `QUOTE_APPROVALS_HUBSPOT_TOKEN`.
- Rotating the flow key: update `quote-approval-flow-key` in Key Vault and `QUOTE_APPROVALS_FLOW_KEY` in HubSpot
  at the same time (cards fail with 401 in between).

## One tile per approval (update the clicked card)

Instead of posting new messages after a click, the flow updates the card that was clicked. When the routed
approver or Ops clicks first, the approval stays in one tile that ends up showing the full quote plus
"✅ Approved by <name> on <date time> ET". Only when someone who can't approve clicks first does a second tile appear:
the first one shrinks to a short "<name> can't approve this quote... Approve on the card below" note, and the
card is posted again.

HubSpot sends two extra cards for this: `doneCardJson` (the full card, no Approved button, with a status line)
and `noteCardJson` (title + status). The flow replaces `{{STATUS}}` and `{{STATUS_COLOR}}` in them.

The "<name> used Power Automate to send this notification" line is added by Teams to every Flow bot post. It can't be
turned off from a flow.

### By hand (changes to the existing flow)
1. **Trigger:** replace the Request Body JSON Schema with the new `trigger-schema.json` (adds `doneCardJson`, `noteCardJson`).
2. **Post card and wait:** Update message `Checking approval…`.
3. Replace each of the four **Post message in a chat or channel** steps with **Microsoft Teams -> Update an adaptive
   card in a chat or channel** (same name, same position, same run-after settings). Post as **Flow bot**, Post in
   **Channel**, same Team and Channel. **Message ID** (expression): `body('Post_card_and_wait')?['messageId']`.
   **Adaptive Card** (expression), per step:
   - **Approved message**:
     `replace(replace(triggerBody()?['doneCardJson'], '{{STATUS}}', concat('✅ Approved by ', body('Post_card_and_wait')?['responder']?['displayName'], ' on ', convertFromUtc(utcNow(), 'Eastern Standard Time', 'MMM d, yyyy h:mm tt'), ' ET')), '{{STATUS_COLOR}}', 'Good')`
   - **Card approve failed** (replaces Approve failed; run after Approve quote **has failed / has timed out** only):
     `replace(replace(triggerBody()?['doneCardJson'], '{{STATUS}}', concat('Not approved: ', body('Post_card_and_wait')?['responder']?['displayName'], ' clicked Approved, but HubSpot refused it (', string(outputs('Approve_quote')?['statusCode']), '). Please approve it in HubSpot.')), '{{STATUS_COLOR}}', 'Attention')`
   - **Card already handled** (replaces Already handled):
     `replace(replace(triggerBody()?['doneCardJson'], '{{STATUS}}', concat('No longer pending approval in HubSpot (status: ', body('Get_quote_status')?['properties']?['hs_status'], '), so nothing was changed.')), '{{STATUS_COLOR}}', 'Warning')`
   - **Not an approver**:
     `replace(replace(triggerBody()?['noteCardJson'], '{{STATUS}}', concat(body('Post_card_and_wait')?['responder']?['displayName'], ' can''t approve this quote. It needs ', coalesce(triggerBody()?['routedApprover']?['name'], 'its sales team approver'), ' or Ops, and nobody can approve their own quote. Approve on the card below.')), '{{STATUS_COLOR}}', 'Warning')`
4. **Save.**

Lessons from doing this in the new designer (Nov 2026): give the new steps **new names**. Renaming a new step to the
name of a step you just deleted makes the designer reuse the old step's type. Inserting a step between two others
copies the next step's run-after onto it, so check every run-after afterwards (Code view shows it).

## Reject (changes requested), Nov 2026

The card has a **Reject** button and a "To reject, say what needs to change" box. Reject does what "Request changes"
does in HubSpot: Internal quote status becomes **Rejected** and the reason goes into **Approval feedback**
("Changes requested in Microsoft Teams by <name> (<email>) on <date time> ET: <reason>").

- Only the routed approver or Ops can reject (same rule as approving).
- A reason is required. Reject with an empty box shrinks the tile to a note and posts the card again.
- The tile updates to "Changes requested by <name> on <date time> ET: <reason>".
- The rep gets a 1:1 Teams message from the Workflows bot with the reason and an Open in HubSpot link
  (HubSpot may not send its own notice when the status is set through the API).
- The rep fixes the quote and clicks Request approval again; the HubSpot workflow re-enrolls and posts a new card.

Flow steps (all in the import package): **Clicked action** and **Reject reason** (Compose, after Responder email),
then inside Still pending: **Is reject** -> **Has reason** -> **Reject quote** (HTTP PATCH, secure in/out),
**Card rejected**, **Tell rep** (Post message, Flow bot, Chat with Flow bot, recipient `ownerEmail`),
**Card reject failed**, **Card needs reason**. The approve steps moved under Is reject's "no" branch unchanged.
The status text is JSON-escaped with `slice(string(createArray(<text>)), 2, -2)` so a reason with quotes or line
breaks can't break the card.

The package now has the Sales team / HubSpot Quote Approvals channel IDs filled in, so an **Update** import needs
only the Teams and Key Vault connections picked.

## Later: secret header
When Owen creates `quote-approval-flow-key` in Key Vault:
1. Generate a value (PowerShell on your PC):
   `$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)`
   and put it in Key Vault (`quote-approval-flow-key`) and in the HubSpot workflow secret `QUOTE_APPROVALS_FLOW_KEY`.
   The code step starts sending the `x-cfx-flow-key` header as soon as that secret exists.
2. Rebuild with `python teams-approvals/build-flow-package.py --require-flow-key` and import with **Update**
   (or add steps 1-2 above by hand, and make **Get HubSpot token** run after **Check flow key**).
3. Test: a request without the header gets 401 and the run shows as Cancelled.
