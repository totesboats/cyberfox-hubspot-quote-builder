"""Builds the Power Automate import package for the "Quote approvals -> Teams" flow.

    python teams-approvals/build-flow-package.py   ->  teams-approvals/QuoteApprovalsTeams-flow.zip

Import it in Power Automate: My flows -> Import -> Import Package (Legacy). See POWER-AUTOMATE-FLOW.md.
    python teams-approvals/build-flow-package.py --require-flow-key   (adds the x-cfx-flow-key header check)

The package holds no secrets. The HubSpot token is read at run time from Azure Key Vault (cfx-integrations-kv),
secret hubspot-quote-approval-token. Launch (Owen, Nov 2026) is token-in-Key-Vault only; the header check
(Key Vault secret quote-approval-flow-key) is built in and switched on with --require-flow-key once that secret exists.
"""
import json
import sys
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REQUIRE_FLOW_KEY = "--require-flow-key" in sys.argv
OUT = HERE / "QuoteApprovalsTeams-flow.zip"
FLOW_NAME = "Quote approvals -> Teams"

TEAMS_API = "/providers/Microsoft.PowerApps/apis/shared_teams"
TEAMS_HOST = {"connectionName": "shared_teams", "apiId": TEAMS_API}
KV_API = "/providers/Microsoft.PowerApps/apis/shared_keyvault"
KV_HOST = {"connectionName": "shared_keyvault", "apiId": KV_API}
AUTH = "@parameters('$authentication')"
# Owen: Secure Inputs and Secure Outputs on the Key Vault and HTTP actions.
SECURE_IN_OUT = {"secureData": {"properties": ["inputs", "outputs"]}}
HUBSPOT_TOKEN_SECRET = "hubspot-quote-approval-token"
FLOW_KEY_SECRET = "quote-approval-flow-key"
FLOW_KEY_HEADER = "x-cfx-flow-key"  # must match FLOW_KEY_HEADER in quote-approval-to-teams.cjs
QUOTE_URI = "https://api.hubapi.com/crm/objects/2026-09/quotes/@{triggerBody()?['quoteId']}"
BEARER = "Bearer @{body('Get_HubSpot_token')?['value']}"
RESPONDER = "body('Post_card_and_wait')?['responder']"
CHANNEL = {"body/recipient/groupId": "", "body/recipient/channelId": ""}  # picked after import


def update_card(card_field, status_expr, color, run_after):
    """Updates the tile that was clicked (one tile per approval) with the done/note card from HubSpot.

    card_field: doneCardJson or noteCardJson from the trigger. status_expr: an expression (no leading @) for the status
    line. The wait action's output carries the clicked card's message ID.
    Parameter keys for "Update an adaptive card in a chat or channel" are not in Microsoft's public reference; if the
    import rejects them, add the action by hand (POWER-AUTOMATE-FLOW.md) and copy its keys here from Peek code.
    """
    card = ("@replace(replace(triggerBody()?['" + card_field + "'], '{{STATUS}}', " + status_expr + "), "
            "'{{STATUS_COLOR}}', '" + color + "')")
    return {
        "type": "OpenApiConnection",
        "inputs": {
            "host": dict(TEAMS_HOST, operationId="UpdateCardInConversation"),
            "parameters": dict({
                "poster": "Flow bot",
                "location": "Channel",
                "body/messageId": "@body('Post_card_and_wait')?['messageId']",
                "body/messageBody": card,
            }, **CHANNEL),
            "authentication": AUTH,
        },
        "runAfter": run_after,
    }


def set_done(run_after):
    return {"type": "SetVariable", "inputs": {"name": "done", "value": True}, "runAfter": run_after}


def http(method, uri, run_after, body=None):
    inputs = {"method": method, "uri": uri, "headers": {"Authorization": BEARER}}
    if body is not None:
        inputs["headers"]["Content-Type"] = "application/json"
        inputs["body"] = body
    return {"type": "Http", "inputs": inputs, "runAfter": run_after, "runtimeConfiguration": SECURE_IN_OUT}


def key_vault_secret(name, run_after):
    return {
        "type": "OpenApiConnection",
        "inputs": {
            "host": dict(KV_HOST, operationId="GetSecret"),
            "parameters": {"secretName": name},
            "authentication": AUTH,
        },
        "runAfter": run_after,
        "runtimeConfiguration": SECURE_IN_OUT,
    }


def response(status, body, run_after):
    return {"type": "Response", "kind": "Http", "inputs": {"statusCode": status, "body": body}, "runAfter": run_after}


# When the approver clicked (Eastern time), written to the quote's Approval feedback and shown on the card.
NOW_ET = "convertFromUtc(utcNow(), 'Eastern Standard Time', 'MMM d, yyyy h:mm tt')"
APPROVED_AT = "@{" + NOW_ET + "}"
WHO = RESPONDER + "?['displayName']"

still_pending = {
    "type": "If",
    "expression": {"and": [{"equals": ["@body('Get_quote_status')?['properties']?['hs_status']", "PENDING_APPROVAL"]}]},
    "runAfter": {"Get_quote_status": ["Succeeded"]},
    "actions": {
        "Approve_quote": http("PATCH", QUOTE_URI, {}, {"properties": {"hs_status": "APPROVED"}}),
        "Record_approver": dict(
            http("PATCH", QUOTE_URI, {"Approve_quote": ["Succeeded"]},
                 {"properties": {"hs_feedback": "Approved in Microsoft Teams by @{" + RESPONDER + "?['displayName']} "
                                                "(@{outputs('Responder_email')}) on " + APPROVED_AT + " ET"}})),
        "Approved_message": update_card(
            "doneCardJson", "concat('✅ Approved by ', " + WHO + ", ' on ', " + NOW_ET + ", ' ET')", "Good",
            {"Record_approver": ["Succeeded", "Failed"]}),
        "Set_done_approved": set_done({"Approved_message": ["Succeeded", "Failed"]}),
        "Card_approve_failed": update_card(
            "doneCardJson", "concat('Not approved: ', " + WHO + ", ' clicked Approved, but HubSpot refused it (', "
            "string(outputs('Approve_quote')?['statusCode']), '). Please approve it in HubSpot.')", "Attention",
            {"Approve_quote": ["Failed", "TimedOut"]}),
        "Set_done_failed": set_done({"Card_approve_failed": ["Succeeded", "Failed"]}),
    },
    "else": {
        "actions": {
            "Card_already_handled": update_card(
                "doneCardJson", "concat('No longer pending approval in HubSpot (status: ', "
                "body('Get_quote_status')?['properties']?['hs_status'], '), so nothing was changed.')", "Warning",
                {}),
            "Set_done_already": set_done({"Card_already_handled": ["Succeeded", "Failed"]}),
        }
    },
}

can_approve = {
    "type": "If",
    "expression": {"and": [{"equals": ["@contains(triggerBody()?['allowedApprovers'], outputs('Responder_email'))", True]}]},
    "runAfter": {"Responder_email": ["Succeeded"]},
    "actions": {
        "Get_quote_status": http("GET", QUOTE_URI + "?properties=hs_status", {}),
        "Still_pending": still_pending,
    },
    "else": {
        "actions": {
            "Not_an_approver": update_card(
                "noteCardJson", "concat(" + WHO + ", ' can''t approve this quote. It needs ', "
                "coalesce(triggerBody()?['routedApprover']?['name'], 'its sales team approver'), "
                "' or Ops, and nobody can approve their own quote. Approve on the card below.')", "Warning",
                {}),
        }
    },
}

loop_actions = {
    "Post_card_and_wait": {
        "type": "OpenApiConnectionWebhook",
        "inputs": {
            "host": dict(TEAMS_HOST, operationId="PostCardAndWaitForResponse"),
            "parameters": {
                "poster": "Flow bot",
                "location": "Channel",
                "body/body/recipient/groupId": "",
                "body/body/recipient/channelId": "",
                "body/body/messageBody": "@triggerBody()?['cardJson']",
                "body/body/updateMessage": "Checking approval…",
            },
            "authentication": AUTH,
        },
        "runAfter": {},
    },
    "Responder_email": {
        "type": "Compose",
        "inputs": "@toLower(coalesce(" + RESPONDER + "?['email'], " + RESPONDER + "?['userPrincipalName'], ''))",
        "runAfter": {"Post_card_and_wait": ["Succeeded"]},
    },
    "Can_approve": can_approve,
}

# Optional (--require-flow-key): reject anything without the shared key before doing anything else.
FLOW_KEY_ACTIONS = {
    "Get_flow_key": key_vault_secret(FLOW_KEY_SECRET, {}),
    "Check_flow_key": {
        "type": "If",
        "expression": {"and": [{"equals": [
            "@coalesce(triggerOutputs()?['headers']?['" + FLOW_KEY_HEADER + "'], '')",
            "@body('Get_flow_key')?['value']",
        ]}]},
        "runAfter": {"Get_flow_key": ["Succeeded"]},
        "actions": {"Accepted": response(202, {"status": "accepted"}, {})},
        "else": {
            "actions": {
                "Rejected": response(401, {"error": "missing or wrong " + FLOW_KEY_HEADER + " header"}, {}),
                "Stop_rejected": {"type": "Terminate", "inputs": {"runStatus": "Cancelled"}, "runAfter": {"Rejected": ["Succeeded"]}},
            }
        },
    },
}

definition = {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "$connections": {"defaultValue": {}, "type": "Object"},
        "$authentication": {"defaultValue": {}, "type": "SecureObject"},
    },
    "triggers": {
        "manual": {
            "type": "Request",
            "kind": "Http",
            "inputs": {
                "triggerAuthenticationType": "All",
                "method": "POST",
                "schema": json.loads((HERE / "trigger-schema.json").read_text(encoding="utf-8")),
            },
        }
    },
    "actions": dict(FLOW_KEY_ACTIONS if REQUIRE_FLOW_KEY else {}, **{
        # The HubSpot token, read from Key Vault each run (never stored in the flow).
        "Get_HubSpot_token": key_vault_secret(
            HUBSPOT_TOKEN_SECRET, {"Check_flow_key": ["Succeeded"]} if REQUIRE_FLOW_KEY else {}),
        "Init_done": {
            "type": "InitializeVariable",
            "inputs": {"variables": [{"name": "done", "type": "boolean", "value": False}]},
            "runAfter": {"Get_HubSpot_token": ["Succeeded"]},
        },
        "Until_handled": {
            "type": "Until",
            "expression": "@equals(variables('done'), true)",
            "limit": {"count": 10, "timeout": "P30D"},
            "actions": loop_actions,
            "runAfter": {"Init_done": ["Succeeded"]},
        },
    }),
    "outputs": {},
}


def build():
    flow_id = str(uuid.uuid4())
    flow_res, api_res, conn_res, kv_api_res, kv_conn_res = (str(uuid.uuid4()) for _ in range(5))
    teams_icon = "https://connectoricons-prod.azureedge.net/releases/v1.0.1700/1.0.1700.3802/teams/icon.png"
    kv_icon = "https://connectoricons-prod.azureedge.net/releases/v1.0.1700/1.0.1700.3802/keyvault/icon.png"
    manifest = {
        "schema": "1.0",
        "details": {
            "displayName": FLOW_NAME,
            "description": "Posts quotes pending approval to the Teams approvals channel; Approved approves the quote in HubSpot.",
            "createdTime": "2026-11-19T00:00:00.0000000Z",
            "packageTelemetryId": str(uuid.uuid4()),
            "creator": "CyberFOX Ops",
            "sourceEnvironment": "",
        },
        "resources": {
            flow_res: {
                "type": "Microsoft.Flow/flows",
                "suggestedCreationType": "New",
                "creationType": "Existing, New, Update",
                "details": {"displayName": FLOW_NAME},
                "configurableBy": "User",
                "hierarchy": "Root",
                "dependsOn": [api_res, conn_res, kv_api_res, kv_conn_res],
            },
            api_res: {
                "id": TEAMS_API,
                "name": "shared_teams",
                "type": "Microsoft.PowerApps/apis",
                "suggestedCreationType": "Existing",
                "details": {"displayName": "Microsoft Teams", "iconUri": teams_icon},
                "configurableBy": "System",
                "hierarchy": "Child",
                "dependsOn": [],
            },
            conn_res: {
                "type": "Microsoft.PowerApps/apis/connections",
                "suggestedCreationType": "Existing",
                "creationType": "Existing",
                "details": {"displayName": "Microsoft Teams", "iconUri": teams_icon},
                "configurableBy": "User",
                "hierarchy": "Child",
                "dependsOn": [api_res],
            },
            kv_api_res: {
                "id": KV_API,
                "name": "shared_keyvault",
                "type": "Microsoft.PowerApps/apis",
                "suggestedCreationType": "Existing",
                "details": {"displayName": "Azure Key Vault", "iconUri": kv_icon},
                "configurableBy": "System",
                "hierarchy": "Child",
                "dependsOn": [],
            },
            kv_conn_res: {
                "type": "Microsoft.PowerApps/apis/connections",
                "suggestedCreationType": "Existing",
                "creationType": "Existing",
                "details": {"displayName": "Azure Key Vault (cfx-integrations-kv)", "iconUri": kv_icon},
                "configurableBy": "User",
                "hierarchy": "Child",
                "dependsOn": [kv_api_res],
            },
        },
    }
    flow = {
        "name": flow_id,
        "id": f"/providers/Microsoft.Flow/flows/{flow_id}",
        "type": "Microsoft.Flow/flows",
        "properties": {
            "apiId": "/providers/Microsoft.PowerApps/apis/shared_logicflows",
            "displayName": FLOW_NAME,
            "definition": definition,
            "connectionReferences": {
                "shared_teams": {"connectionName": "shared-teams-quote-approvals", "source": "Embedded", "id": TEAMS_API, "tier": "NotSpecified"},
                "shared_keyvault": {"connectionName": "shared-keyvault-quote-approvals", "source": "Embedded", "id": KV_API, "tier": "NotSpecified"},
            },
            "flowFailureAlertSubscribed": False,
            "isManaged": False,
        },
    }
    base = f"Microsoft.Flow/flows/{flow_res}"
    files = {
        "manifest.json": manifest,
        "Microsoft.Flow/flows/manifest.json": {"packageSchemaVersion": "1.0", "flowAssets": {"assetPaths": [flow_res]}},
        f"{base}/definition.json": flow,
        f"{base}/apisMap.json": {"shared_teams": api_res, "shared_keyvault": kv_api_res},
        f"{base}/connectionsMap.json": {"shared_teams": conn_res, "shared_keyvault": kv_conn_res},
    }
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, json.dumps(data, indent=2, ensure_ascii=False))
    return OUT


if __name__ == "__main__":
    print(build())
