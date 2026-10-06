<#
.SYNOPSIS
  Pushes this folder to GitHub without Git or GitHub Desktop.

.DESCRIPTION
  Compares the files in this folder with the repo's main branch and uploads everything that
  changed (new, edited or deleted) as one commit, using GitHub's REST API. A push to main
  starts the "Test and deploy to HubSpot" workflow.

  Files in github-workflows\ are pushed to .github/workflows/ (Claude can't write hidden
  folders on your PC, so it puts workflow files there).

  First run: asks for the repo (owner/name) and a fine-grained GitHub token limited to that
  repo with Contents: Read and write + Workflows: Read and write. The token is saved encrypted
  for your Windows user in %LOCALAPPDATA%\CyberFOX-QuoteBuilder (never in this folder).

.EXAMPLE
  .\push.cmd "Tighten products step layout"
  .\push.cmd "Preview only" -DryRun
  .\push.cmd -ResetToken
#>
param(
  [Parameter(Position = 0)][string]$Message = "Update from Claude",
  [switch]$DryRun,
  [switch]$ResetToken,
  [string]$Branch = "main",
  [string]$ApiBase = "https://api.github.com"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigPath = Join-Path $Root "push.config.json"
$SecretDir = Join-Path $env:LOCALAPPDATA "CyberFOX-QuoteBuilder"
$TokenPath = Join-Path $SecretDir "github-token.dat"

# Never pushed: dependencies, build output, review CSVs, local secrets.
$ExcludeDirs = @(".git", "node_modules", "tests/card/.out")
$ExcludeFiles = @("*.csv", ".env", "*.log", "Thumbs.db", "desktop.ini")

# ---------------------------------------------------------------- config + token
function Get-Repo {
  if (Test-Path $ConfigPath) { return (Get-Content $ConfigPath -Raw | ConvertFrom-Json).repo }
  $repo = Read-Host "GitHub repo (owner/name), e.g. cyberfox/cyberfox-hubspot-quote-builder"
  if ($repo -notmatch '^[\w.-]+/[\w.-]+$') { throw "Repo must look like owner/name." }
  @{ repo = $repo } | ConvertTo-Json | Set-Content -Path $ConfigPath -Encoding UTF8
  return $repo
}

function Get-Token {
  if ($ResetToken -and (Test-Path $TokenPath)) { Remove-Item $TokenPath -Force }
  if ($env:GITHUB_TOKEN_FOR_PUSH) { return $env:GITHUB_TOKEN_FOR_PUSH }   # used by automated tests only
  if (Test-Path $TokenPath) {
    $secure = Get-Content $TokenPath | ConvertTo-SecureString
  } else {
    Write-Host "Paste the fine-grained GitHub token (input is hidden):" -ForegroundColor Cyan
    $secure = Read-Host -AsSecureString
    New-Item -ItemType Directory -Force -Path $SecretDir | Out-Null
    $secure | ConvertFrom-SecureString | Set-Content -Path $TokenPath   # DPAPI: only your Windows user can decrypt
  }
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# ---------------------------------------------------------------- GitHub API
function Invoke-GitHub([string]$Method, [string]$Path, $Body = $null, [switch]$AllowMissing) {
  $params = @{
    Method  = $Method
    Uri     = "$ApiBase$Path"
    Headers = @{ Authorization = "Bearer $script:Token"; Accept = "application/vnd.github+json"; "X-GitHub-Api-Version" = "2022-11-28"; "User-Agent" = "cyberfox-quote-builder-push" }
  }
  if ($null -ne $Body) {
    $params.Body = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 20 -Compress))
    $params.ContentType = "application/json; charset=utf-8"
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    $status = $null
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($AllowMissing -and ($status -eq 404 -or $status -eq 409)) { return $null }
    if ($status -eq 401) { throw "GitHub rejected the token (401). Run .\push.cmd -ResetToken and paste a new one." }
    if ($status -eq 403) { throw "GitHub refused (403). The token needs Contents: Read and write and Workflows: Read and write on this repo." }
    if ($status -eq 404) { throw "Not found (404) at $Path. Check the repo name in push.config.json and that the token can see it." }
    throw
  }
}

# Git's object id for a file: SHA-1 of "blob <size>\0<bytes>".
function Get-GitBlobSha([byte[]]$Bytes) {
  $header = [Text.Encoding]::ASCII.GetBytes("blob $($Bytes.Length)`0")
  $all = New-Object byte[] ($header.Length + $Bytes.Length)
  [Array]::Copy($header, 0, $all, 0, $header.Length)
  [Array]::Copy($Bytes, 0, $all, $header.Length, $Bytes.Length)
  $sha1 = [Security.Cryptography.SHA1]::Create()
  try { return -join ($sha1.ComputeHash($all) | ForEach-Object { $_.ToString("x2") }) } finally { $sha1.Dispose() }
}

# ---------------------------------------------------------------- local files
function Get-LocalFiles {
  $map = @{}
  Get-ChildItem -Path $Root -Recurse -File -Force | ForEach-Object {
    $rel = $_.FullName.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
    foreach ($d in $ExcludeDirs) { if ($rel -eq $d -or $rel.StartsWith("$d/")) { return } }
    foreach ($p in $ExcludeFiles) { if ($_.Name -like $p) { return } }
    if ($rel -like "github-workflows/*") { $rel = ".github/workflows/" + $rel.Substring("github-workflows/".Length) }
    $map[$rel] = $_.FullName
  }
  return $map
}

# ---------------------------------------------------------------- main
$repo = Get-Repo
$script:Token = Get-Token
$null = Invoke-GitHub GET "/repos/$repo"   # validates token + repo access

$local = Get-LocalFiles
Write-Host "Repo $repo ($Branch): $($local.Count) files in this folder" -ForegroundColor Cyan

$ref = Invoke-GitHub GET "/repos/$repo/git/ref/heads/$Branch" -AllowMissing
$remote = @{}
if ($null -eq $ref) {
  # A brand-new repo has no commits, and GitHub's tree API needs one. Seed it with .gitignore.
  Write-Host "Repo is empty; creating the first commit." -ForegroundColor Yellow
  if (-not $DryRun) {
    $seed = if ($local.ContainsKey(".gitignore")) { [IO.File]::ReadAllBytes($local[".gitignore"]) } else { [Text.Encoding]::UTF8.GetBytes("node_modules/`n") }
    $null = Invoke-GitHub PUT "/repos/$repo/contents/.gitignore" @{ message = "Initial commit"; content = [Convert]::ToBase64String($seed); branch = $Branch }
    $ref = Invoke-GitHub GET "/repos/$repo/git/ref/heads/$Branch"
  }
}
if ($null -ne $ref) {
  $headSha = $ref.object.sha
  $commit = Invoke-GitHub GET "/repos/$repo/git/commits/$headSha"
  $tree = Invoke-GitHub GET "/repos/$repo/git/trees/$($commit.tree.sha)?recursive=1"
  if ($tree.truncated) { throw "Repo tree too large to compare." }
  foreach ($t in $tree.tree) { if ($t.type -eq "blob") { $remote[$t.path] = $t.sha } }
}

$entries = @()
$changes = @()
$strictUtf8 = New-Object Text.UTF8Encoding($false, $true)
foreach ($path in ($local.Keys | Sort-Object)) {
  $bytes = [IO.File]::ReadAllBytes($local[$path])
  $sha = Get-GitBlobSha $bytes
  if ($remote[$path] -eq $sha) { continue }
  $changes += ($(if ($remote.ContainsKey($path)) { "  M  " } else { "  A  " }) + $path)
  if ($DryRun) { continue }
  # Text goes inline in the tree request (one API call for all files); anything else is uploaded as a blob.
  $text = $null
  if ([Array]::IndexOf($bytes, [byte]0) -lt 0) { try { $text = $strictUtf8.GetString($bytes) } catch { $text = $null } }
  if ($null -ne $text) {
    $entries += @{ path = $path; mode = "100644"; type = "blob"; content = $text }
  } else {
    $blob = Invoke-GitHub POST "/repos/$repo/git/blobs" @{ content = [Convert]::ToBase64String($bytes); encoding = "base64" }
    $entries += @{ path = $path; mode = "100644"; type = "blob"; sha = $blob.sha }
  }
}
foreach ($path in ($remote.Keys | Sort-Object)) {
  if ($local.ContainsKey($path)) { continue }
  $changes += "  D  $path"
  $entries += @{ path = $path; mode = "100644"; type = "blob"; sha = $null }
}

if ($changes.Count -eq 0) { Write-Host "Nothing changed; GitHub is up to date." -ForegroundColor Green; exit 0 }
Write-Host "$($changes.Count) change(s):"
$changes | ForEach-Object { Write-Host $_ }
if ($DryRun) { Write-Host "Dry run: nothing pushed." -ForegroundColor Yellow; exit 0 }

$newTree = Invoke-GitHub POST "/repos/$repo/git/trees" @{ base_tree = $commit.tree.sha; tree = $entries }
$newCommit = Invoke-GitHub POST "/repos/$repo/git/commits" @{ message = $Message; tree = $newTree.sha; parents = @($headSha) }
$null = Invoke-GitHub PATCH "/repos/$repo/git/refs/heads/$Branch" @{ sha = $newCommit.sha }

Write-Host "Pushed $($newCommit.sha.Substring(0,7)): $Message" -ForegroundColor Green
Write-Host "Deploy progress: https://github.com/$repo/actions"
