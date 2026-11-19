# Power Automate flow: Quote approvals → Teams

## Fastest: import the package

`QuoteApprovalsTeams-flow.zip` is the whole flow, built from this guide by `build-flow-package.py`.
It has no secrets in it.

1. make.powerautomate.com → **My flows** → **Import** → **Import Package (Legacy)** → **Upload** →
   pick `teams-approvals\QuoteApprovalsTeams-flow.zip`.
2. Under **Related resources**, click the wrench (**Select during import**) next to **Microsoft Teams** and pick
   your Teams connection (or create one with your account). Leave the flow as **Create as new**.
3. **Import**, then **Open flow**.
4. In **HubSpot token**, replace the placeholder text with the private app token (Secure inputs is already on).
5. In each Teams step, pick the **Team** and **Channel** (the approvals channel):
   **Post card and wait**, **Not an approver**, **Approved message**, **Approve failed**, **Already handled**.
   If a Teams step's message field came through empty, copy it from the step-by-step section below.
6. **Save**, then open the trigger and copy the **HTTP POST URL** (it's a secret).

If the import fails, build it by hand with the steps below.

---

## By hand

Build in Power Automate (make.powerautomate.com) → **Create → Instant cloud flow → Skip**, named
**Quote approvals → Teams**. It needs Premium (HTTP trigger and HTTP actions). Rename each action exactly as
written in **bold** below: the expressions refer to actions by those names.

Expressions go in the **fx** (expression) box. Text with `@{...}` goes in a normal field: Power Automate
treats it as dynamic content.

---

## Trigger: When a HTTP request is received
- **Who can trigger the flow:** Anyone (the URL's key is the protection, so keep the URL secret).
- **Method:** POST.
- **Request Body JSON Schema:** paste `trigger-schema.json`.

Save once to get the **HTTP POST URL**. It goes in the HubSpot workflow secret `QUOTE_APPROVALS_FLOW_URL`.

## 1. Compose, renamed **HubSpot token**
- Inputs: the **Quote Approvals (Microsoft Teams)** private app token (paste it straight from HubSpot; nowhere else).
- Settings → **Secure inputs: On** (keeps the token out of run history; a Compose step only offers Secure inputs,
  and its output is the same value so it stays hidden too).
- This is the only place the token lives in the flow. To rotate it, paste the new token here.
- Keep yourself as the flow's only owner: anyone who can edit the flow can read this step.
  (CyberFOX policy prefers Azure Key Vault for production secrets; if a vault becomes available, swap this step
  for **Azure Key Vault → Get secret** and change the two `Authorization` headers to use it.)

## 2. Initialize variable, renamed **Init done**
- Name `done`, type Boolean, value `false`.

## 3. Do until, renamed **Until handled**
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
1. **HTTP**, renamed **Get quote status**. Settings → Secure inputs: On.
   - Method GET. URI:
     `https://api.hubapi.com/crm/objects/2026-09/quotes/@{triggerBody()?['quoteId']}?properties=hs_status`
   - Headers: `Authorization` = `Bearer @{outputs('HubSpot_token')}`
2. **Condition**, renamed **Still pending**:
   `body('Get_quote_status')?['properties']?['hs_status']` **is equal to** `PENDING_APPROVAL`
   - **If no:** Post message in a chat or channel (**Already handled**):
     ```
     <b>@{triggerBody()?['quoteTitle']}</b> is no longer pending approval in HubSpot (status: @{body('Get_quote_status')?['properties']?['hs_status']}), so nothing was changed. <a href="@{triggerBody()?['quoteUrl']}">Open in HubSpot</a>
     ```
     Then **Set variable** `done` = `true`.
   - **If yes:**
     1. **HTTP**, renamed **Approve quote**. Settings → Secure inputs: On.
        Method PATCH. URI `https://api.hubapi.com/crm/objects/2026-09/quotes/@{triggerBody()?['quoteId']}`.
        Headers `Authorization` = `Bearer @{outputs('HubSpot_token')}`, `Content-Type` = `application/json`.
        Body: `{"properties": {"hs_status": "APPROVED"}}`
        This approves **and publishes** the quote, as approving in HubSpot does (tested 19 Nov 2026).
     2. **HTTP**, renamed **Record approver**. Secure inputs: On. Same URI and headers as **Approve quote**,
        method PATCH, body:
        `{"properties": {"hs_feedback": "Approved in Microsoft Teams by @{body('Post_card_and_wait')?['responder']?['displayName']}"}}`
        Settings → **Configure run after**: is successful **and** has failed (a failure here never blocks the rest).
     3. Post message in a chat or channel (**Approved message**), run after **Record approver** is successful or has failed:
        ```
        ✅ <b>@{triggerBody()?['quoteTitle']}</b> approved by @{body('Post_card_and_wait')?['responder']?['displayName']} in Teams. <a href="@{triggerBody()?['quoteUrl']}">Open in HubSpot</a>
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
