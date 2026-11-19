"""Builds the Power Automate import package for the "Quote approvals -> Teams" flow.

    python teams-approvals/build-flow-package.py   ->  teams-approvals/QuoteApprovalsTeams-flow.zip

Import it in Power Automate: My flows -> Import -> Import Package (Legacy). See POWER-AUTOMATE-FLOW.md.
The package holds no secrets: the HubSpot token step is a placeholder you fill in after import.
"""
import json
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "QuoteApprovalsTeams-flow.zip"
FLOW_NAME = "Quote approvals -> Teams"

TEAMS_API = "/providers/Microsoft.PowerApps/apis/shared_teams"
TEAMS_HOST = {"connectionName": "shared_teams", "apiId": TEAMS_API}
AUTH = "@parameters('$authentication')"
SECURE_IN = {"secureData": {"properties": ["inputs"]}}
QUOTE_URI = "https://api.hubapi.com/crm/objects/2026-09/quotes/@{triggerBody()?['quoteId']}"
BEARER = "Bearer @{outputs('HubSpot_token')}"
RESPONDER = "body('Post_card_and_wait')?['responder']"
CHANNEL = {"body/recipient/groupId": "", "body/recipient/channelId": ""}  # picked after import


def teams_message(html, run_after):
    return {
        "type": "OpenApiConnection",
        "inputs": {
            "host": dict(TEAMS_HOST, operationId="PostMessageToConversation"),
            "parameters": dict({"poster": "Flow bot", "location": "Channel", "body/messageBody": html}, **CHANNEL),
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
    return {"type": "Http", "inputs": inputs, "runAfter": run_after, "runtimeConfiguration": SECURE_IN}


quote_link = "<a href=\"@{triggerBody()?['quoteUrl']}\">Open in HubSpot</a>"
title = "<b>@{triggerBody()?['quoteTitle']}</b>"

still_pending = {
    "type": "If",
    "expression": {"and": [{"equals": ["@body('Get_quote_status')?['properties']?['hs_status']", "PENDING_APPROVAL"]}]},
    "runAfter": {"Get_quote_status": ["Succeeded"]},
    "actions": {
        "Approve_quote": http("PATCH", QUOTE_URI, {}, {"properties": {"hs_status": "APPROVED"}}),
        "Record_approver": dict(
            http("PATCH", QUOTE_URI, {"Approve_quote": ["Succeeded"]},
                 {"properties": {"hs_feedback": "Approved in Microsoft Teams by @{" + RESPONDER + "?['displayName']}"}})),
        "Approved_message": teams_message(
            "✅ " + title + " approved by @{" + RESPONDER + "?['displayName']} in Teams. " + quote_link,
            {"Record_approver": ["Succeeded", "Failed"]}),
        "Set_done_approved": set_done({"Approved_message": ["Succeeded", "Failed"]}),
        "Approve_failed": teams_message(
            "⚠️ Couldn't approve " + title + " from Teams (HubSpot said @{outputs('Approve_quote')?['statusCode']}). "
            "Please approve it in HubSpot: " + quote_link,
            {"Approve_quote": ["Failed", "TimedOut"]}),
        "Set_done_failed": set_done({"Approve_failed": ["Succeeded", "Failed"]}),
    },
    "else": {
        "actions": {
            "Already_handled": teams_message(
                title + " is no longer pending approval in HubSpot (status: @{body('Get_quote_status')?['properties']?['hs_status']}), "
                "so nothing was changed. " + quote_link,
                {}),
            "Set_done_already": set_done({"Already_handled": ["Succeeded", "Failed"]}),
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
            "Not_an_approver": teams_message(
                "<b>@{" + RESPONDER + "?['displayName']}</b> can't approve " + title + ". It needs "
                "@{coalesce(triggerBody()?['routedApprover']?['name'], 'its sales team approver')} or Ops, "
                "and nobody can approve their own quote. Posting the card again.",
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
                "body/body/updateMessage": "Thanks, checking your approval…",
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
    "actions": {
        "HubSpot_token": {
            "type": "Compose",
            "inputs": "PASTE-THE-QUOTE-APPROVALS-PRIVATE-APP-TOKEN-HERE",
            "runAfter": {},
            # Compose only allows securing inputs; its output is the same value, so it stays hidden too.
            "runtimeConfiguration": {"secureData": {"properties": ["inputs"]}},
        },
        "Init_done": {
            "type": "InitializeVariable",
            "inputs": {"variables": [{"name": "done", "type": "boolean", "value": False}]},
            "runAfter": {"HubSpot_token": ["Succeeded"]},
        },
        "Until_handled": {
            "type": "Until",
            "expression": "@equals(variables('done'), true)",
            "limit": {"count": 10, "timeout": "P30D"},
            "actions": loop_actions,
            "runAfter": {"Init_done": ["Succeeded"]},
        },
    },
    "outputs": {},
}


def build():
    flow_id = str(uuid.uuid4())
    flow_res, api_res, conn_res = (str(uuid.uuid4()) for _ in range(3))
    teams_icon = "https://connectoricons-prod.azureedge.net/releases/v1.0.1700/1.0.1700.3802/teams/icon.png"
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
                "dependsOn": [api_res, conn_res],
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
                "shared_teams": {"connectionName": "shared-teams-quote-approvals", "source": "Embedded", "id": TEAMS_API, "tier": "NotSpecified"}
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
        f"{base}/apisMap.json": {"shared_teams": api_res},
        f"{base}/connectionsMap.json": {"shared_teams": conn_res},
    }
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            z.writestr(name, json.dumps(data, indent=2, ensure_ascii=False))
    return OUT


if __name__ == "__main__":
    print(build())
