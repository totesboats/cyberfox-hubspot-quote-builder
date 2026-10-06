# GitHub route (no Node, no Git on your laptop)

GitHub does the building: every push to `main` runs the tests and uploads the project to HubSpot
(`.github/workflows/deploy.yml`). The one-time setup scripts run from GitHub's Actions tab too
(`.github/workflows/setup.yml`). Your laptop only needs PowerShell and `push.cmd` in this folder.

Repo: `totesboats/cyberfox-hubspot-quote-builder` (set in `push.config.json`; edit that one line if the repo moves).

## 1. Make a GitHub token for the push script (once)

github.com → your picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**

- Name: `Quote Builder push`, expiration 90 days
- Resource owner: the account that owns the repo
- Repository access: **Only select repositories** → `cyberfox-hubspot-quote-builder`
- Repository permissions: **Contents: Read and write**, **Workflows: Read and write** (Metadata: Read is added automatically)

Copy the token. Don't save it in a file, email or chat; the script stores it for you.

## 2. First push

1. In File Explorer, open this folder, click the address bar, type `powershell`, press Enter.
2. Run:

   ```powershell
   .\push.cmd "Initial upload"
   ```

3. When it asks, paste the token (nothing shows while you paste) and press Enter.

The script encrypts the token for your Windows user in `%LOCALAPPDATA%\CyberFOX-QuoteBuilder\` (never in this folder), lists the files it uploads and prints the Actions link.
The `github-workflows\` files go to `.github/workflows/` on GitHub automatically.

The first **Test and deploy to HubSpot** run goes red at the deploy step until step 3 is done. That's expected.

## 3. Add the secrets (GitHub → repo → Settings → Secrets and variables → Actions → New repository secret)

| Name | Value |
|---|---|
| `HUBSPOT_ACCOUNT_ID` | `2585282` |
| `HUBSPOT_PERSONAL_ACCESS_KEY` | HubSpot → Settings → Integrations → **Private Apps / Development → Personal access key** → generate (Developer Projects permission) |
| `HUBSPOT_SETUP_TOKEN` | Create the "Quote Builder setup" private app as in START-HERE step 2 and paste its token here (not into PowerShell) |

Paste these only into GitHub's secret boxes, never into chat, email or files.
Then **Actions → Test and deploy to HubSpot → Re-run all jobs**. Green means uploaded.

## 4. Run the setup scripts (replaces START-HERE steps 3–4)

GitHub → repo → **Actions → Setup scripts → Run workflow**:

1. `properties`, Apply unticked → check the log → run again with **Apply** ticked.
2. `tag-products`, Apply unticked → download the **tag-products-review** artifact (CSV) from the run page and check it → run again with Apply ticked.

Then HubSpot → **Development → Projects → cyberfox-quote-builder → the app → Install**, and continue with START-HERE steps 6–8.

## 5. The change loop

1. Claude writes the changed files straight into this folder.
2. `.\push.cmd "what changed"` (add `-DryRun` to see the list without pushing).
3. Wait for the green check in Actions (≈2–4 min) → refresh the test deal.

If a run goes red, open it and send Claude the failing step's log.

## Push script notes

- It makes GitHub match this folder: files you delete here are deleted on GitHub. Edit files here, not on github.com.
- Never pushed: `node_modules`, `*.csv` (review exports), `.env`, `tests/card/.out`.
- Token expired or wrong: `.\push.cmd -ResetToken` and paste a new one.
- 403 error: the token is missing Contents or Workflows write on this repo.
