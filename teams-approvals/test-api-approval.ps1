<#
.SYNOPSIS
  One-time test: can a quote that is Pending approval be approved through the HubSpot API?
  This is exactly what the Teams flow's "Approve quote" step does.

.DESCRIPTION
  Asks for the "Quote Approvals (Microsoft Teams)" private app token (hidden; never saved, never shown).
  Shows the quote's status, sets Internal quote status (hs_status) to APPROVED, then shows the status again.
  Use it only on a test quote.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\teams-approvals\test-api-approval.ps1 -QuoteId 45988006048
#>
param([Parameter(Mandatory = $true)][string]$QuoteId)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$secure = Read-Host "Paste the Quote Approvals (Microsoft Teams) private app token (hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $token) { throw "No token entered." }

$headers = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$base = "https://api.hubapi.com/crm/objects/2026-09/quotes/$QuoteId"
$props = "hs_title,hs_status,hs_quote_status,hs_quote_progression_status,hs_locked"

function Show-Quote($label) {
  $q = Invoke-RestMethod -Method Get -Uri "${base}?properties=$props" -Headers $headers
  $p = $q.properties
  Write-Host ""
  Write-Host $label -ForegroundColor Cyan
  Write-Host "  Title:                 $($p.hs_title)"
  Write-Host "  Internal quote status: $($p.hs_status)"
  Write-Host "  Status:                $($p.hs_quote_status)"
  Write-Host "  Progression status:    $($p.hs_quote_progression_status)"
  Write-Host "  Locked:                $($p.hs_locked)"
  return $p
}

try {
  $before = Show-Quote "Before"
  if ($before.hs_status -ne "PENDING_APPROVAL") {
    Write-Host ""
    Write-Host "The quote isn't Pending approval, so nothing was changed. Request approval on it first." -ForegroundColor Yellow
    exit 1
  }

  Write-Host ""
  Write-Host "Setting Internal quote status to APPROVED..." -ForegroundColor Cyan
  try {
    $null = Invoke-RestMethod -Method Patch -Uri $base -Headers $headers -Body '{"properties":{"hs_status":"APPROVED"}}'
    Write-Host "  HubSpot accepted the change." -ForegroundColor Green
  } catch {
    $detail = ""
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $detail = $_.ErrorDetails.Message }
    Write-Host "  HubSpot refused the change: $($_.Exception.Message) $detail" -ForegroundColor Red
  }

  Start-Sleep -Seconds 3
  $null = Show-Quote "After"
  Write-Host ""
  Write-Host "Now open the quote in HubSpot and check the Approvals panel: does it show as approved, and can it be published / sent?" -ForegroundColor Cyan
} finally {
  $token = $null
  $headers = $null
}
